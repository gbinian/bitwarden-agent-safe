const Module = require('node:module');
const originalLoad = Module._load;
const buildOnly = new Set(['shx', 'shelljs', 'fast-glob', 'micromatch', 'braces']);
Module._load = function (request, parent, isMain) {
  if (buildOnly.has(request) || [...buildOnly].some((name) => request.startsWith(`${name}/`))) {
    throw new Error(`Build-only dependency reached at runtime: ${request}`);
  }
  const result = originalLoad.call(this, request, parent, isMain);
  if (request === 'node-forge') {
    process.stderr.write('REACHABILITY_GUARD:node-forge-loaded\n');
    return new Proxy(result, {
      get(target, key, receiver) {
        if (['pki', 'rsa', 'pkcs1'].includes(key)) {
          throw new Error(`node-forge RSA API reached: ${key}`);
        }
        return Reflect.get(target, key, receiver);
      },
    });
  }
  return result;
};

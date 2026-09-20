#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function bundledBwEntry() {
  try {
    const packageJson = require.resolve('@bitwarden/cli/package.json');
    const cliPackage = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    const relativeEntry = typeof cliPackage.bin === 'string' ? cliPackage.bin : cliPackage.bin?.bw;
    if (!relativeEntry) return undefined;
    return path.join(path.dirname(packageJson), relativeEntry);
  } catch {
    return undefined;
  }
}

function commandVersion(command, args = ['--version']) {
  const isJavaScript = ['.js', '.cjs', '.mjs'].includes(path.extname(command).toLowerCase());
  const executable = isJavaScript ? process.execPath : command;
  const commandArgs = isJavaScript ? [command, ...args] : args;
  const result = spawnSync(executable, commandArgs, { encoding: 'utf8', windowsHide: true, shell: false });
  if (result.error?.code === 'ENOENT') return { ok: false, detail: 'not found on PATH' };
  return {
    ok: result.status === 0,
    detail: (result.stdout || result.stderr || `exit ${result.status}`).trim(),
  };
}

function dependency(name) {
  try {
    let current = path.dirname(require.resolve(`${name}/package.json`));
    while (path.dirname(current) !== current) {
      const file = path.join(current, 'package.json');
      if (fs.existsSync(file)) {
        const packageJson = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (packageJson.name === name) return { ok: true, detail: `${packageJson.version} at ${current}` };
      }
      current = path.dirname(current);
    }
    throw new Error('package root not found');
  } catch {
    return { ok: false, detail: 'not installed; run npm ci in the plugin directory' };
  }
}

const checks = {
  platform: { ok: ['darwin', 'win32'].includes(process.platform), detail: `${process.platform}/${process.arch}` },
  node: { ok: Number(process.versions.node.split('.')[0]) >= 22, detail: process.version },
  bw: commandVersion(process.env.BW_CLI_PATH || bundledBwEntry() || 'bw'),
  officialMcp: dependency('@bitwarden/mcp-server'),
  mcpSdk: dependency('@modelcontextprotocol/sdk'),
};

let failed = false;
for (const [name, check] of Object.entries(checks)) {
  const marker = check.ok ? 'PASS' : 'FAIL';
  console.log(`${marker.padEnd(4)} ${name.padEnd(12)} ${check.detail}`);
  if (!check.ok) failed = true;
}

if (failed) {
  console.error('\nDoctor found missing or unsupported prerequisites. No credentials were read.');
  process.exit(1);
}
console.log('\nAll local prerequisites passed. No credentials were read.');

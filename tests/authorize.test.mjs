import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openBitwardenLogin } from '../server/lib/authorize.mjs';

test('macOS authorization opens a local terminal without handling credentials', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-agent-safe-auth-'));
  const cliDataDir = path.join(dataDir, 'bitwarden-cli');
  const bwCliPath = path.join(dataDir, 'bw.js');
  await fs.writeFile(bwCliPath, '#!/usr/bin/env node\n');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  let invocation;
  await openBitwardenLogin({
    dataDir,
    nodePath: process.execPath,
    bwCliPath,
    cliDataDir,
    platform: 'darwin',
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      return { unref() {} };
    },
  });

  assert.equal(invocation.command, '/usr/bin/open');
  assert.deepEqual(invocation.args.slice(0, 2), ['-a', 'Terminal']);
  assert.equal(invocation.options.detached, true);
  const launcher = invocation.args[2];
  const contents = await fs.readFile(launcher, 'utf8');
  const mode = (await fs.stat(launcher)).mode & 0o777;
  if (process.platform !== 'win32') {
    assert.equal(mode, 0o700);
  }
  assert.match(contents, / login\n$/);
  assert.match(contents, /BITWARDENCLI_APPDATA_DIR=/);
  assert.equal(contents.includes('master password'), false);
  assert.equal(contents.includes('BW_SESSION'), false);
});

test('authorization rejects relative executable and data paths', async () => {
  await assert.rejects(
    openBitwardenLogin({ dataDir: 'relative', bwCliPath: 'bw.js', cliDataDir: 'data', platform: 'darwin' }),
    /absolute path/,
  );
});

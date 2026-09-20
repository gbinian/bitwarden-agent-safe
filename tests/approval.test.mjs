import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openProfileApproval } from '../server/lib/approval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('profile approval opens a native local flow with a secret-free environment', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-agent-safe-approval-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const previousSession = process.env.BW_SESSION;
  process.env.BW_SESSION = 'must-not-reach-approval-process';
  t.after(() => {
    if (previousSession === undefined) delete process.env.BW_SESSION;
    else process.env.BW_SESSION = previousSession;
  });

  let invocation;
  await openProfileApproval({
    dataDir,
    proposalId: '0123456789abcdefabcd',
    pluginRoot: root,
    nodePath: process.execPath,
    platform: 'darwin',
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      return { once() {}, unref() {} };
    },
  });

  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args[0], path.join(root, 'scripts', 'approve-profile.mjs'));
  assert.equal(invocation.options.detached, true);
  assert.equal(invocation.options.env.BW_SESSION, undefined);
});

test('profile approval rejects malformed proposal IDs', async () => {
  await assert.rejects(
    openProfileApproval({
      dataDir: path.resolve('data'),
      proposalId: '../escape',
      pluginRoot: root,
      platform: 'darwin',
    }),
    /Invalid proposal ID/,
  );
});

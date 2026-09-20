import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runApprovedProfile } from '../server/lib/executor.mjs';
import { approveProfile, loadVerifiedProfile, proposeProfile } from '../server/lib/profiles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'print-secret.mjs');

async function makeApproved(outputPolicy = 'redacted') {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-agent-safe-'));
  const record = await proposeProfile(dataDir, {
    name: `test-${outputPolicy}`,
    description: 'test profile',
    executable: process.execPath,
    args: [fixture],
    cwd: here,
    watchedFiles: [fixture],
    secretBindings: [{ env: 'TEST_SECRET', itemId: 'item-123', field: 'password' }],
    timeoutSeconds: 10,
    outputPolicy,
  });
  await approveProfile(dataDir, record.proposalId);
  return dataDir;
}

const upstream = {
  async call(name, args) {
    assert.equal(name, 'get');
    assert.deepEqual(args, { object: 'password', id: 'item-123' });
    return { content: [{ type: 'text', text: 'p@ss word/+=' }] };
  },
};

test('approved redacted profile never returns common secret encodings', async (t) => {
  const dataDir = await makeApproved('redacted');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  process.env.UNRELATED_HOST_SECRET = 'must-not-be-inherited';
  t.after(() => { delete process.env.UNRELATED_HOST_SECRET; });
  const result = await runApprovedProfile({ dataDir, name: 'test-redacted', upstream });
  assert.equal(result.success, true);
  assert.match(result.stdout, /\[REDACTED\]/);
  for (const leaked of ['p@ss word/+=', 'p%40ss%20word%2F%2B%3D', 'cEBzcyB3b3JkLys9']) {
    assert.equal(JSON.stringify(result).includes(leaked), false);
  }
  assert.match(result.stdout, /unrelated=\n/);
  assert.equal(result.stdout.includes('must-not-be-inherited'), false);
  const audit = await fs.readFile(path.join(dataDir, 'audit', 'events.jsonl'), 'utf8');
  assert.equal(audit.includes('stdout'), false);
  assert.equal(audit.includes('p@ss'), false);
});

test('status-only profile returns no child output', async (t) => {
  const dataDir = await makeApproved('status-only');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const result = await runApprovedProfile({ dataDir, name: 'test-status-only', upstream });
  assert.equal(result.success, true);
  assert.equal('stdout' in result, false);
  assert.equal('stderr' in result, false);
});

test('approved profile fails closed if a watched file changes', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-agent-safe-'));
  const watched = path.join(dataDir, 'watched.mjs');
  await fs.writeFile(watched, 'console.log("before")\n');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const record = await proposeProfile(dataDir, {
    name: 'integrity-test', executable: process.execPath, args: [watched], cwd: dataDir,
    watchedFiles: [watched],
    secretBindings: [{ env: 'TEST_SECRET', itemId: 'item-123', field: 'password' }],
  });
  await approveProfile(dataDir, record.proposalId);
  await fs.writeFile(watched, 'console.log("after")\n');
  await assert.rejects(loadVerifiedProfile(dataDir, 'integrity-test'), /changed after approval/);
});

test('tampered approval signature fails cleanly', async (t) => {
  const dataDir = await makeApproved('redacted');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const approved = path.join(dataDir, 'profiles', 'approved', 'test-redacted.json');
  const record = JSON.parse(await fs.readFile(approved, 'utf8'));
  record.signature = 'short';
  await fs.writeFile(approved, JSON.stringify(record));
  await assert.rejects(loadVerifiedProfile(dataDir, 'test-redacted'), /signature is invalid/);
});

test('reserved process-control environment names are rejected', async () => {
  await assert.rejects(proposeProfile('/tmp/unused', {
    name: 'reserved-env', executable: process.execPath, cwd: here, watchedFiles: [fixture],
    secretBindings: [{ env: 'NODE_OPTIONS', itemId: 'item-123', field: 'password' }],
  }), /reserved for process execution/);
});

test('timed-out profile is terminated and reports timeout', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-agent-safe-'));
  const hang = path.join(here, 'fixtures', 'hang.mjs');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const record = await proposeProfile(dataDir, {
    name: 'timeout-test', executable: process.execPath, args: [hang], cwd: here,
    watchedFiles: [hang],
    secretBindings: [{ env: 'TEST_SECRET', itemId: 'item-123', field: 'password' }],
    timeoutSeconds: 1,
  });
  await approveProfile(dataDir, record.proposalId);
  const started = Date.now();
  const result = await runApprovedProfile({ dataDir, name: 'timeout-test', upstream });
  assert.equal(result.success, false);
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 6000);
});

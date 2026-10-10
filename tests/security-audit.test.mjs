import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { evaluateAudit, fingerprintTree, verifyEvidence } from '../scripts/lib/security-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tripwire = path.join(root, 'tests/fixtures/dependency-tripwire.cjs');
const policy = JSON.parse(await fs.readFile(path.join(root, 'policies/dependency-reachability.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));

function auditReport() {
  const exception = policy.exceptions[0];
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: {
        severity: 'high', nodes: ['node_modules/braces'], fixAvailable: false,
        via: [{ ...exception }],
      },
      micromatch: { severity: 'high', nodes: ['node_modules/micromatch'], via: ['braces'] },
    },
    metadata: { vulnerabilities: { total: 2 } },
  };
}

test('audit gate resolves only reviewed advisories through parent dependency edges', () => {
  assert.deepEqual(evaluateAudit(auditReport(), policy), [policy.exceptions[0].url]);
});

test('audit gate rejects new advisories, critical severity, fixes, and unknown install paths', () => {
  for (const mutate of [
    (r) => { r.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/GHSA-new'; },
    (r) => { r.vulnerabilities.braces.via.push({ url: 'https://github.com/advisories/GHSA-new', severity: 'high' }); },
    (r) => { r.vulnerabilities.braces.severity = 'critical'; },
    (r) => { r.vulnerabilities.braces.fixAvailable = true; },
    (r) => { r.vulnerabilities.braces.nodes.push('node_modules/new/node_modules/braces'); },
    (r) => { r.vulnerabilities.micromatch.via = ['unknown']; },
    (r) => { r.vulnerabilities.micromatch.via = ['micromatch']; },
  ]) {
    const report = auditReport();
    mutate(report);
    assert.throws(() => evaluateAudit(report, policy));
  }
});

test('audit gate rejects registry errors and incomplete reports', () => {
  for (const report of [{}, { error: { code: 'E401' } }, { ...auditReport(), vulnerabilities: {} }]) {
    assert.throws(() => evaluateAudit(report, policy));
  }
});

test('reachability evidence matches the installed releases and fails on expiry or version drift', async () => {
  await verifyEvidence(root, policy, lock, new Date('2026-10-10T00:00:00Z'));
  await assert.rejects(verifyEvidence(root, policy, lock, new Date(policy.expires)), /expired/);
  const changedLock = structuredClone(lock);
  changedLock.packages['node_modules/node-forge'].version = '1.4.1';
  await assert.rejects(verifyEvidence(root, policy, changedLock, new Date('2026-10-10T00:00:00Z')), /version changed/);
  const changedPolicy = { ...policy, evidence: { server: '0'.repeat(64) } };
  await assert.rejects(verifyEvidence(root, changedPolicy, lock, new Date('2026-10-10T00:00:00Z')), /evidence changed/);
});

test('evidence fingerprints normalize Windows text line endings but detect code changes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-safe-hash-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'file.mjs'), 'const value = 1;\n');
  const before = await fingerprintTree(dir, 'file.mjs');
  await fs.writeFile(path.join(dir, 'file.mjs'), 'const value = 1;\r\n');
  assert.equal(await fingerprintTree(dir, 'file.mjs'), before);
  await fs.writeFile(path.join(dir, 'file.mjs'), 'const value = 2;\n');
  assert.notEqual(await fingerprintTree(dir, 'file.mjs'), before);
});

function isolatedEnvironment(dataDir) {
  const names = new Set(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PATHEXT', 'TMPDIR', 'TEMP', 'TMP']);
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => names.has(name))),
    HOME: dataDir, USERPROFILE: dataDir, APPDATA: dataDir, LOCALAPPDATA: dataDir,
    BITWARDENCLI_APPDATA_DIR: path.join(dataDir, 'cli'),
    BW_CLI_PATH: path.join(root, 'tests/fixtures/fake-bw.mjs'),
  };
}

test('runtime tripwires reject the exact dependency and RSA entry points under review', () => {
  for (const expression of ['require("braces")', 'require("node-forge").pki']) {
    const result = spawnSync(process.execPath, ['--require', tripwire, '-e', expression], {
      cwd: root, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Build-only dependency reached|node-forge RSA API reached/);
  }
});

test('real CLI starts and checks isolated unauthenticated status without reaching RSA or build tools', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-safe-tripwire-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  for (const command of ['--version', 'status']) {
    const result = spawnSync(process.execPath, [
      '--require', tripwire, path.join(root, 'node_modules/@bitwarden/cli/build/bw.js'), command,
    ], { env: isolatedEnvironment(dataDir), encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, `Isolated CLI ${command} failed`);
    assert.match(result.stderr, /REACHABILITY_GUARD:node-forge-loaded/);
    if (command === 'status') assert.equal(JSON.parse(result.stdout).status, 'unauthenticated');
    else assert.equal(result.stdout.trim(), policy.packages['node_modules/@bitwarden/cli']);
  }
});

test('real upstream MCP handles status and metadata without importing build tools', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-safe-mcp-tripwire-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const client = new Client({ name: 'reachability-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--require', tripwire, path.join(root, 'node_modules/@bitwarden/mcp-server/dist/index.js')],
    env: isolatedEnvironment(dataDir), stderr: 'pipe',
  });
  transport.stderr?.resume();
  t.after(() => client.close());
  await client.connect(transport);
  for (const [name, args] of [['status', {}], ['list', { type: 'items' }]]) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true);
  }
});

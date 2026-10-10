#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateAudit, verifyEvidence } from './lib/security-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const policy = JSON.parse(await fs.readFile(path.join(root, 'policies/dependency-reachability.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  await verifyEvidence(root, policy, lock);
  // npm sets this for npm run on all supported platforms, avoiding a shell or
  // Windows .cmd invocation. Direct execution must also provide npm_execpath.
  if (!process.env.npm_execpath || !path.isAbsolute(process.env.npm_execpath)) {
    throw new Error('Run this check with npm run audit:security');
  }
  const result = spawnSync(process.execPath, [
    process.env.npm_execpath, 'audit', '--omit=dev', '--json',
    '--registry=https://registry.npmjs.org',
    '--cache', path.join(os.tmpdir(), 'bitwarden-agent-safe-npm-cache'),
  ], { cwd: root, encoding: 'utf8', shell: false, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('npm audit could not complete');
  }
  const report = JSON.parse(result.stdout);
  if (result.status === 1 && report.metadata?.vulnerabilities?.total === 0) {
    throw new Error('npm audit failed without a vulnerability report');
  }
  const exceptions = evaluateAudit(report, policy);
  for (const url of exceptions) console.log(`Reviewed unreachable advisory (expires ${policy.expires}): ${url}`);
  console.log(`Security gate passed; ${exceptions.length} reviewed unreachable advisories, no unreviewed high/critical findings.`);
} catch (error) {
  console.error(`Security gate failed: ${error.message}`);
  process.exitCode = 1;
}

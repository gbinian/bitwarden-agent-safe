#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Node.js 22 or newer is required; found ${process.version}.`);
  process.exit(1);
}

const nodeDir = path.dirname(process.execPath);
const npmCliCandidates = [
  path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
];
const npmCli = npmCliCandidates.find((candidate) => fs.existsSync(candidate));
const executable = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npmArgs = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(os.tmpdir(), 'bitwarden-agent-safe-npm-cache')];
const args = npmCli
  ? [npmCli, ...npmArgs]
  : npmArgs;
const result = spawnSync(executable, args, {
  cwd: pluginRoot,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

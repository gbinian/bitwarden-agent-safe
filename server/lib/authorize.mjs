import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return value;
}

function quotePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteCmd(value) {
  return `"${value.replaceAll('%', '%%').replaceAll('"', '""')}"`;
}

async function writeMacLauncher({ authDir, nodePath, bwCliPath, cliDataDir }) {
  const launcher = path.join(authDir, 'login.command');
  const contents = [
    '#!/bin/sh',
    'set -eu',
    `export BITWARDENCLI_APPDATA_DIR=${quotePosix(cliDataDir)}`,
    `exec ${quotePosix(nodePath)} ${quotePosix(bwCliPath)} login`,
    '',
  ].join('\n');
  await fs.writeFile(launcher, contents, { mode: 0o700 });
  await fs.chmod(launcher, 0o700);
  return launcher;
}

async function writeWindowsLauncher({ authDir, nodePath, bwCliPath, cliDataDir }) {
  const launcher = path.join(authDir, 'login.cmd');
  const contents = [
    '@echo off',
    'setlocal',
    `set "BITWARDENCLI_APPDATA_DIR=${cliDataDir.replaceAll('%', '%%')}"`,
    `${quoteCmd(nodePath)} ${quoteCmd(bwCliPath)} login`,
    'if errorlevel 1 pause',
    '',
  ].join('\r\n');
  await fs.writeFile(launcher, contents, { mode: 0o600 });
  return launcher;
}

export async function openBitwardenLogin({
  dataDir,
  nodePath = process.execPath,
  bwCliPath = process.env.BW_CLI_PATH,
  cliDataDir = process.env.BITWARDENCLI_APPDATA_DIR,
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  requireAbsolute(dataDir, 'Bitwarden Agent Safe data directory');
  requireAbsolute(nodePath, 'Node.js executable');
  requireAbsolute(bwCliPath, 'Bitwarden CLI path');
  requireAbsolute(cliDataDir, 'Bitwarden CLI data directory');
  await fs.access(bwCliPath);

  const authDir = path.join(dataDir, 'auth');
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
  await fs.chmod(authDir, 0o700);

  let child;
  if (platform === 'darwin') {
    const launcher = await writeMacLauncher({ authDir, nodePath, bwCliPath, cliDataDir });
    child = spawnImpl('/usr/bin/open', ['-a', 'Terminal', launcher], {
      detached: true,
      stdio: 'ignore',
    });
  } else if (platform === 'win32') {
    const launcher = await writeWindowsLauncher({ authDir, nodePath, bwCliPath, cliDataDir });
    child = spawnImpl('cmd.exe', ['/d', '/s', '/c', 'start', '', launcher], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
  } else {
    throw new Error('Interactive Bitwarden authorization is currently supported on macOS and Windows');
  }

  child.unref();
}

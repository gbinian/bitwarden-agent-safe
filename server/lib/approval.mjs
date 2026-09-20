import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROPOSAL_ID = /^[a-f0-9]{20}$/;
const SAFE_ENV_NAMES = new Set([
  'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC',
  'LANG', 'LC_ALL', 'LC_CTYPE',
]);

function safeEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(
    ([key, value]) => SAFE_ENV_NAMES.has(key) && typeof value === 'string',
  ));
}

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return value;
}

export async function openProfileApproval({
  dataDir,
  proposalId,
  pluginRoot = process.env.PLUGIN_ROOT || process.cwd(),
  nodePath = process.execPath,
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  requireAbsolute(dataDir, 'Bitwarden Agent Safe data directory');
  requireAbsolute(pluginRoot, 'Plugin root');
  requireAbsolute(nodePath, 'Node.js executable');
  if (!PROPOSAL_ID.test(proposalId ?? '')) throw new Error('Invalid proposal ID');
  if (!['darwin', 'win32'].includes(platform)) {
    throw new Error('Native profile approval is currently supported on macOS and Windows');
  }

  const approvalScript = path.join(pluginRoot, 'scripts', 'approve-profile.mjs');
  await fs.access(approvalScript);
  const child = spawnImpl(nodePath, [
    approvalScript,
    '--data-dir', dataDir,
    '--proposal', proposalId,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: safeEnvironment(),
  });
  child.once?.('error', () => {});
  child.unref();
}

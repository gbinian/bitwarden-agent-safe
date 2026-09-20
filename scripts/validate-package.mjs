#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  '.codex-plugin/plugin.json', '.mcp.json', 'plugin.json', 'mcp.json',
  'skills/bitwarden-agent-safe/SKILL.md', 'server/index.mjs', 'package-lock.json',
  'server/lib/authorize.mjs', 'server/lib/approval.mjs',
  'scripts/launch-bitwarden-safe-mcp', 'scripts/launch-bitwarden-safe-mcp.cmd',
];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing required file: ${relative}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const entry of Object.values(packageLock.packages ?? {})) {
  if (typeof entry?.resolved !== 'string') continue;
  const resolved = new URL(entry.resolved);
  if (resolved.protocol !== 'https:' || resolved.hostname !== 'registry.npmjs.org') {
    throw new Error(`Dependency lockfile must use the official npm registry, found ${resolved.hostname}`);
  }
}
function exactVersion(name) {
  const version = packageJson.dependencies[name];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${name} must use an exact version pin`);
  }
  return version;
}

const expectedMcpVersion = exactVersion('@bitwarden/mcp-server');
const expectedCliVersion = exactVersion('@bitwarden/cli');
const officialPackage = JSON.parse(fs.readFileSync(require.resolve('@bitwarden/mcp-server/package.json'), 'utf8'));
if (officialPackage.version !== expectedMcpVersion) throw new Error('Installed official MCP version does not match the pin');
const cliPackage = JSON.parse(fs.readFileSync(require.resolve('@bitwarden/cli/package.json'), 'utf8'));
if (cliPackage.version !== expectedCliVersion) throw new Error('Installed Bitwarden CLI version does not match the pin');

for (const configFile of ['.mcp.json', 'mcp.json']) {
  const config = JSON.parse(fs.readFileSync(path.join(root, configFile), 'utf8'));
  const server = config.mcpServers?.bitwarden_safe;
  if (!server?.command?.includes('launch-bitwarden-safe-mcp')) {
    throw new Error(`${configFile} must launch through the Codex-aware Node runtime resolver`);
  }
  if (server.env?.BW_CLI_PATH !== '${PLUGIN_ROOT}/node_modules/@bitwarden/cli/build/bw.js') {
    throw new Error(`${configFile} must use the plugin-local Bitwarden CLI`);
  }
  if (server.env?.BITWARDENCLI_APPDATA_DIR !== '${PLUGIN_DATA}/bitwarden-cli') {
    throw new Error(`${configFile} must isolate Bitwarden CLI state in the plugin data directory`);
  }
}

const source = fs.readFileSync(path.join(root, 'server/index.mjs'), 'utf8');
for (const forbidden of ["name: 'get'", "name: 'list'", "name: 'delete'", "name: 'create_text_send'"]) {
  if (source.includes(forbidden)) throw new Error(`Unsafe upstream tool exposed directly: ${forbidden}`);
}
console.log('Package invariants passed.');

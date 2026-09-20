import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fakeBw = path.join(here, 'fixtures', 'fake-bw.mjs');

async function connectedClient(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitwarden-agent-safe-integration-'));
  const client = new Client({ name: 'integration-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'server', 'index.mjs')],
    cwd: root,
    env: {
      ...process.env,
      BW_CLI_PATH: fakeBw,
      BW_SESSION: 'test-session',
      BW_CLIENT_SECRET: 'must-not-reach-official-mcp',
      UNRELATED_UPSTREAM_SECRET: 'must-not-reach-official-mcp',
      BITWARDEN_SAFE_DATA_DIR: dataDir,
      PLUGIN_ROOT: root,
    },
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { client, dataDir };
}

function text(result) {
  return result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

test('server exposes only the safety facade tool set', async (t) => {
  const { client } = await connectedClient(t);
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'authorize', 'create_folder', 'create_generated_login', 'get_item_metadata', 'list_item_metadata',
    'lock', 'profile_list', 'profile_propose', 'profile_request_approval', 'profile_run', 'status', 'sync', 'unlock',
  ]);
  for (const disabled of ['get', 'list', 'delete', 'create_text_send', 'create_attachment']) {
    assert.equal(names.includes(disabled), false);
  }
});

test('read and generated-write responses do not expose vault secrets', async (t) => {
  const { client } = await connectedClient(t);
  const calls = [
    await client.callTool({ name: 'status', arguments: {} }),
    await client.callTool({ name: 'authorize', arguments: {} }),
    await client.callTool({ name: 'list_item_metadata', arguments: {} }),
    await client.callTool({ name: 'get_item_metadata', arguments: { id: 'item-123' } }),
    await client.callTool({
      name: 'create_generated_login',
      arguments: { name: 'Created Login', username: 'private-user', uri: 'https://private.example.test' },
    }),
  ];
  const combined = calls.map(text).join('\n');
  for (const secret of [
    'TOP-SECRET-PASSWORD', 'TOP-SECRET-NOTES', 'TOP-SECRET-TOTP', 'TOP-SECRET-CUSTOM',
    'TOP-SECRET-OLD', 'private@example.test', 'private-user', 'https://private.example.test',
    'generated-secret-value',
  ]) {
    assert.equal(combined.includes(secret), false, `response leaked ${secret}`);
  }
  assert.match(combined, /Example Login/);
  assert.match(combined, /Created Login/);
  assert.match(combined, /unlocked/);
});

test('runtime argument validation rejects unknown fields before upstream use', async (t) => {
  const { client } = await connectedClient(t);
  const result = await client.callTool({ name: 'get_item_metadata', arguments: { id: 'item-123', extra: true } });
  assert.equal(result.isError, true);
  assert.match(text(result), /SAFE_OPERATION_FAILED/);
});

test('profile tools do not return local paths, item IDs, or raw filesystem errors', async (t) => {
  const { client, dataDir } = await connectedClient(t);
  const proposed = await client.callTool({
    name: 'profile_propose',
    arguments: {
      name: 'private-path-test',
      executable: process.execPath,
      args: [fakeBw],
      cwd: root,
      watchedFiles: [fakeBw],
      secretBindings: [{ env: 'TEST_SECRET', itemId: 'item-123', field: 'password' }],
      outputPolicy: 'status-only',
    },
  });
  const proposalText = text(proposed);
  for (const privateValue of [process.execPath, root, fakeBw, dataDir, 'item-123']) {
    assert.equal(proposalText.includes(privateValue), false, `response exposed ${privateValue}`);
  }
  assert.match(proposalText, /profile_request_approval/);

  const failed = await client.callTool({ name: 'profile_run', arguments: { name: 'missing-profile' } });
  assert.equal(failed.isError, true);
  assert.match(text(failed), /SAFE_OPERATION_FAILED/);
  assert.equal(text(failed).includes(dataDir), false);
});

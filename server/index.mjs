#!/usr/bin/env node
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { OfficialBitwardenMcp } from './lib/upstream.mjs';
import { extractText, jsonResult, parseJsonText, sanitizeItem, sanitizeItems } from './lib/sanitize.mjs';
import { listApprovedProfiles, proposeProfile } from './lib/profiles.mjs';
import { runApprovedProfile } from './lib/executor.mjs';
import { openBitwardenLogin } from './lib/authorize.mjs';
import { openProfileApproval } from './lib/approval.mjs';

const dataDir = process.env.BITWARDEN_SAFE_DATA_DIR || path.join(process.cwd(), '.bitwarden-agent-safe-data');
const upstream = new OfficialBitwardenMcp();

const EMPTY_TOOLS = new Set(['status', 'authorize', 'unlock', 'lock', 'sync', 'profile_list']);

function requirePlainObject(value, label = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function rejectUnknownKeys(value, allowed) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
}

function optionalString(value, key, { min = 0, max }) {
  if (value[key] === undefined) return;
  if (typeof value[key] !== 'string' || value[key].length < min || value[key].length > max) {
    throw new Error(`${key} must be a string from ${min} to ${max} characters`);
  }
}

function validateToolArguments(name, args) {
  requirePlainObject(args);
  if (EMPTY_TOOLS.has(name)) {
    rejectUnknownKeys(args, new Set());
    return;
  }
  if (name === 'list_item_metadata') {
    rejectUnknownKeys(args, new Set(['search', 'folderId', 'collectionId', 'trash']));
    optionalString(args, 'search', { max: 500 });
    optionalString(args, 'folderId', { min: 3, max: 200 });
    optionalString(args, 'collectionId', { min: 3, max: 200 });
    if (args.trash !== undefined && typeof args.trash !== 'boolean') throw new Error('trash must be a boolean');
    return;
  }
  if (name === 'get_item_metadata') {
    rejectUnknownKeys(args, new Set(['id']));
    optionalString(args, 'id', { min: 3, max: 200 });
    if (args.id === undefined) throw new Error('id is required');
    return;
  }
  if (name === 'create_generated_login') {
    rejectUnknownKeys(args, new Set(['name', 'username', 'uri', 'folderId', 'length']));
    optionalString(args, 'name', { min: 1, max: 200 });
    optionalString(args, 'username', { max: 500 });
    optionalString(args, 'uri', { max: 2048 });
    optionalString(args, 'folderId', { min: 3, max: 200 });
    if (args.name === undefined) throw new Error('name is required');
    if (args.length !== undefined && (!Number.isInteger(args.length) || args.length < 12 || args.length > 128)) {
      throw new Error('length must be an integer from 12 to 128');
    }
    return;
  }
  if (name === 'create_folder') {
    rejectUnknownKeys(args, new Set(['name']));
    optionalString(args, 'name', { min: 1, max: 200 });
    if (args.name === undefined) throw new Error('name is required');
    return;
  }
  if (name === 'profile_propose') {
    rejectUnknownKeys(args, new Set([
      'name', 'description', 'executable', 'args', 'cwd', 'watchedFiles',
      'secretBindings', 'timeoutSeconds', 'outputPolicy',
    ]));
    return;
  }
  if (name === 'profile_run') {
    rejectUnknownKeys(args, new Set(['name']));
    optionalString(args, 'name', { min: 1, max: 64 });
    if (args.name === undefined) throw new Error('name is required');
    return;
  }
  if (name === 'profile_request_approval') {
    rejectUnknownKeys(args, new Set(['proposalId']));
    optionalString(args, 'proposalId', { min: 20, max: 20 });
    if (!/^[a-f0-9]{20}$/.test(args.proposalId ?? '')) throw new Error('proposalId is invalid');
    return;
  }
  throw new Error(`Unknown or disabled tool: ${name}`);
}

const tools = [
  {
    name: 'status',
    description: 'Check Bitwarden CLI and vault status without reading vault items.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'authorize',
    description: 'Open a local terminal for interactive Bitwarden CLI login. Email, master password, and two-step login codes are entered only in that terminal and never cross MCP.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'unlock',
    description: 'Open the official Bitwarden MCP native password dialog. The master password never crosses MCP.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'lock',
    description: 'Lock the Bitwarden vault and clear the upstream in-memory session.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'sync',
    description: 'Sync encrypted vault data using the official Bitwarden MCP server.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'list_item_metadata',
    description: 'List redacted vault item metadata. Passwords, usernames, notes, TOTP, URIs, cards, identities, custom fields, and password history are removed.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional Bitwarden search term.' },
        folderId: { type: 'string', description: 'Optional exact folder ID.' },
        collectionId: { type: 'string', description: 'Optional exact collection ID.' },
        trash: { type: 'boolean', description: 'Whether to list trashed items.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_item_metadata',
    description: 'Get one vault item by exact ID and return only redacted metadata.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 3, maxLength: 200 } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'create_generated_login',
    description: 'Generate a password inside the safety layer and save a login item. The password is never returned to Codex.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        username: { type: 'string', maxLength: 500 },
        uri: { type: 'string', maxLength: 2048 },
        folderId: { type: 'string', maxLength: 200 },
        length: { type: 'integer', minimum: 12, maximum: 128, default: 32 },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'create_folder',
    description: 'Create a Bitwarden folder and return only its non-secret metadata.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'profile_propose',
    description: 'Write a pending credential-backed execution profile. This does not approve it; approval requires a separate native/terminal confirmation outside MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        executable: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string' },
        watchedFiles: { type: 'array', items: { type: 'string' } },
        secretBindings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              env: { type: 'string' },
              itemId: { type: 'string' },
              field: { type: 'string', enum: ['password', 'username', 'totp', 'notes'] },
            },
            required: ['env', 'itemId', 'field'],
            additionalProperties: false,
          },
        },
        timeoutSeconds: { type: 'integer', minimum: 1, maximum: 3600 },
        outputPolicy: { type: 'string', enum: ['status-only', 'redacted'] },
      },
      required: ['name', 'executable', 'cwd', 'secretBindings'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'profile_list',
    description: 'List approved execution profiles without secret values, item IDs, executable paths, or working directories.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'profile_request_approval',
    description: 'Open a native local confirmation dialog for a pending profile. The dialog shows local paths and bindings without returning them to Codex.',
    inputSchema: {
      type: 'object',
      properties: { proposalId: { type: 'string', pattern: '^[a-f0-9]{20}$' } },
      required: ['proposalId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'profile_run',
    description: 'Run a separately approved, integrity-pinned profile with Bitwarden fields injected into the child environment. Returns status only unless the profile explicitly permits redacted logs.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
];

function safeError() {
  return jsonResult({
    error: 'Bitwarden Agent Safe could not complete the request. Underlying error details were suppressed.',
    code: 'SAFE_OPERATION_FAILED',
  }, true);
}

async function callOfficial(name, args = {}) {
  await upstream.call(name, args);
  return jsonResult({ success: true, operation: name });
}

async function getVaultStatus() {
  const result = await upstream.call('status', {});
  const status = parseJsonText(extractText(result), 'Bitwarden status');
  if (!status || typeof status.status !== 'string') throw new Error('Bitwarden returned an unexpected status response');
  return status.status;
}

async function handleTool(name, args = {}) {
  validateToolArguments(name, args);
  switch (name) {
    case 'status':
    {
      const status = await getVaultStatus();
      return jsonResult({
        status,
        authorizationRequired: status === 'unauthenticated',
        nextAction: status === 'unauthenticated' ? 'authorize' : status === 'locked' ? 'unlock' : null,
      });
    }
    case 'authorize': {
      const status = await getVaultStatus();
      if (status === 'unlocked') {
        return jsonResult({ status, authorizationRequired: false, authorizationStarted: false, nextAction: null });
      }
      if (status === 'locked') {
        return jsonResult({ status, authorizationRequired: false, authorizationStarted: false, nextAction: 'unlock' });
      }
      if (status !== 'unauthenticated') throw new Error('Bitwarden returned an unsupported authorization state');
      await openBitwardenLogin({ dataDir });
      return jsonResult({
        status,
        authorizationRequired: true,
        authorizationStarted: true,
        nextAction: 'status_then_unlock',
      });
    }
    case 'unlock':
    case 'lock':
    case 'sync':
      return callOfficial(name, {});
    case 'list_item_metadata': {
      const upstreamArgs = { type: 'items' };
      if (args.search) upstreamArgs.search = args.search;
      if (args.folderId) upstreamArgs.folderid = args.folderId;
      if (args.collectionId) upstreamArgs.collectionid = args.collectionId;
      if (args.trash) upstreamArgs.trash = true;
      const result = await upstream.call('list', upstreamArgs);
      return jsonResult(sanitizeItems(parseJsonText(extractText(result), 'Bitwarden item list')));
    }
    case 'get_item_metadata': {
      const result = await upstream.call('get', { object: 'item', id: args.id });
      return jsonResult(sanitizeItem(parseJsonText(extractText(result), 'Bitwarden item')));
    }
    case 'create_generated_login': {
      let password = '';
      const login = {};
      try {
        const generated = await upstream.call('generate', {
          length: args.length ?? 32,
          uppercase: true,
          lowercase: true,
          number: true,
          special: true,
        });
        password = extractText(generated).replace(/[\r\n]+$/, '');
        if (!password) throw new Error('empty generated password');
        login.password = password;
        if (typeof args.username === 'string') login.username = args.username;
        if (typeof args.uri === 'string') login.uris = [{ uri: args.uri }];
        const createArgs = { name: args.name, type: 1, login };
        if (args.folderId) createArgs.folderId = args.folderId;
        const created = await upstream.call('create_item', createArgs);
        return jsonResult({ created: sanitizeItem(parseJsonText(extractText(created), 'Created Bitwarden item')) });
      } catch {
        throw new Error('Bitwarden could not create the generated login');
      } finally {
        login.password = '';
        password = '';
      }
    }
    case 'create_folder': {
      const created = await upstream.call('create_folder', { name: args.name });
      const folder = parseJsonText(extractText(created), 'Created Bitwarden folder');
      return jsonResult({ created: { id: folder.id, object: folder.object, name: folder.name } });
    }
    case 'profile_propose': {
      const record = await proposeProfile(dataDir, args);
      return jsonResult({
        proposalId: record.proposalId,
        profile: {
          name: record.proposal.name,
          secretEnvironmentNames: record.proposal.secretBindings.map((binding) => binding.env),
          timeoutSeconds: record.proposal.timeoutSeconds,
          outputPolicy: record.proposal.outputPolicy,
        },
        approvalRequired: true,
        nextAction: 'profile_request_approval',
      });
    }
    case 'profile_list':
      return jsonResult(await listApprovedProfiles(dataDir));
    case 'profile_request_approval':
      await openProfileApproval({ dataDir, proposalId: args.proposalId });
      return jsonResult({
        proposalId: args.proposalId,
        approvalRequested: true,
        nextAction: 'profile_list',
      });
    case 'profile_run':
      return jsonResult(await runApprovedProfile({ dataDir, name: args.name, upstream }));
    default:
      throw new Error(`Unknown or disabled tool: ${name}`);
  }
}

const server = new Server(
  { name: 'bitwarden-agent-safe', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await handleTool(request.params.name, request.params.arguments ?? {});
  } catch (error) {
    return safeError(error);
  }
});

const shutdown = async () => {
  await upstream.close().catch(() => {});
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await server.connect(new StdioServerTransport());
console.error('Bitwarden Agent Safe running on stdio');

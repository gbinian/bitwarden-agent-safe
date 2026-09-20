#!/usr/bin/env node
const args = process.argv.slice(2);
const [command, ...rest] = args;

const item = {
  id: 'item-123',
  object: 'item',
  type: 1,
  name: 'Example Login',
  favorite: false,
  folderId: 'folder-123',
  collectionIds: [],
  revisionDate: '2026-09-20T00:00:00.000Z',
  notes: 'TOP-SECRET-NOTES',
  login: {
    username: 'private@example.test',
    password: 'TOP-SECRET-PASSWORD',
    totp: 'TOP-SECRET-TOTP',
    uris: [{ uri: 'https://private.example.test' }],
  },
  fields: [{ name: 'private', value: 'TOP-SECRET-CUSTOM' }],
  passwordHistory: [{ password: 'TOP-SECRET-OLD' }],
};

function output(value) {
  process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value)}\n`);
}

if (command === '--version') output('2026.7.0-test');
else if (command === 'status') output({
  status: process.env.UNRELATED_UPSTREAM_SECRET || process.env.BW_CLIENT_SECRET ? 'unexpected-env-leak' : 'unlocked',
  userEmail: 'private@example.test',
});
else if (command === 'sync') output('Sync complete.');
else if (command === 'lock') output('Vault is locked.');
else if (command === 'list' && rest[0] === 'items') output([item]);
else if (command === 'get' && rest[0] === 'item') output(item);
else if (command === 'get' && ['password', 'username', 'totp', 'notes'].includes(rest[0])) {
  output(`secret-${rest[0]}-value`);
} else if (command === 'generate') output('generated-secret-value');
else if (command === 'create' && rest[0] === 'item') {
  const created = JSON.parse(Buffer.from(rest[1], 'base64').toString('utf8'));
  output({ id: 'created-123', object: 'item', ...created, revisionDate: '2026-09-20T00:00:00.000Z' });
} else if (command === 'create' && rest[0] === 'folder') {
  const created = JSON.parse(Buffer.from(rest[1], 'base64').toString('utf8'));
  output({ id: 'folder-created-123', object: 'folder', ...created });
} else {
  process.stderr.write(`Unsupported fake bw invocation: ${JSON.stringify(args)}\n`);
  process.exitCode = 2;
}

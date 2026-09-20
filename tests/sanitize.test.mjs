import assert from 'node:assert/strict';
import test from 'node:test';
import { redactText, sanitizeItem, sanitizeItems } from '../server/lib/sanitize.mjs';

test('sanitizeItem returns only explicitly allowed metadata', () => {
  const clean = sanitizeItem({
    id: 'item-1', object: 'item', type: 1, name: 'Account', favorite: true,
    folderId: 'folder-1', collectionIds: ['collection-1'], revisionDate: 'now',
    login: { username: 'user', password: 'secret', uris: [{ uri: 'https://secret.test' }] },
    notes: 'secret notes', fields: [{ value: 'secret custom' }], card: { number: '4111' },
    identity: { ssn: 'secret ssn' }, passwordHistory: [{ password: 'old secret' }],
  });
  assert.deepEqual(clean, {
    id: 'item-1', object: 'item', type: 1, name: 'Account', favorite: true,
    folderId: 'folder-1', collectionIds: ['collection-1'], revisionDate: 'now',
  });
  assert.equal(JSON.stringify(clean).includes('secret'), false);
});

test('sanitizeItems rejects a non-array', () => {
  assert.throws(() => sanitizeItems({}), /item array/);
});

test('redactText removes exact, URL-encoded, and base64 forms', () => {
  const secret = 'p@ss word/+=';
  const text = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')].join('|');
  const redacted = redactText(text, [secret]);
  assert.equal(redacted.includes(secret), false);
  assert.equal(redacted.includes(encodeURIComponent(secret)), false);
  assert.equal(redacted.includes(Buffer.from(secret).toString('base64')), false);
  assert.equal(redacted, '[REDACTED]|[REDACTED]|[REDACTED]');
});

const METADATA_KEYS = new Set([
  'id',
  'object',
  'type',
  'name',
  'favorite',
  'organizationId',
  'folderId',
  'collectionIds',
  'creationDate',
  'revisionDate',
  'deletedDate',
  'reprompt',
]);

export function extractText(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

export function parseJsonText(text, label = 'Bitwarden response') {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} was not valid JSON; refusing to return an unfiltered response`);
  }
}

export function sanitizeItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Bitwarden returned an unexpected item shape');
  }

  const clean = {};
  for (const [key, value] of Object.entries(item)) {
    if (METADATA_KEYS.has(key)) clean[key] = value;
  }
  return clean;
}

export function sanitizeItems(value) {
  if (!Array.isArray(value)) throw new Error('Bitwarden did not return an item array');
  return value.map(sanitizeItem);
}

export function secretVariants(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return [];
  const variants = new Set([secret]);
  try {
    variants.add(encodeURIComponent(secret));
  } catch {
    // Ignore malformed surrogate pairs; the exact value is still redacted.
  }
  variants.add(Buffer.from(secret, 'utf8').toString('base64'));
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
}

export function redactText(text, secrets) {
  let redacted = String(text ?? '');
  for (const secret of secrets) {
    for (const variant of secretVariants(secret)) {
      redacted = redacted.split(variant).join('[REDACTED]');
    }
  }
  return redacted;
}

export function jsonResult(value, isError = false) {
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROFILE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_FIELDS = new Set(['password', 'username', 'totp', 'notes']);
const OUTPUT_POLICIES = new Set(['status-only', 'redacted']);
const RESERVED_ENV_NAMES = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'NODE_OPTIONS', 'NODE_PATH',
  'NODE_EXTRA_CA_CERTS', 'PYTHONPATH', 'PYTHONHOME', 'RUBYOPT', 'PERL5OPT', 'PERL5LIB',
  'BASH_ENV', 'ENV', 'ZDOTDIR', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'IFS', 'PROMPT_COMMAND',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR',
]);
const SCRIPT_RUNTIMES = new Set([
  'node', 'node.exe', 'python', 'python3', 'python.exe', 'python3.exe',
  'ruby', 'ruby.exe', 'perl', 'perl.exe', 'pwsh', 'pwsh.exe',
  'powershell', 'powershell.exe', 'bash', 'sh', 'zsh',
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestObject(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(dir, 0o700);
}

async function writePrivateJson(file, value) {
  await ensurePrivateDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
  if (process.platform !== 'win32') await fs.chmod(file, 0o600);
}

async function sha256File(file) {
  const data = await fs.readFile(file);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function requireAbsoluteFile(value, field) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${field} must be an absolute path on this computer`);
  }
  return path.normalize(value);
}

export function normalizeProposal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Profile proposal must be an object');
  }
  if (!PROFILE_NAME.test(input.name ?? '')) {
    throw new Error('Profile name must be lower-case kebab-case and at most 64 characters');
  }

  const executable = requireAbsoluteFile(input.executable, 'executable');
  const cwd = requireAbsoluteFile(input.cwd, 'cwd');
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new Error('args must be an array of strings');
  }
  if (args.length > 64 || args.some((value) => value.length > 4096)) {
    throw new Error('Profile arguments exceed the safety limit');
  }

  const watchedFiles = input.watchedFiles ?? [];
  if (!Array.isArray(watchedFiles) || watchedFiles.length > 64) {
    throw new Error('watchedFiles must be an array with at most 64 entries');
  }
  const normalizedWatchedFiles = watchedFiles.map((value, index) =>
    requireAbsoluteFile(value, `watchedFiles[${index}]`),
  );
  if (SCRIPT_RUNTIMES.has(path.basename(executable).toLowerCase()) && normalizedWatchedFiles.length === 0) {
    throw new Error('Script runtimes require at least one watchedFiles entry');
  }

  const bindings = input.secretBindings ?? [];
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length > 32) {
    throw new Error('secretBindings must contain between 1 and 32 entries');
  }
  const seenEnvironmentNames = new Set();
  const secretBindings = bindings.map((binding, index) => {
    if (!binding || typeof binding !== 'object') {
      throw new Error(`secretBindings[${index}] must be an object`);
    }
    if (!ENV_NAME.test(binding.env ?? '')) {
      throw new Error(`secretBindings[${index}].env is not a valid environment variable name`);
    }
    if (RESERVED_ENV_NAMES.has(binding.env.toUpperCase())) {
      throw new Error(`secretBindings[${index}].env is reserved for process execution`);
    }
    if (seenEnvironmentNames.has(binding.env)) {
      throw new Error(`Duplicate environment binding: ${binding.env}`);
    }
    seenEnvironmentNames.add(binding.env);
    if (typeof binding.itemId !== 'string' || binding.itemId.length < 3 || binding.itemId.length > 200) {
      throw new Error(`secretBindings[${index}].itemId is invalid`);
    }
    if (!SECRET_FIELDS.has(binding.field)) {
      throw new Error(`secretBindings[${index}].field must be password, username, totp, or notes`);
    }
    return { env: binding.env, itemId: binding.itemId, field: binding.field };
  });

  const timeoutSeconds = input.timeoutSeconds ?? 300;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
    throw new Error('timeoutSeconds must be an integer from 1 to 3600');
  }
  const outputPolicy = input.outputPolicy ?? 'status-only';
  if (!OUTPUT_POLICIES.has(outputPolicy)) {
    throw new Error('outputPolicy must be status-only or redacted');
  }

  return {
    name: input.name,
    description: typeof input.description === 'string' ? input.description.slice(0, 500) : '',
    executable,
    args,
    cwd,
    watchedFiles: normalizedWatchedFiles,
    secretBindings,
    timeoutSeconds,
    outputPolicy,
  };
}

function pathsFor(dataDir) {
  return {
    root: dataDir,
    pending: path.join(dataDir, 'profiles', 'pending'),
    approved: path.join(dataDir, 'profiles', 'approved'),
    key: path.join(dataDir, 'profiles', 'approval.key'),
  };
}

export async function proposeProfile(dataDir, input) {
  const proposal = normalizeProposal(input);
  const proposalId = digestObject(proposal).slice(0, 20);
  const record = { proposalId, createdAt: new Date().toISOString(), proposal };
  const paths = pathsFor(dataDir);
  await writePrivateJson(path.join(paths.pending, `${proposalId}.json`), record);
  return record;
}

export async function readPendingProfile(dataDir, proposalId) {
  if (!/^[a-f0-9]{20}$/.test(proposalId)) throw new Error('Invalid proposal ID');
  const file = path.join(pathsFor(dataDir).pending, `${proposalId}.json`);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function approvalKey(dataDir) {
  const paths = pathsFor(dataDir);
  await ensurePrivateDir(path.dirname(paths.key));
  try {
    return await fs.readFile(paths.key);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const key = crypto.randomBytes(32);
    await fs.writeFile(paths.key, key, { mode: 0o600, flag: 'wx' });
    if (process.platform !== 'win32') await fs.chmod(paths.key, 0o600);
    return key;
  }
}

async function integrityFor(proposal) {
  const executableStat = await fs.stat(proposal.executable);
  const cwdStat = await fs.stat(proposal.cwd);
  if (!executableStat.isFile()) throw new Error('Profile executable is not a regular file');
  if (!cwdStat.isDirectory()) throw new Error('Profile cwd is not a directory');

  const watchedFiles = {};
  for (const file of proposal.watchedFiles) {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error(`Watched path is not a regular file: ${file}`);
    watchedFiles[file] = await sha256File(file);
  }
  return {
    executableSha256: await sha256File(proposal.executable),
    watchedFiles,
  };
}

function signRecord(record, key) {
  return crypto.createHmac('sha256', key).update(stableStringify(record)).digest('hex');
}

export async function approveProfile(dataDir, proposalId) {
  const pending = await readPendingProfile(dataDir, proposalId);
  const proposal = normalizeProposal(pending.proposal);
  if (digestObject(proposal).slice(0, 20) !== proposalId) {
    throw new Error('Proposal contents do not match the proposal ID');
  }
  const record = {
    profile: proposal,
    approval: {
      proposalId,
      approvedAt: new Date().toISOString(),
      integrity: await integrityFor(proposal),
    },
  };
  const key = await approvalKey(dataDir);
  const approved = { ...record, signature: signRecord(record, key) };
  const paths = pathsFor(dataDir);
  await writePrivateJson(path.join(paths.approved, `${proposal.name}.json`), approved);
  await fs.unlink(path.join(paths.pending, `${proposalId}.json`));
  return approved;
}

export async function listApprovedProfiles(dataDir) {
  const dir = pathsFor(dataDir).approved;
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const profiles = [];
  for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
    const record = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    profiles.push({
      name: record.profile?.name,
      secretEnvironmentNames: (record.profile?.secretBindings ?? []).map((binding) => binding.env),
      outputPolicy: record.profile?.outputPolicy,
      approvedAt: record.approval?.approvedAt,
    });
  }
  return profiles;
}

export async function loadVerifiedProfile(dataDir, name) {
  if (!PROFILE_NAME.test(name ?? '')) throw new Error('Invalid profile name');
  const file = path.join(pathsFor(dataDir).approved, `${name}.json`);
  const approved = JSON.parse(await fs.readFile(file, 'utf8'));
  const { signature, ...record } = approved;
  const key = await approvalKey(dataDir);
  const expected = signRecord(record, key);
  const signatureBuffer = typeof signature === 'string' ? Buffer.from(signature) : Buffer.alloc(0);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error('Profile approval signature is invalid');
  }

  const profile = normalizeProposal(record.profile);
  const currentIntegrity = await integrityFor(profile);
  if (stableStringify(currentIntegrity) !== stableStringify(record.approval.integrity)) {
    throw new Error('Profile executable or watched file changed after approval');
  }
  return profile;
}

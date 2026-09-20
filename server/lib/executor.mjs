import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { extractText, redactText } from './sanitize.mjs';
import { loadVerifiedProfile } from './profiles.mjs';

const MAX_CAPTURE_BYTES = 1024 * 1024;
const SAFE_INHERITED_ENV_NAMES = new Set([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'LANG', 'LC_ALL', 'LC_CTYPE',
]);

function safeChildEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => SAFE_INHERITED_ENV_NAMES.has(key) && typeof value === 'string'),
  );
}

async function appendAudit(dataDir, event) {
  const dir = path.join(dataDir, 'audit');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'events.jsonl');
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await fs.chmod(file, 0o600);
}

function collect(stream, capture) {
  return new Promise((resolve) => {
    const chunks = [];
    let length = 0;
    stream.on('data', (chunk) => {
      if (!capture) return;
      if (length >= MAX_CAPTURE_BYTES) return;
      const remaining = MAX_CAPTURE_BYTES - length;
      const slice = chunk.subarray(0, remaining);
      chunks.push(slice);
      length += slice.length;
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function getSecrets(upstream, bindings) {
  const injected = {};
  const values = [];
  for (const binding of bindings) {
    const result = await upstream.call('get', { object: binding.field, id: binding.itemId });
    const value = extractText(result).replace(/[\r\n]+$/, '');
    if (!value) throw new Error(`Bitwarden returned an empty value for ${binding.env}`);
    injected[binding.env] = value;
    values.push(value);
  }
  return { injected, values };
}

export async function runApprovedProfile({ dataDir, name, upstream }) {
  const startedAt = new Date().toISOString();
  const profile = await loadVerifiedProfile(dataDir, name);
  const { injected, values } = await getSecrets(upstream, profile.secretBindings);

  let timedOut = false;
  let child;
  let timer;
  let forceKillTimer;
  try {
    child = spawn(profile.executable, profile.args, {
      cwd: profile.cwd,
      env: { ...safeChildEnvironment(), ...injected },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const captureOutput = profile.outputPolicy === 'redacted';
    const stdoutPromise = collect(child.stdout, captureOutput);
    const stderrPromise = collect(child.stderr, captureOutput);
    const exitPromise = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2000);
      forceKillTimer.unref();
    }, profile.timeoutSeconds * 1000);
    timer.unref();

    const [{ code, signal }, stdout, stderr] = await Promise.all([
      exitPromise,
      stdoutPromise,
      stderrPromise,
    ]);
    clearTimeout(timer);
    if (forceKillTimer) clearTimeout(forceKillTimer);

    const result = {
      profile: profile.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      success: !timedOut && code === 0,
      exitCode: code,
      signal,
      timedOut,
    };
    if (profile.outputPolicy === 'redacted') {
      result.stdout = redactText(stdout, values);
      result.stderr = redactText(stderr, values);
      result.outputTruncated = Buffer.byteLength(stdout) >= MAX_CAPTURE_BYTES || Buffer.byteLength(stderr) >= MAX_CAPTURE_BYTES;
    }
    await appendAudit(dataDir, {
      profile: result.profile,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      success: result.success,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      outputPolicy: profile.outputPolicy,
      outputTruncated: result.outputTruncated ?? false,
    });
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    for (const key of Object.keys(injected)) {
      injected[key] = '';
      delete injected[key];
    }
    values.fill('');
    if (child && timedOut && child.exitCode === null) child.kill('SIGKILL');
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Sort paths and normalize text line endings so npm archives and Git checkouts
// have the same fingerprint on macOS, Windows, and Linux.
export async function fingerprintTree(root, relative) {
  const hash = createHash('sha256');
  async function visit(file, label) {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Security evidence cannot contain symlinks');
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort()) {
        await visit(path.join(file, name), `${label}/${name}`);
      }
    } else if (stat.isFile()) {
      let bytes = await fs.readFile(file);
      if (/\.(?:[cm]?js|json|map|ts|cmd)$/.test(label) || label === 'scripts/launch-bitwarden-safe-mcp') {
        bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
      }
      hash.update(`${label}\0${bytes.length}\0`);
      hash.update(bytes);
    } else {
      throw new Error('Unsupported security evidence file');
    }
  }
  await visit(path.join(root, relative), relative);
  return hash.digest('hex');
}

export async function verifyEvidence(root, policy, lock, now = new Date()) {
  const expiry = Date.parse(policy.expires);
  if (policy.schemaVersion !== 1 || !Number.isFinite(expiry) || now.getTime() >= expiry) {
    throw new Error('Security reachability review has expired or is invalid');
  }
  for (const [relative, version] of Object.entries(policy.packages)) {
    const installed = JSON.parse(await fs.readFile(path.join(root, relative, 'package.json'), 'utf8'));
    if (lock.packages?.[relative]?.version !== version || installed.version !== version) {
      throw new Error(`Security review version changed: ${relative}`);
    }
  }
  for (const [relative, expected] of Object.entries(policy.evidence)) {
    if (await fingerprintTree(root, relative) !== expected) {
      throw new Error(`Security reachability evidence changed: ${relative}`);
    }
  }
}

// npm also flags parents of a vulnerable package. Resolve those edges to the
// actual advisories; never waive a parent package by name alone.
export function evaluateAudit(report, policy) {
  if (report.auditReportVersion !== 2 || report.error ||
      !report.vulnerabilities || typeof report.vulnerabilities !== 'object' ||
      Array.isArray(report.vulnerabilities) || !report.metadata?.vulnerabilities ||
      !Number.isInteger(report.metadata.vulnerabilities.total)) {
    throw new Error('npm returned an incomplete or invalid audit report');
  }
  const entries = report.vulnerabilities;
  if (Object.keys(entries).length !== report.metadata.vulnerabilities.total) {
    throw new Error('npm audit count does not match the report');
  }
  const reviewed = new Set();
  const visiting = new Set();
  const resolved = new Set();
  function review(name) {
    if (resolved.has(name)) return;
    const item = entries[name];
    if (!item || !Array.isArray(item.via) || item.via.length === 0 ||
        !Array.isArray(item.nodes) || item.nodes.length === 0 || visiting.has(name)) {
      throw new Error(`Unresolved audit dependency: ${name}`);
    }
    if (item.severity === 'critical') throw new Error(`Critical vulnerability: ${name}`);
    for (const node of item.nodes) {
      if (!Object.hasOwn(policy.packages, node)) {
        throw new Error(`Unreviewed vulnerable dependency path: ${node}`);
      }
    }
    visiting.add(name);
    for (const via of item.via) {
      if (typeof via === 'string') {
        review(via);
      } else {
        const exception = policy.exceptions.find((entry) =>
          entry.package === name && entry.url === via.url &&
          entry.range === via.range && entry.severity === via.severity);
        if (!exception || item.fixAvailable !== false) {
          throw new Error(`Unreviewed or fixable vulnerability: ${via.url ?? name}`);
        }
        reviewed.add(via.url);
      }
    }
    visiting.delete(name);
    resolved.add(name);
  }
  for (const [name, item] of Object.entries(entries)) {
    if (item.severity === 'high' || item.severity === 'critical') review(name);
    else if (!['info', 'low', 'moderate'].includes(item.severity)) {
      throw new Error(`Unknown audit severity: ${name}`);
    }
  }
  return [...reviewed].sort();
}

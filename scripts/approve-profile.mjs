#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import process from 'node:process';
import { approveProfile, readPendingProfile } from '../server/lib/profiles.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function nativeConfirm(message) {
  if (process.platform === 'darwin') {
    const script = 'display dialog (system attribute "BW_APPROVAL_TEXT") buttons {"Cancel", "Approve"} default button "Cancel" cancel button "Cancel" with title "Bitwarden Agent Safe"';
    const result = spawnSync('osascript', ['-e', script], {
      env: { ...process.env, BW_APPROVAL_TEXT: message },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return result.status === 0 && result.stdout.includes('Approve');
  }
  if (process.platform === 'win32') {
    const command = [
      'Add-Type -AssemblyName PresentationFramework;',
      '$result=[System.Windows.MessageBox]::Show($env:BW_APPROVAL_TEXT,"Bitwarden Agent Safe","YesNo","Warning");',
      'if ($result -eq "Yes") { exit 0 } else { exit 1 }',
    ].join(' ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', command], {
      env: { ...process.env, BW_APPROVAL_TEXT: message },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return result.status === 0;
  }
  return null;
}

async function ttyConfirm(message, proposalId) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  process.stdout.write(`${message}\n\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type APPROVE ${proposalId} to approve: `);
  rl.close();
  return answer === `APPROVE ${proposalId}`;
}

const dataDir = argument('--data-dir');
const proposalId = argument('--proposal');
if (!dataDir || !proposalId) {
  console.error('Usage: node approve-profile.mjs --data-dir <path> --proposal <id>');
  process.exit(2);
}

const pending = await readPendingProfile(dataDir, proposalId);
const message = [
  `Approve profile: ${pending.proposal.name}`,
  `Executable: ${pending.proposal.executable}`,
  `Arguments: ${JSON.stringify(pending.proposal.args)}`,
  `Working directory: ${pending.proposal.cwd}`,
  `Watched files: ${JSON.stringify(pending.proposal.watchedFiles)}`,
  `Secret bindings: ${pending.proposal.secretBindings.map((binding) => `${binding.env} <- item ${binding.itemId} / ${binding.field}`).join(', ')}`,
  `Timeout: ${pending.proposal.timeoutSeconds}s`,
  `Output policy: ${pending.proposal.outputPolicy}`,
  '',
  'The approved program can access the selected Bitwarden fields.',
].join('\n');

const native = nativeConfirm(message);
const approved = native === null ? await ttyConfirm(message, proposalId) : native;
if (!approved) {
  console.error('Profile approval cancelled.');
  process.exit(1);
}

const record = await approveProfile(dataDir, proposalId);
console.log(`Approved profile ${record.profile.name}.`);

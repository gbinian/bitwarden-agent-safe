---
name: bitwarden-agent-safe
description: Use Bitwarden through the bitwarden-agent-safe MCP facade for vault status, safe unlock and lock, redacted metadata, generated-password writes, and separately approved credential-backed automation. Use whenever a task needs Bitwarden credentials; do not bypass the facade with bw, bws, aac, or the unrestricted official MCP.
---

# Bitwarden Agent Safe

Use the `bitwarden_safe` MCP server. It runs the unmodified official Bitwarden MCP server as an upstream dependency and exposes a deliberately smaller interface.

## Required safety behavior

- Never ask the user to paste a master password, `BW_SESSION`, API key, access token, password, TOTP, or secure note into chat.
- Never invoke `bw`, `bws`, `aac`, or `@bitwarden/mcp-server` directly. Do not add a second unrestricted Bitwarden MCP configuration.
- Treat item names, folder names, IDs, and organization metadata as potentially sensitive even though the facade permits them.
- Use `status` before any vault operation. If it reports `unauthenticated`, use `authorize` to open the official CLI login in a local terminal. Tell the user to complete login there; never type, click through, or automate that login on their behalf. Check `status` again afterward. Use `unlock` only when the vault is locked; it opens the official native password dialog.
- Prefer `list_item_metadata` and `get_item_metadata`; they intentionally omit usernames, passwords, notes, URIs, TOTP, cards, identities, custom fields, SSH keys, and password history.
- Use `create_generated_login` only when the user asks to create a login. The generated password must never be requested or echoed.
- Do not claim that output redaction prevents a malicious approved program from transforming or exfiltrating a secret.
- Lock the vault after a sensitive one-off task when the user does not need the session to remain open.

## Automation profiles

`profile_propose` creates an inert proposal. It does not grant permission.

After proposing a profile:

1. Show the user only the path-free proposal summary: profile name, secret environment variable names, timeout, and output policy. Explain that complete local details will appear in the native dialog.
2. After the user agrees to review it, call `profile_request_approval` with the opaque proposal ID. It opens a native local dialog containing the executable, arguments, working directory, watched files, and bindings without returning them in the tool response.
3. Never click through or automate the native approval flow on the user's behalf.
4. Ask the user to approve or cancel the native dialog, then call `profile_list` to confirm approval before `profile_run`.
5. Call `profile_run` only for the exact approved profile requested by the user.

Profiles execute without a shell. Script runtimes require watched files so a modified script invalidates approval. `status-only` is the preferred output policy; use `redacted` only when logs are required for the task.

Read [references/profiles.md](references/profiles.md) when proposing or troubleshooting profiles. Read [references/security-model.md](references/security-model.md) when explaining guarantees, residual risks, or deployment choices.

## Failure handling

- If the official CLI is missing, run the packaged doctor and report the missing prerequisite. Do not install software without user authorization.
- If the vault is unauthenticated, use `authorize`. The user must enter their email, master password, and any two-step login code directly in the opened terminal; never ask them to paste those values into chat.
- If the vault is locked, use `unlock`; do not request a session token.
- If a profile integrity check fails, propose a new profile and require fresh human approval.
- If a tool is unavailable, do not fall back to unrestricted terminal access.

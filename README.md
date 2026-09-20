# Bitwarden Agent Safe

Bitwarden Agent Safe is a cross-platform Codex plugin that runs the official Bitwarden MCP server behind a deny-by-default safety facade. It supports macOS and Windows and pins both the official MCP server and Bitwarden CLI as local package dependencies.

It is intentionally local-only. No remote MCP endpoint, proxy service, telemetry, or custom Bitwarden authentication implementation is included.

## Three stages included

1. Safe official session controls: first-use authorization, status, native unlock, lock, and sync.
2. Selective safe operations: redacted metadata, generated-password login creation, and folder creation.
3. Thin automation policy: separately approved, integrity-pinned execution profiles with secret environment injection.

The plugin does not expose the official `get`, `list`, delete, Send, attachment, device-approval, or organization-administration tools directly.

## Prerequisites

- macOS or Windows.
- Codex Desktop with its bundled Node.js 22 or newer runtime. The launcher falls back to a system Node.js 22+ runtime when necessary.
- A Bitwarden account. First-use login can be started from the plugin and is completed in a local terminal.

The plugin does not depend on the active NVM version at runtime. It launches through Codex's bundled Node runtime when available and invokes its pinned local `@bitwarden/cli` JavaScript entry point directly.

## Setup and verification

Run from the plugin directory:

```text
node scripts/setup.mjs
node scripts/doctor.mjs
npm test
npm run validate:package
```

The setup installs the exact versions recorded in `package-lock.json`, including the local Bitwarden CLI. It does not log in, unlock a vault, or read credentials. Running setup from a source checkout still requires Node.js 22+; the installed Codex plugin uses the bundled runtime launcher afterward.

On Windows, run the same commands in PowerShell. On macOS, the same commands work in Terminal. The packaged launchers include both POSIX and Windows runtime discovery implementations.

Install the plugin through a Codex local or repository marketplace. The optional `policies/codex-safe-config.toml` file shows a defense-in-depth Codex approval configuration; review it before merging equivalent settings into your own Codex configuration.

After installing, start a new Codex task so the packaged skill and MCP server are loaded from the installed plugin cache.

Choose **Connect my Bitwarden account securely and check whether the vault is ready** from the plugin's Try Now prompts. If the CLI is not authenticated, the plugin opens a local terminal running the official `bw login` flow. Enter the email address, master password, and any two-step login code only in that terminal. Those values never pass through MCP or Codex. After login, ask Codex to check status again; if the vault is locked, the existing `unlock` tool opens the official native password dialog.

## Exposed tools

| Stage | Tools | Boundary |
| --- | --- | --- |
| 1 | `status`, `authorize`, `unlock`, `lock`, `sync` | `authorize` opens the official CLI login in a local terminal; credentials never cross MCP. `status` returns only the vault state. |
| 2 | `list_item_metadata`, `get_item_metadata`, `create_generated_login`, `create_folder` | Fixed metadata allowlist; generated passwords are never returned. |
| 3 | `profile_propose`, `profile_request_approval`, `profile_list`, `profile_run` | Native human approval, HMAC-signed profiles, executable/file hashes, no shell, minimal child environment, status-only audit. |

The unrestricted official server must not be registered alongside this facade in the same agent session, because that would restore direct secret-reading and destructive tools.

## Approval profiles

Use `profile_propose` to create a pending profile. It returns only an opaque proposal ID and a path-free summary. After reviewing that summary, use `profile_request_approval` to open a native local confirmation dialog. Local executable paths, working directories, watched files, and Bitwarden item bindings are displayed only in that dialog and are not echoed in the tool response. The agent must never click or automate the approval.

Vault item names and IDs are metadata, not public data. Metadata tools return selected names and identifiers to Codex, and values supplied as tool arguments—such as a username, URI, local path, or item ID—are visible to the model and may appear in tool history. Passwords, TOTP values, notes, and generated passwords are never returned by the facade.

See the packaged skill references for the profile schema and security boundaries.

## Verification status

- The test suite uses a fake `bw` executable and the real pinned official MCP package to exercise the full stdio chain without reading a vault.
- GitHub Actions is configured to run the same tests on `macos-latest` and `windows-latest`.
- A real Bitwarden CLI/vault smoke test is intentionally not automatic because it would require user credentials and could mutate a vault.
- Run `node scripts/doctor.mjs` before first use. It checks prerequisites only and does not read credentials.

## Dependency security maintenance

The official Bitwarden CLI and MCP server remain exact-version pinned for reproducibility. Dependabot checks both packages every day and opens separate update pull requests. Each update must pass the macOS and Windows facade tests before human review and merge; dependency updates are never auto-merged.

A separate daily workflow checks the public npm advisory database for high or critical production vulnerabilities and fails when either Bitwarden package is no longer current. Known vulnerable CLI transitive dependencies are overridden to reviewed patched releases until Bitwarden incorporates those versions upstream. Do not run `npm audit fix --force`: npm may propose downgrading the calendar-versioned Bitwarden CLI to an older incompatible release.

## Distribution

This source plugin is interpreted JavaScript, not a native `.app`, `.pkg`, `.exe`, or `.msi`, so Apple notarization and Windows Authenticode do not apply to the source archive itself. Use the lockfile, release checksum, protected release tags, and CI provenance for source distribution. If a native installer is added later, sign/notarize that installer separately; see `docs/distribution.md`.

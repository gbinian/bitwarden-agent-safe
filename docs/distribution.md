# Distribution and signing

## Current artifact

The plugin is distributed as source plus `package-lock.json`. It installs exact dependency versions with lifecycle scripts disabled, including the official Bitwarden CLI. In Codex Desktop it prefers Codex's bundled Node.js runtime and falls back to a compatible system runtime. The release archive must exclude `node_modules`, local profile data, audit logs, and credentials.

For each release:

1. Run the macOS and Windows CI matrix.
2. Run `npm audit --omit=dev` against the public npm registry.
3. Validate both plugin manifests and the skill.
4. Build the source archive without `node_modules`.
5. Publish a SHA-256 checksum and sign the release/tag using the hosting platform's supported provenance or signing mechanism.
6. Review any update to `@bitwarden/mcp-server` or `@bitwarden/cli` before changing either exact version pin.

Dependabot checks both Bitwarden packages daily and creates reviewable pull requests. The scheduled security-maintenance workflow also checks high-severity production advisories and whether either pinned package has a newer release. Keep updates separate and require the cross-platform facade tests; do not auto-merge security-sensitive dependency changes.

## Native installers

Apple signing/notarization and Windows Authenticode are not useful for a plain source archive. They become relevant only if the project later ships a native app, executable, package, or installer.

- macOS: sign every executable/bundle with Developer ID and notarize the final distribution artifact.
- Windows: Authenticode-sign PowerShell scripts, executables, and installers as applicable; timestamp signatures so they remain valid after certificate expiry.
- Keep signing keys outside CI wherever possible. Prefer short-lived or managed signing identities and protected release environments.

Signing services and developer identities can incur recurring fees. Treat cost and identity-provider selection as a release-management decision, not as part of vault access or MCP runtime design.

## Public OpenAI catalog limitation

The current plugin uses a local stdio MCP server so vault traffic remains on the user's computer. OpenAI's public plugin submission path normally expects a remote HTTPS MCP endpoint; do not move this password-manager bridge to a public network service merely to satisfy catalog submission. Use local/private marketplace distribution unless OpenAI explicitly approves local MCP packaging for the submission.

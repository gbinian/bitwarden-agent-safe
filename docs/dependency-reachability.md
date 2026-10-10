# Dependency reachability review

Reviewed on 2026-10-10 for Bitwarden CLI **2026.9.1**, Bitwarden MCP
**2026.7.0**, and MCP SDK **1.31.0**. The two temporary exceptions below
expire on **2026-11-09 at 00:00 UTC** and require a new review by that date.

This is an assessment of the published packages used by this facade, not a
claim that the dependency packages themselves are fixed. A raw `npm audit`
still reports two root advisories and eight affected dependency nodes.

| Advisory | Vulnerable operation | Facade reachability and disposition |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Deeply nested brace pattern parsing/expansion in `braces` <=3.0.3 | Temporary unreachable exception; no patched release available at review time. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | RSA PKCS#1 v1.5 signature verification in `node-forge` <=1.4.0 | Temporary unreachable exception; no patched release available at review time. |
| [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) | HTTP OAuth client credential forwarding in MCP SDK <1.31.0 | Upgraded the direct dependency and upstream MCP's nested dependency to 1.31.0 using an npm override. The facade uses stdio, not HTTP OAuth. No exception. |

## braces

The only installed dependency chain is:

```text
@bitwarden/mcp-server -> shx -> shelljs -> fast-glob -> micromatch -> braces
```

The upstream manifest uses `shx` only in its build script (`tsc && shx chmod
+x dist/*.js`). The facade launches the already-built `dist/index.js` directly.
None of the published MCP runtime modules or facade runtime modules imports
`shx`, `shelljs`, `fast-glob`, `micromatch`, or `braces`. Setup and CI use
`npm ci --ignore-scripts` and never invoke that upstream build script. Vault
search strings are passed as literal CLI arguments; they are not glob patterns.

A runtime tripwire rejects loading any of those five packages while exercising
the real upstream MCP's status and item listing handlers with a fake CLI.

## node-forge

`node-forge` is an external dependency of the published CLI. In `build/bw.js`,
`require("node-forge")` assigns `external_node_forge_namespaceObject`; that
identifier is not subsequently used. The legacy code retained in the bundle
mentions MD5, UTF-8 conversion, HMAC, and AES operations through unused import
variables. None of the three published JavaScript bundles calls forge's RSA
signature verification API. The reviewed RSA operations in the CLI delegate to
Bitwarden's SDK `PureCrypto`; the facade signs execution profiles using Node's
`node:crypto` HMAC implementation, not forge.

A tripwire confirms that the real CLI loads forge and still completes
`--version` and unauthenticated `status` with access to forge's `pki`, `rsa`,
and `pkcs1` APIs blocked. It runs with a temporary HOME and CLI data directory
and without vault credentials. This smoke test supports, but does not replace,
the static review of all CLI bundles. Authenticated vault operations were not
performed as part of this review.

## Enforced boundaries

`npm run audit:security` fetches a fresh npm audit report from the official
registry. It reports each accepted advisory explicitly. It accepts only these
two exact advisory URLs, package names, severity levels, and affected ranges,
and only when npm reports no fix. It resolves npm's parent vulnerability edges
back to their root advisories rather than ignoring parent packages by name.
Unknown advisories, critical findings, new installation paths, cycles, invalid
reports, and registry/command errors fail the check.

Before accepting any exception, the gate verifies the installed and lockfile
versions and SHA-256 fingerprints of the reviewed CLI build directory, MCP
runtime directory, complete facade `server` directory, setup script, and both
launchers. Fingerprints normalize text line endings for cross-platform Git
checkouts. Version or runtime code changes require renewed reachability review;
do not regenerate hashes merely to make CI green. The policy is recorded in
`policies/dependency-reachability.json` and is enforced in daily security CI and
the macOS/Windows CI matrix. Freshness checks for both Bitwarden packages remain
enabled. When a fix appears, upgrade and remove the relevant exception.

This assessment covers the bundled facade's supported execution paths. It does
not extend to arbitrary programs approved through an execution profile, manual
use of different CLI packages, rebuilding upstream packages, or a compromised
local account. No runtime library code is patched and no cryptographic checks
are disabled in the shipped plugin; tripwires exist only in tests.

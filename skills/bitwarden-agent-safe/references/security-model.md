# Security model

## Trust boundary

The model and prompt content are not trusted with secret values. The plugin process and the unmodified official Bitwarden MCP child process handle secrets in memory. An approved target process receives selected values through its environment and is therefore trusted for those values.

## Guaranteed by construction

- The exposed MCP surface contains no generic `get_secret`, unrestricted `get`, unrestricted `list`, delete, Send, attachment, organization-administration, or device-approval tool.
- Metadata tools parse the official MCP response and construct a new object from a fixed allowlist.
- Generated passwords are created upstream and passed directly into an upstream create operation; they are not included in the facade response.
- Profiles are stored outside the workspace, signed with a local approval key, and tied to executable and watched-file SHA-256 digests.
- Profile execution uses direct process spawning with `shell: false`.
- The default profile output policy returns no child stdout or stderr.
- Audit events omit secret values and Bitwarden item IDs.
- Profile proposal and listing responses omit executable paths, working directories, watched files, item IDs, and plugin data paths. These details remain local to the native approval dialog.
- Underlying filesystem, CLI, and upstream MCP errors are replaced with a fixed public error response.
- The upstream official MCP receives only an environment allowlist needed for the CLI, native dialogs, local storage, and enterprise network plumbing. Organization API credentials and unrelated host variables are not inherited.

## Residual risks

- A trusted target program can print, encode, persist, or transmit any secret it receives. Exact, URL-encoded, and base64 output redaction reduces accidental disclosure but cannot stop deliberate transformation.
- JavaScript strings cannot be reliably zeroized by application code. Secret values may remain in process memory until garbage collection or process exit.
- Malware, debuggers, administrators, crash dump collectors, and other processes running with sufficient local privilege may inspect memory or child environments.
- MCP restriction does not remove a separate shell tool's ability to call `bw` as the same OS user. Enforce shell/tool restrictions in the host, or use a separate OS identity, when this must be a hard security boundary.
- Item names and IDs are metadata, not public data.
- Tool arguments are visible to the model. Usernames, URIs, local paths, item IDs, and other values deliberately supplied to a tool may remain in the conversation or tool history even when the response does not echo them.
- The official Bitwarden MCP package is pinned, but upgrading it requires a new review of tools and response shapes.

## Dependency boundary

The plugin does not implement Bitwarden authentication, encryption, sync, or vault formats. Those remain in `@bitwarden/mcp-server` and the official `bw` CLI. Its authorization entry only opens the official interactive `bw login` flow in a local terminal; login inputs never cross MCP. The safety facade is responsible only for tool reduction, response filtering, profile approval, direct process execution, and audit records.

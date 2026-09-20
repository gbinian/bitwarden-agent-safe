# Security

Bitwarden Agent Safe is a local safety facade, not a password manager and not a cryptographic implementation. It starts the unmodified official Bitwarden MCP server as a child process and deliberately exposes fewer tools.

Do not configure the unrestricted official server separately in the same Agent session. Do not place `BW_SESSION`, master passwords, organization API credentials, or Secrets Manager access tokens in plugin manifests or project files.

The default profile output policy is `status-only`. An approved target program is trusted with every bound secret and can deliberately transform or transmit it; redaction only reduces accidental disclosure.

Metadata is not secret-free. Item names, IDs, folder and organization identifiers, profile names, environment variable names, and values supplied in tool arguments may be visible to Codex and retained in tool history. The profile proposal and listing responses do not echo executable paths, working directories, watched files, item IDs, or plugin data paths; those details are shown only in the native local approval dialog.

Underlying filesystem, CLI, and upstream MCP error details are suppressed at the facade boundary so absolute paths and unexpected diagnostic content are not returned to Codex.

This plugin restricts the MCP tool surface; it is not an operating-system sandbox. A general-purpose shell running as the same user could still invoke `bw` directly or modify plugin data. For a hard boundary, the host policy must deny unapproved shell access to the Bitwarden CLI and plugin data, or the facade must run under a separate restricted OS identity. The packaged skill and Codex tool policy are defense in depth, not substitutes for OS isolation.

Report suspected vulnerabilities without including real credentials, vault exports, or session tokens.

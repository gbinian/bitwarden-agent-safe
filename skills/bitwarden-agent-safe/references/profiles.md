# Approved automation profiles

## Proposal fields

- `name`: lower-case kebab-case identifier.
- `executable`: absolute path to a regular executable file.
- `args`: exact argument vector. Shell syntax is not interpreted.
- `cwd`: absolute working directory.
- `watchedFiles`: files whose SHA-256 digests must remain unchanged. Required when the executable is a script runtime such as Node, Python, PowerShell, Bash, or Ruby.
- `secretBindings`: environment name, exact Bitwarden item ID, and one field from `password`, `username`, `totp`, or `notes`.
- `timeoutSeconds`: 1 to 3600.
- `outputPolicy`: `status-only` or `redacted`.

## Example proposal

```json
{
  "name": "deploy-staging",
  "description": "Deploy the reviewed staging build",
  "executable": "/absolute/path/to/node",
  "args": ["/absolute/path/to/deploy.mjs", "--environment", "staging"],
  "cwd": "/absolute/path/to/project",
  "watchedFiles": ["/absolute/path/to/deploy.mjs"],
  "secretBindings": [
    {
      "env": "DEPLOY_TOKEN",
      "itemId": "exact-bitwarden-item-id",
      "field": "password"
    }
  ],
  "timeoutSeconds": 900,
  "outputPolicy": "status-only"
}
```

Windows profiles use Windows absolute paths and should point to a real `.exe`. For Node or PowerShell scripts, approve the runtime executable and include every security-relevant script in `watchedFiles`.

## Approval

The proposal tool returns an opaque proposal ID and a summary that omits local paths and Bitwarden item IDs. After the user agrees to review the proposal, call `profile_request_approval` with that ID. It opens a native local dialog that displays the complete profile and requires direct human confirmation. The agent must not click or automate this dialog. After the user responds, call `profile_list` to confirm whether approval succeeded.

## Reapproval

If the executable or any watched file changes, `profile_run` fails. Create a new proposal and obtain fresh approval rather than editing files in the approved-profile directory.

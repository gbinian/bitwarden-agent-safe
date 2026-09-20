import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);

function officialEntryPoint() {
  const packageJson = require.resolve('@bitwarden/mcp-server/package.json');
  return path.join(path.dirname(packageJson), 'dist', 'index.js');
}

const OFFICIAL_ENV_ALLOWLIST = new Set([
  'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'BITWARDENCLI_APPDATA_DIR', 'BW_CLI_PATH', 'BW_SESSION',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]);

function inheritedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(
    ([key, value]) => OFFICIAL_ENV_ALLOWLIST.has(key) && typeof value === 'string',
  ));
}

export class OfficialBitwardenMcp {
  #client;
  #transport;
  #connecting;

  async connect() {
    if (this.#client) return;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const client = new Client(
        { name: 'bitwarden-agent-safe-upstream', version: '0.1.0' },
        { capabilities: {} },
      );
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [officialEntryPoint()],
        env: inheritedEnvironment(),
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (chunk) => {
        void chunk;
      });
      await client.connect(transport);
      this.#client = client;
      this.#transport = transport;
    })();

    try {
      await this.#connecting;
    } finally {
      this.#connecting = undefined;
    }
  }

  async call(name, args = {}) {
    await this.connect();
    const result = await this.#client.callTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(`Official Bitwarden MCP tool ${name} failed`);
    }
    return result;
  }

  async close() {
    if (this.#client) await this.#client.close();
    this.#client = undefined;
    this.#transport = undefined;
  }
}

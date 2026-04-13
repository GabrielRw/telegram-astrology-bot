const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

class FreeAstroMcpService {
  constructor() {
    this.client = null;
    this.transport = null;
    this.tools = null;
    this.toolNameMap = new Map();
  }

  getServerUrl() {
    return process.env.FREEASTRO_MCP_URL || 'https://api.freeastroapi.com/mcp';
  }

  sanitizeToolName(name) {
    const normalized = String(name || '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    const safe = normalized || 'tool';
    return `mcp_${safe}`.slice(0, 64);
  }

  async ensureConnected() {
    if (this.client) {
      return;
    }

    this.client = new Client(
      { name: 'telegram-astrology-bot', version: '1.0.0' },
      { capabilities: {} }
    );

    this.transport = new StreamableHTTPClientTransport(new URL(this.getServerUrl()), {
      requestInit: {
        headers: {
          'x-api-key': process.env.FREEASTRO_API_KEY
        }
      }
    });

    await this.client.connect(this.transport);
  }

  async listTools() {
    await this.ensureConnected();

    if (this.tools) {
      return this.tools;
    }

    const result = await this.client.listTools();
    this.tools = Array.isArray(result?.tools) ? result.tools : [];
    this.toolNameMap = new Map(
      this.tools.map((tool) => [this.sanitizeToolName(tool.name), tool.name])
    );
    return this.tools;
  }

  async getFunctionDeclarations() {
    const tools = await this.listTools();

    return tools.map((tool) => ({
      name: this.sanitizeToolName(tool.name),
      description: `[FreeAstro MCP] ${tool.description || tool.name}`,
      parameters: tool.inputSchema || {
        type: 'object',
        properties: {}
      }
    }));
  }

  async callSanitizedTool(name, args) {
    await this.listTools();

    const originalName = this.toolNameMap.get(name);

    if (!originalName) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }

    const result = await this.client.callTool({
      name: originalName,
      arguments: args || {}
    });

    const textContent = Array.isArray(result?.content)
      ? result.content
          .filter((item) => item?.type === 'text' && item.text)
          .map((item) => item.text)
          .join('\n')
      : '';

    return {
      tool: originalName,
      structuredContent: result?.structuredContent || null,
      text: textContent || null,
      isError: Boolean(result?.isError)
    };
  }

  isMcpTool(name) {
    return this.toolNameMap.has(name);
  }
}

module.exports = new FreeAstroMcpService();

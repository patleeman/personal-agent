import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  parseMcpCliServerInfo,
  parseMcpCliToolInfo,
  readMcpCliConfig,
  resolveMcpCliConfig,
} from './mcp-cli.js';

describe('mcp-cli config helpers', () => {
  it('reads configured servers from mcp_servers.json', () => {
    const cwd = join(tmpdir(), `pa-mcp-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'mcp_servers.json'), JSON.stringify({
      mcpServers: {
        atlassian: {
          command: 'npx',
          args: ['-y', 'mcp-remote@latest', 'https://mcp.atlassian.com/v1/mcp'],
        },
        local: {
          command: 'node',
          args: ['server.js'],
          cwd: '/tmp/mcp',
          env: { TOKEN: 'secret', NUMBER: 1 },
        },
      },
    }, null, 2));

    const result = readMcpCliConfig({ cwd });
    expect(result.exists).toBe(true);
    expect(result.path).toBe(join(cwd, 'mcp_servers.json'));
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0]).toMatchObject({
      name: 'atlassian',
      command: 'npx',
      args: ['-y', 'mcp-remote@latest', 'https://mcp.atlassian.com/v1/mcp'],
      url: 'https://mcp.atlassian.com/v1/mcp',
    });
    expect(result.servers[1]).toMatchObject({
      name: 'local',
      command: 'node',
      args: ['server.js'],
      cwd: '/tmp/mcp',
      env: { TOKEN: 'secret' },
    });
  });

  it('resolves an explicit config path relative to cwd', () => {
    const cwd = join(tmpdir(), `pa-mcp-explicit-${Date.now()}`);
    mkdirSync(join(cwd, 'config'), { recursive: true });
    writeFileSync(join(cwd, 'config', 'servers.json'), JSON.stringify({ mcpServers: {} }));

    const result = resolveMcpCliConfig({ cwd, configPath: './config/servers.json' });
    expect(result.path).toBe(join(cwd, 'config', 'servers.json'));
    expect(result.exists).toBe(true);
  });
});

describe('mcp-cli output parsers', () => {
  it('parses server info output', () => {
    const output = `Server: atlassian\nTransport: stdio\nCommand: npx -y mcp-remote@latest https://mcp.atlassian.com/v1/mcp\n\nTools (2):\n  getConfluencePage\n    Parameters:\n      • cloudId (string, required)\n  search\n    Parameters:\n      • query (string, required)\n`;

    const info = parseMcpCliServerInfo(output);
    expect(info.server).toBe('atlassian');
    expect(info.transport).toBe('stdio');
    expect(info.commandLine).toContain('mcp-remote@latest');
    expect(info.toolCount).toBe(2);
    expect(info.tools.map((tool) => tool.name)).toEqual(['getConfluencePage', 'search']);
  });

  it('parses tool info output with JSON schema', () => {
    const output = `Tool: getConfluencePage\nServer: atlassian\n\nDescription:\n  Get a Confluence page by page ID.\n\nInput Schema:\n{\n  "type": "object",\n  "properties": {\n    "cloudId": { "type": "string" },\n    "pageId": { "type": "string" }\n  },\n  "required": ["cloudId", "pageId"]\n}`;

    const info = parseMcpCliToolInfo(output);
    expect(info.tool).toBe('getConfluencePage');
    expect(info.server).toBe('atlassian');
    expect(info.description).toBe('Get a Confluence page by page ID.');
    expect(info.schema).toMatchObject({
      type: 'object',
      required: ['cloudId', 'pageId'],
    });
  });
});

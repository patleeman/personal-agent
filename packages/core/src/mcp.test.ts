import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  callMcpTool,
  inspectMcpServer,
  inspectMcpTool,
  listMcpCatalog,
  readMcpConfig,
  readMcpConfigDocument,
  resolveMcpConfig,
} from './mcp.js';
import { buildMergedMcpConfigDocument, readBundledSkillMcpManifests } from './mcp-bundled-config.js';

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('mcp config helpers', () => {
  it('reads configured servers from mcp_servers.json', () => {
    const cwd = makeTempDir('pa-mcp-config');
    writeFileSync(
      join(cwd, 'mcp_servers.json'),
      JSON.stringify(
        {
          mcpServers: {
            atlassian: {
              command: 'npx',
              args: ['-y', 'mcp-remote@latest', 'https://mcp.atlassian.com/v1/mcp', '--resource', 'https://datadoghq.atlassian.net/'],
            },
            slack: {
              type: 'remote',
              url: 'https://mcp.slack.com/mcp',
              callback: { host: 'localhost', port: 3118, path: '/callback' },
              oauth: { clientId: 'client-123' },
            },
            local: {
              command: 'node',
              args: ['server.mjs'],
              cwd: '/tmp/mcp',
              env: { TOKEN: 'secret', NUMBER: 1 },
            },
          },
        },
        null,
        2,
      ),
    );

    const result = readMcpConfig({ cwd });
    expect(result.exists).toBe(true);
    expect(result.path).toBe(join(cwd, 'mcp_servers.json'));
    expect(result.servers).toHaveLength(3);
    expect(result.servers[0]).toMatchObject({
      name: 'atlassian',
      transport: 'remote',
      url: 'https://mcp.atlassian.com/v1/mcp',
      authorizeResource: 'https://datadoghq.atlassian.net/',
    });
    expect(result.servers[1]).toMatchObject({
      name: 'local',
      transport: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      cwd: '/tmp/mcp',
      env: { TOKEN: 'secret' },
    });
    expect(result.servers[2]).toMatchObject({
      name: 'slack',
      transport: 'remote',
      url: 'https://mcp.slack.com/mcp',
      callbackHost: 'localhost',
      callbackPort: 3118,
      callbackPath: '/callback',
    });
  });

  it('resolves an explicit config path relative to cwd', () => {
    const cwd = makeTempDir('pa-mcp-explicit');
    mkdirSync(join(cwd, 'config'), { recursive: true });
    writeFileSync(join(cwd, 'config', 'servers.json'), JSON.stringify({ mcpServers: {} }));

    const result = resolveMcpConfig({ cwd, configPath: './config/servers.json' });
    expect(result.path).toBe(join(cwd, 'config', 'servers.json'));
    expect(result.exists).toBe(true);
  });

  it('lists configured servers without probing by default', async () => {
    const cwd = makeTempDir('pa-mcp-list');
    writeFileSync(
      join(cwd, 'mcp_servers.json'),
      JSON.stringify(
        {
          mcpServers: {
            broken: {
              command: '/definitely/not/a/real/command',
              args: [],
            },
          },
        },
        null,
        2,
      ),
    );

    const catalog = await listMcpCatalog({ cwd });
    expect(catalog.probed).toBe(false);
    expect(catalog.servers).toEqual([{ name: 'broken' }]);
  });

  it('merges skill-bundled mcp manifests ahead of explicit config discovery', () => {
    const cwd = makeTempDir('pa-mcp-bundled');
    const skillDir = join(cwd, 'skills', 'jira-helper');
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, 'mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            atlassian: {
              command: 'pa',
              args: ['mcp', 'serve', 'atlassian'],
            },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(cwd, 'mcp_servers.json'),
      JSON.stringify(
        {
          mcpServers: {
            github: {
              command: 'gh',
              args: ['mcp', 'serve'],
            },
            atlassian: {
              command: 'override',
              args: ['explicit'],
            },
          },
        },
        null,
        2,
      ),
    );

    const manifests = readBundledSkillMcpManifests([skillDir]);
    expect(manifests).toEqual([
      {
        skillName: 'jira-helper',
        skillDir,
        manifestPath: join(skillDir, 'mcp.json'),
        serverNames: ['atlassian'],
      },
    ]);

    const merged = buildMergedMcpConfigDocument({ cwd, skillDirs: [skillDir] });
    expect(merged.baseServerNames).toEqual(['atlassian', 'github']);
    expect(merged.searchedPaths).toEqual([
      join(cwd, 'mcp_servers.json'),
      join(homedir(), '.mcp_servers.json'),
      join(homedir(), '.config', 'mcp', 'mcp_servers.json'),
    ]);
    expect(merged.bundledServerCount).toBe(1);
    expect(merged.manifestPaths).toEqual([join(skillDir, 'mcp.json')]);
    expect(merged.document).toEqual({
      mcpServers: {
        atlassian: {
          command: 'override',
          args: ['explicit'],
        },
        github: {
          command: 'gh',
          args: ['mcp', 'serve'],
        },
      },
    });

    const parsed = readMcpConfigDocument({
      path: merged.baseConfigPath,
      exists: true,
      searchedPaths: merged.searchedPaths,
      document: merged.document,
    });
    expect(parsed.servers.map((server) => server.name)).toEqual(['atlassian', 'github']);
  });
});

describe('native MCP client', () => {
  it('inspects and calls a stdio server', async () => {
    const cwd = makeTempDir('pa-mcp-server');
    const sdkRoot = pathToFileURL(
      join(
        process.cwd(),
        'node_modules',
        '.pnpm',
        '@modelcontextprotocol+sdk@1.27.1_zod@4.3.6',
        'node_modules',
        '@modelcontextprotocol',
        'sdk',
        'dist',
        'esm',
      ),
    ).href;
    const zodUrl = pathToFileURL(join(process.cwd(), 'node_modules', '.pnpm', 'zod@4.3.6', 'node_modules', 'zod', 'v4', 'index.js')).href;
    const serverPath = join(cwd, 'server.mjs');

    writeFileSync(
      serverPath,
      `
import { McpServer } from '${sdkRoot}/server/mcp.js';
import { StdioServerTransport } from '${sdkRoot}/server/stdio.js';
import * as z from '${zodUrl}';

const server = new McpServer({ name: 'fixture-server', version: '1.0.0' });
server.registerTool('echo', {
  description: 'Echo text back to the caller.',
  inputSchema: { text: z.string() },
}, async ({ text }) => ({
  content: [{ type: 'text', text: String(text) }],
}));

await server.connect(new StdioServerTransport());
`,
      'utf-8',
    );

    writeFileSync(
      join(cwd, 'mcp_servers.json'),
      JSON.stringify(
        {
          mcpServers: {
            fixture: {
              command: process.execPath,
              args: [serverPath],
            },
          },
        },
        null,
        2,
      ),
    );

    const serverInfo = await inspectMcpServer('fixture', { cwd, withDescriptions: true });
    expect(serverInfo.exitCode).toBe(0);
    expect(serverInfo.data?.toolCount).toBe(1);
    expect(serverInfo.data?.tools[0]).toMatchObject({
      name: 'echo',
      description: 'Echo text back to the caller.',
    });

    const toolInfo = await inspectMcpTool('fixture', 'echo', { cwd });
    expect(toolInfo.exitCode).toBe(0);
    expect(toolInfo.data?.schema).toMatchObject({
      type: 'object',
      required: ['text'],
    });

    const toolResult = await callMcpTool('fixture', 'echo', { text: 'hello' }, { cwd });
    expect(toolResult.exitCode).toBe(0);
    expect(toolResult.data?.parsed).toMatchObject({
      content: [{ type: 'text', text: 'hello' }],
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createMcpAgentExtension, inspectMcpSettings } from './backend.js';

type ExtensionAPI = ReturnType<typeof createMcpAgentExtension> extends (api: infer A) => unknown ? A : never;

function createMockApi(): { api: ExtensionAPI; registeredExecute: (params: unknown) => Promise<unknown> } {
  let execute: ((toolCallId: string, params: unknown) => Promise<unknown>) | undefined;
  return {
    api: {
      registerTool: vi.fn((tool: { name: string; execute: (toolCallId: string, params: unknown) => Promise<unknown> }) => {
        execute = tool.execute;
      }),
    } as unknown as ExtensionAPI,
    registeredExecute: (params: unknown) => execute!('tool-call-id', params),
  };
}

vi.mock('@personal-agent/extensions/backend/mcp', () => ({
  listMcpCatalog: vi.fn(),
  inspectMcpServer: vi.fn(),
  inspectMcpTool: vi.fn(),
  grepMcpTools: vi.fn(),
  callMcpTool: vi.fn(),
  authenticateMcpServer: vi.fn(),
  clearMcpServerAuth: vi.fn(),
  buildMergedMcpConfigDocument: vi.fn(),
  readBundledSkillMcpManifests: vi.fn(),
  readMcpConfigDocument: vi.fn(),
  getDurableSessionsDir: vi.fn(() => '/tmp/durable-sessions'),
  getPiAgentRuntimeDir: vi.fn(() => '/tmp/pi-agent-runtime'),
  getConfigRoot: vi.fn(() => '/tmp/pi-agent-config'),
}));

const core = await import('@personal-agent/extensions/backend/mcp');

function buildHandler() {
  const { api, registeredExecute } = createMockApi();
  const ext = createMcpAgentExtension();
  ext(api);
  return registeredExecute;
}

describe('inspectMcpSettings', () => {
  it('returns extension-owned MCP settings state', () => {
    const context = {
      runtime: {
        getLiveSessionResourceOptions: () => ({
          cwd: '/repo',
          additionalSkillPaths: ['/skills/runtime/jira-helper'],
        }),
        getRepoRoot: () => '/repo',
      },
    };
    vi.mocked(core.readBundledSkillMcpManifests).mockReturnValue([
      {
        skillName: 'jira-helper',
        skillDir: '/skills/runtime/jira-helper',
        manifestPath: '/skills/runtime/jira-helper/mcp.json',
        serverNames: ['atlassian'],
      },
    ]);
    vi.mocked(core.buildMergedMcpConfigDocument).mockReturnValue({
      baseConfigPath: '/repo/.mcp.json',
      baseConfigExists: true,
      baseServerNames: ['github'],
      searchedPaths: ['/repo/.mcp.json'],
      bundledServerCount: 1,
      manifestPaths: ['/skills/runtime/jira-helper/mcp.json'],
      document: { mcpServers: {} },
    });
    vi.mocked(core.readMcpConfigDocument).mockReturnValue({
      path: '/repo/.mcp.json',
      exists: true,
      searchedPaths: ['/repo/.mcp.json'],
      servers: [
        {
          name: 'atlassian',
          transport: 'remote',
          args: [],
          url: 'https://mcp.atlassian.com/v1/mcp',
          callbackHost: 'localhost',
          callbackPort: 3118,
          callbackPath: '/callback',
          authorizeResource: 'https://datadoghq.atlassian.net/',
          oauthClientInfo: { client_id: 'test-client' },
          raw: {},
        },
        {
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['@mcp/github'],
          cwd: '/repo',
          raw: {},
        },
      ],
    });

    expect(inspectMcpSettings({}, context)).toMatchObject({
      configPath: '/repo/.mcp.json',
      configExists: true,
      servers: [
        {
          name: 'atlassian',
          source: 'skill',
          sourcePath: '/skills/runtime/jira-helper/mcp.json',
          hasOAuth: true,
          callbackUrl: 'http://localhost:3118/callback',
        },
        {
          name: 'github',
          source: 'config',
          sourcePath: '/repo/.mcp.json',
          hasOAuth: false,
        },
      ],
      bundledSkills: [
        {
          skillName: 'jira-helper',
          serverNames: ['atlassian'],
          overriddenServerNames: [],
        },
      ],
    });
    expect(core.buildMergedMcpConfigDocument).toHaveBeenCalledWith({
      cwd: '/repo',
      env: expect.not.objectContaining({ MCP_CONFIG_PATH: expect.any(String) }),
      skillDirs: ['/skills/runtime/jira-helper'],
    });
  });
});

describe('mcpAgentExtension', () => {
  describe('action: list', () => {
    it('reports when no MCP servers are configured', async () => {
      vi.mocked(core.listMcpCatalog).mockResolvedValue({
        config: { path: '/fake/mcp/config.json' },
        servers: [],
      });

      const handler = buildHandler();
      const result = await handler({ action: 'list' });

      expect(result.content[0].text).toContain('No MCP servers are configured');
      expect(result.details).toMatchObject({ action: 'list', serverCount: 0 });
    });

    it('lists servers with tool counts and descriptions when probing', async () => {
      vi.mocked(core.listMcpCatalog).mockResolvedValue({
        config: { path: '/fake/mcp/config.json' },
        servers: [
          {
            name: 'filesystem',
            info: {
              transport: 'stdio',
              toolCount: 3,
              tools: [
                { name: 'read', description: 'Read a file' },
                { name: 'write', description: 'Write a file' },
                { name: 'list', description: 'List directory' },
              ],
            },
          },
          {
            name: 'github',
            info: {
              transport: 'stdio',
              toolCount: 1,
              tools: [{ name: 'search', description: 'Search code' }],
            },
          },
        ],
      });

      const handler = buildHandler();
      const result = await handler({ action: 'list', probe: true });

      expect(result.content[0].text).toContain('filesystem');
      expect(result.content[0].text).toContain('3 tools');
      expect(result.content[0].text).toContain('read');
      expect(result.content[0].text).toContain('search');
      expect(result.details).toMatchObject({ serverCount: 2 });
    });

    it('shows error for servers that failed to probe', async () => {
      vi.mocked(core.listMcpCatalog).mockResolvedValue({
        config: { path: '/fake/mcp/config.json' },
        servers: [{ name: 'broken-server', error: 'connection refused' }],
      });

      const handler = buildHandler();
      const result = await handler({ action: 'list', probe: true });

      expect(result.content[0].text).toContain('broken-server');
      expect(result.content[0].text).toContain('connection refused');
    });
  });

  describe('action: info', () => {
    it('returns server info when no tool is specified', async () => {
      vi.mocked(core.inspectMcpServer).mockResolvedValue({
        data: {
          server: 'filesystem',
          transport: 'stdio',
          toolCount: 2,
          tools: [
            { name: 'read', description: 'Read file' },
            { name: 'write', description: 'Write file' },
          ],
        },
      });

      const handler = buildHandler();
      const result = await handler({ action: 'info', server: 'filesystem' });

      expect(result.content[0].text).toContain('Server: filesystem');
      expect(result.content[0].text).toContain('Transport: stdio');
      expect(result.content[0].text).toContain('read');
      expect(result.content[0].text).toContain('write');
    });

    it('returns tool info when tool is specified', async () => {
      vi.mocked(core.inspectMcpTool).mockResolvedValue({
        data: {
          server: 'filesystem',
          tool: 'read',
          description: 'Read a file',
          schema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      });

      const handler = buildHandler();
      const result = await handler({ action: 'info', server: 'filesystem', tool: 'read' });

      expect(result.content[0].text).toContain('Tool: filesystem/read');
      expect(result.content[0].text).toContain('Read a file');
      expect(result.content[0].text).toContain('"path"');
    });

    it('returns error when tool inspection fails', async () => {
      vi.mocked(core.inspectMcpTool).mockResolvedValue({
        data: undefined,
        error: 'Tool not found',
      });

      const handler = buildHandler();
      const result = await handler({ action: 'info', server: 'filesystem', tool: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool not found');
    });

    it('throws when server name is missing', async () => {
      const handler = buildHandler();
      const result = await handler({ action: 'info', server: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Server name is required');
    });
  });

  describe('action: grep', () => {
    it('finds matching tools across servers', async () => {
      vi.mocked(core.grepMcpTools).mockResolvedValue({
        matches: [
          { server: 'filesystem', tool: { name: 'search', description: 'Search files' } },
          { server: 'github', tool: { name: 'searchCode', description: 'Search code' } },
        ],
        errors: [],
      });

      const handler = buildHandler();
      const result = await handler({ action: 'grep', pattern: 'search' });

      expect(result.content[0].text).toContain('Matches for "search"');
      expect(result.content[0].text).toContain('filesystem/search');
      expect(result.content[0].text).toContain('github/searchCode');
      expect(result.details).toMatchObject({ matchCount: 2 });
    });

    it('reports zero matches', async () => {
      vi.mocked(core.grepMcpTools).mockResolvedValue({ matches: [], errors: [] });

      const handler = buildHandler();
      const result = await handler({ action: 'grep', pattern: 'zzz_nonexistent' });

      expect(result.content[0].text).toContain('No tools matched pattern');
      expect(result.details).toMatchObject({ matchCount: 0 });
    });

    it('includes grep errors in the output', async () => {
      vi.mocked(core.grepMcpTools).mockResolvedValue({
        matches: [{ server: 'fs', tool: { name: 'read', description: 'Read' } }],
        errors: [{ server: 'broken', error: 'timeout' }],
      });

      const handler = buildHandler();
      const result = await handler({ action: 'grep', pattern: 'read' });

      expect(result.content[0].text).toContain('Errors:');
      expect(result.content[0].text).toContain('broken: timeout');
    });
  });

  describe('action: call', () => {
    it('calls a tool with parsed JSON arguments', async () => {
      vi.mocked(core.callMcpTool).mockResolvedValue({
        data: { parsed: { result: 'success', data: [1, 2, 3] } },
      });

      const handler = buildHandler();
      const result = await handler({ action: 'call', server: 'filesystem', tool: 'read', arguments: '{"path":"/tmp"}' });

      expect(core.callMcpTool).toHaveBeenCalledWith('filesystem', 'read', { path: '/tmp' }, expect.any(Object));
      expect(result.content[0].text).toContain('"result"');
      expect(result.content[0].text).toContain('success');
    });

    it('handles call failures with error message', async () => {
      vi.mocked(core.callMcpTool).mockResolvedValue({
        data: undefined,
        error: 'Tool execution failed',
      });

      const handler = buildHandler();
      const result = await handler({ action: 'call', server: 'filesystem', tool: 'crash' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool execution failed');
    });

    it('validates JSON arguments', async () => {
      const handler = buildHandler();
      const result = await handler({ action: 'call', server: 'fs', tool: 't', arguments: 'not valid json{' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid JSON');
    });
  });

  describe('action: auth', () => {
    it('authenticates and reports available tools', async () => {
      vi.mocked(core.authenticateMcpServer).mockResolvedValue({
        data: { toolCount: 5 },
      });

      const handler = buildHandler();
      const result = await handler({ action: 'auth', server: 'github' });

      expect(result.content[0].text).toContain('Successfully authenticated github');
      expect(result.content[0].text).toContain('5 tools');
      expect(result.details).toMatchObject({ action: 'auth', server: 'github', toolCount: 5 });
    });

    it('returns error on auth failure', async () => {
      vi.mocked(core.authenticateMcpServer).mockResolvedValue({
        data: undefined,
        error: 'OAuth handshake failed',
      });

      const handler = buildHandler();
      const result = await handler({ action: 'auth', server: 'github' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('OAuth handshake failed');
    });
  });

  describe('action: logout', () => {
    it('clears OAuth state for the server', async () => {
      vi.mocked(core.clearMcpServerAuth).mockResolvedValue({ exitCode: 0 });

      const handler = buildHandler();
      const result = await handler({ action: 'logout', server: 'github' });

      expect(core.clearMcpServerAuth).toHaveBeenCalledWith('github', expect.any(Object));
      expect(result.content[0].text).toContain('Cleared stored OAuth state for github');
    });

    it('returns an error when clearing OAuth state fails', async () => {
      vi.mocked(core.clearMcpServerAuth).mockResolvedValue({ exitCode: 1, error: 'session not found' });

      const handler = buildHandler();
      const result = await handler({ action: 'logout', server: 'github' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('session not found');
    });
  });

  describe('validation', () => {
    it('handles unsupported actions', async () => {
      const handler = buildHandler();
      const result = await handler({ action: 'fly' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unsupported MCP action');
    });

    it('re-throws unexpected errors as error responses', async () => {
      vi.mocked(core.listMcpCatalog).mockRejectedValue(new Error('unexpected crash'));

      const handler = buildHandler();
      const result = await handler({ action: 'list' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('unexpected crash');
    });

    it('stringifies non-Error exceptions', async () => {
      vi.mocked(core.listMcpCatalog).mockRejectedValue('string rejection');

      const handler = buildHandler();
      const result = await handler({ action: 'list' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('string rejection');
    });
  });

  describe('registerTool', () => {
    it('registers the mcp tool on the API', () => {
      const { api, registeredExecute } = createMockApi();
      const ext = createMcpAgentExtension();
      const result = ext(api);

      expect(api.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'mcp' }));
      expect(result).toBe(api);
      expect(registeredExecute).toBeDefined();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  inspectAvailableToolsMock,
  inspectCliBinaryMock,
  inspectMcpServerMock,
  inspectMcpToolMock,
  installPackageSourceMock,
  listProfilesMock,
  logErrorMock,
  readMcpConfigMock,
  readPackageSourceTargetStateMock,
} = vi.hoisted(() => ({
  inspectAvailableToolsMock: vi.fn(),
  inspectCliBinaryMock: vi.fn(),
  inspectMcpServerMock: vi.fn(),
  inspectMcpToolMock: vi.fn(),
  installPackageSourceMock: vi.fn(),
  listProfilesMock: vi.fn(),
  logErrorMock: vi.fn(),
  readMcpConfigMock: vi.fn(),
  readPackageSourceTargetStateMock: vi.fn(),
}));

vi.mock('@personal-agent/resources', () => ({
  installPackageSource: installPackageSourceMock,
  listProfiles: listProfilesMock,
  readPackageSourceTargetState: readPackageSourceTargetStateMock,
}));

vi.mock('@personal-agent/core', () => ({
  inspectCliBinary: inspectCliBinaryMock,
  inspectMcpServer: inspectMcpServerMock,
  inspectMcpTool: inspectMcpToolMock,
  readMcpConfig: readMcpConfigMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  inspectAvailableTools: inspectAvailableToolsMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerToolsRoutes } from './tools.js';

type Handler = (req: any, res: any) => Promise<void> | void;

function createResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createHarness(options?: {
  currentProfile?: string;
  repoRoot?: string;
  profilesRoot?: string;
}) {
  const getHandlers = new Map<string, Handler>();
  const postHandlers = new Map<string, Handler>();
  const app = {
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
    }),
    post: vi.fn((path: string, handler: Handler) => {
      postHandlers.set(path, handler);
    }),
  };

  registerToolsRoutes(app as never, {
    getCurrentProfile: () => options?.currentProfile ?? 'assistant',
    getRepoRoot: () => options?.repoRoot ?? '/repo',
    getProfilesRoot: () => options?.profilesRoot ?? '/profiles',
    buildLiveSessionResourceOptions: (profile: string) => ({
      profileMarker: profile,
    } as never),
    buildLiveSessionExtensionFactories: () => ['extension-factory'] as never,
    withTemporaryProfileAgentDir: async <T>(profile: string, run: (agentDir: string) => Promise<T>) => run(`/tmp/${profile}-agent-dir`),
  });

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('registerToolsRoutes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
    };
    inspectAvailableToolsMock.mockReset();
    inspectCliBinaryMock.mockReset();
    inspectMcpServerMock.mockReset();
    inspectMcpToolMock.mockReset();
    installPackageSourceMock.mockReset();
    listProfilesMock.mockReset();
    logErrorMock.mockReset();
    readMcpConfigMock.mockReset();
    readPackageSourceTargetStateMock.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns tool inspection details and package install state for the requested profile', async () => {
    const { getHandler } = createHarness({ currentProfile: 'assistant', repoRoot: '/repo', profilesRoot: '/profiles' });
    const handler = getHandler('/api/tools');
    const res = createResponse();

    process.env.PERSONAL_AGENT_OP_BIN = 'op-custom';
    listProfilesMock.mockReturnValue(['assistant', 'other']);
    inspectAvailableToolsMock.mockResolvedValueOnce({
      tools: [{ id: 'shell' }],
      toolsets: [{ id: 'default' }],
    });
    readMcpConfigMock.mockReturnValue({
      path: '/repo/.mcp.json',
      exists: true,
      searchedPaths: ['/repo/.mcp.json', '/repo/.mcp/config.json'],
      servers: [{
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['@mcp/github'],
        cwd: '/repo',
        url: undefined,
        raw: { token: 'secret' },
      }],
    });
    inspectCliBinaryMock.mockReturnValue({
      command: 'op-custom',
      exists: true,
    });
    readPackageSourceTargetStateMock.mockImplementation((target: string, arg1: unknown) => {
      if (target === 'profile') {
        return { installedSources: [`profile:${String(arg1)}`] };
      }
      return { installedSources: ['local:pkg'] };
    });

    await handler({ query: { viewProfile: 'other' } }, res);

    expect(inspectAvailableToolsMock).toHaveBeenCalledWith('/repo', {
      profileMarker: 'other',
      agentDir: '/tmp/other-agent-dir',
      extensionFactories: ['extension-factory'],
    });
    expect(inspectCliBinaryMock).toHaveBeenCalledWith({
      command: 'op-custom',
      cwd: '/repo',
    });
    expect(res.json).toHaveBeenCalledWith({
      profile: 'other',
      tools: [{ id: 'shell' }],
      toolsets: [{ id: 'default' }],
      dependentCliTools: [{
        id: '1password-cli',
        name: '1Password CLI',
        description: 'Resolves op:// secret references used by personal-agent features and extensions.',
        configuredBy: 'PERSONAL_AGENT_OP_BIN',
        usedBy: ['op:// secret references', 'web-tools extension'],
        binary: { command: 'op-custom', exists: true },
      }],
      mcp: {
        configPath: '/repo/.mcp.json',
        configExists: true,
        searchedPaths: ['/repo/.mcp.json', '/repo/.mcp/config.json'],
        servers: [{
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['@mcp/github'],
          cwd: '/repo',
          url: undefined,
          raw: {},
        }],
      },
      packageInstall: {
        currentProfile: 'assistant',
        profileTargets: [
          {
            installedSources: ['profile:assistant'],
            profileName: 'assistant',
            current: true,
          },
          {
            installedSources: ['profile:other'],
            profileName: 'other',
            current: false,
          },
        ],
        localTarget: { installedSources: ['local:pkg'] },
      },
    });
  });

  it('rejects unknown profiles for tool inspection and logs unexpected request failures', async () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/tools');

    listProfilesMock.mockReturnValueOnce(['assistant']);
    const unknownRes = createResponse();
    await handler({ query: { viewProfile: 'missing' } }, unknownRes);
    expect(unknownRes.status).toHaveBeenCalledWith(400);
    expect(unknownRes.json).toHaveBeenCalledWith({ error: 'Unknown profile: missing' });

    inspectAvailableToolsMock.mockRejectedValueOnce(new Error('inspect failed'));
    const failureRes = createResponse();
    await handler({ query: {} }, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'inspect failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'inspect failed' });
  });

  it('validates install requests, returns updated package state, and reports install failures', () => {
    const { postHandler } = createHarness({ currentProfile: 'assistant' });
    const handler = postHandler('/api/tools/packages/install');

    const missingSourceRes = createResponse();
    handler({ body: {} }, missingSourceRes);
    expect(missingSourceRes.status).toHaveBeenCalledWith(400);
    expect(missingSourceRes.json).toHaveBeenCalledWith({ error: 'source required' });

    const invalidTargetRes = createResponse();
    handler({ body: { source: './pkg', target: 'workspace' } }, invalidTargetRes);
    expect(invalidTargetRes.status).toHaveBeenCalledWith(400);
    expect(invalidTargetRes.json).toHaveBeenCalledWith({ error: 'target must be profile or local' });

    const missingProfileRes = createResponse();
    handler({ body: { source: './pkg', target: 'profile' } }, missingProfileRes);
    expect(missingProfileRes.status).toHaveBeenCalledWith(400);
    expect(missingProfileRes.json).toHaveBeenCalledWith({ error: 'profileName required for profile installs' });

    listProfilesMock.mockReturnValueOnce(['assistant', 'other']);
    readPackageSourceTargetStateMock.mockImplementation((target: string, arg1: unknown) => {
      if (target === 'profile') {
        return { installedSources: [`profile:${String(arg1)}`] };
      }
      return { installedSources: ['local:pkg'] };
    });
    installPackageSourceMock.mockReturnValueOnce({
      source: './pkg',
      target: 'profile',
      installed: true,
    });

    const successRes = createResponse();
    handler({ body: { source: './pkg', target: 'profile', profileName: 'other' } }, successRes);
    expect(installPackageSourceMock).toHaveBeenCalledWith({
      repoRoot: '/repo',
      profilesRoot: '/profiles',
      profileName: 'other',
      source: './pkg',
      target: 'profile',
      sourceBaseDir: '/repo',
    });
    expect(successRes.json).toHaveBeenCalledWith({
      source: './pkg',
      target: 'profile',
      installed: true,
      packageInstall: {
        currentProfile: 'assistant',
        profileTargets: [
          {
            installedSources: ['profile:assistant'],
            profileName: 'assistant',
            current: true,
          },
          {
            installedSources: ['profile:other'],
            profileName: 'other',
            current: false,
          },
        ],
        localTarget: { installedSources: ['local:pkg'] },
      },
    });

    installPackageSourceMock.mockImplementationOnce(() => {
      throw new Error('install failed');
    });
    const failureRes = createResponse();
    handler({ body: { source: './pkg', target: 'local' } }, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'install failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'Error: install failed' });
  });

  it('handles MCP server and tool inspection success, validation, and failure responses', async () => {
    const { getHandler } = createHarness({ repoRoot: '/repo' });
    const serverHandler = getHandler('/api/tools/mcp/servers/:server');
    const toolHandler = getHandler('/api/tools/mcp/servers/:server/tools/:tool');

    readMcpConfigMock.mockReturnValue({ path: '/repo/.mcp.json' });

    const missingServerRes = createResponse();
    await serverHandler({ params: {} }, missingServerRes);
    expect(missingServerRes.status).toHaveBeenCalledWith(400);
    expect(missingServerRes.json).toHaveBeenCalledWith({ error: 'server required' });

    inspectMcpServerMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'out',
      stderr: 'bad server',
      data: null,
      error: undefined,
    });
    const failingServerRes = createResponse();
    await serverHandler({ params: { server: 'github' } }, failingServerRes);
    expect(inspectMcpServerMock).toHaveBeenCalledWith('github', {
      cwd: '/repo',
      configPath: '/repo/.mcp.json',
    });
    expect(failingServerRes.status).toHaveBeenCalledWith(500);
    expect(failingServerRes.json).toHaveBeenCalledWith({
      error: 'bad server',
      stdout: 'out',
      stderr: 'bad server',
      exitCode: 1,
    });

    inspectMcpServerMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'server ok',
      stderr: '',
      data: { tools: [{ name: 'search' }] },
    });
    const serverSuccessRes = createResponse();
    await serverHandler({ params: { server: 'github' } }, serverSuccessRes);
    expect(serverSuccessRes.json).toHaveBeenCalledWith({
      server: 'github',
      stdout: 'server ok',
      stderr: '',
      exitCode: 0,
      tools: [{ name: 'search' }],
    });

    const missingToolRes = createResponse();
    await toolHandler({ params: { server: 'github' } }, missingToolRes);
    expect(missingToolRes.status).toHaveBeenCalledWith(400);
    expect(missingToolRes.json).toHaveBeenCalledWith({ error: 'server and tool required' });

    inspectMcpToolMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'bad tool',
      data: null,
      error: 'inspection failed',
    });
    const failingToolRes = createResponse();
    await toolHandler({ params: { server: 'github', tool: 'search' } }, failingToolRes);
    expect(inspectMcpToolMock).toHaveBeenCalledWith('github', 'search', {
      cwd: '/repo',
      configPath: '/repo/.mcp.json',
    });
    expect(failingToolRes.status).toHaveBeenCalledWith(500);
    expect(failingToolRes.json).toHaveBeenCalledWith({
      error: 'inspection failed',
      stdout: '',
      stderr: 'bad tool',
      exitCode: 1,
    });

    inspectMcpToolMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'tool ok',
      stderr: '',
      data: { description: 'Search docs' },
    });
    const toolSuccessRes = createResponse();
    await toolHandler({ params: { server: 'github', tool: 'search' } }, toolSuccessRes);
    expect(toolSuccessRes.json).toHaveBeenCalledWith({
      server: 'github',
      tool: 'search',
      stdout: 'tool ok',
      stderr: '',
      exitCode: 0,
      description: 'Search docs',
    });
  });
});

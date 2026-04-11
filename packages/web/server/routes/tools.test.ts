import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  inspectAvailableToolsMock,
  inspectCliBinaryMock,
  listProfilesMock,
  logErrorMock,
  readMcpConfigMock,
  readPackageSourceTargetStateMock,
} = vi.hoisted(() => ({
  inspectAvailableToolsMock: vi.fn(),
  inspectCliBinaryMock: vi.fn(),
  listProfilesMock: vi.fn(),
  logErrorMock: vi.fn(),
  readMcpConfigMock: vi.fn(),
  readPackageSourceTargetStateMock: vi.fn(),
}));

vi.mock('@personal-agent/resources', () => ({
  listProfiles: listProfilesMock,
  readPackageSourceTargetState: readPackageSourceTargetStateMock,
}));

vi.mock('@personal-agent/core', () => ({
  inspectCliBinary: inspectCliBinaryMock,
  readMcpConfig: readMcpConfigMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  inspectAvailableTools: inspectAvailableToolsMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerToolsRoutes } from './tools.js';

type Handler = (req: unknown, res: ReturnType<typeof createResponse>) => Promise<void> | void;

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
  const app = {
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
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

});

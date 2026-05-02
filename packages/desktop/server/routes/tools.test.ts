import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildMergedMcpConfigDocumentMock,
  inspectAvailableToolsMock,
  inspectCliBinaryMock,
  listProfilesMock,
  logErrorMock,
  readBundledSkillMcpManifestsMock,
  readMcpConfigDocumentMock,
  readPackageSourceTargetStateMock,
} = vi.hoisted(() => ({
  buildMergedMcpConfigDocumentMock: vi.fn(),
  inspectAvailableToolsMock: vi.fn(),
  inspectCliBinaryMock: vi.fn(),
  listProfilesMock: vi.fn(),
  logErrorMock: vi.fn(),
  readBundledSkillMcpManifestsMock: vi.fn(),
  readMcpConfigDocumentMock: vi.fn(),
  readPackageSourceTargetStateMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  buildMergedMcpConfigDocument: buildMergedMcpConfigDocumentMock,
  inspectCliBinary: inspectCliBinaryMock,
  listProfiles: listProfilesMock,
  readBundledSkillMcpManifests: readBundledSkillMcpManifestsMock,
  readMcpConfigDocument: readMcpConfigDocumentMock,
  readPackageSourceTargetState: readPackageSourceTargetStateMock,
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

function createHarness(options?: { currentProfile?: string; repoRoot?: string; profilesRoot?: string }) {
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
    buildLiveSessionResourceOptions: (profile: string) =>
      ({
        profileMarker: profile,
        additionalSkillPaths: [`/skills/${profile}/jira-helper`],
      }) as never,
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
    buildMergedMcpConfigDocumentMock.mockReset();
    readBundledSkillMcpManifestsMock.mockReset();
    readMcpConfigDocumentMock.mockReset();
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
    readBundledSkillMcpManifestsMock.mockReturnValue([
      {
        skillName: 'jira-helper',
        skillDir: '/skills/other/jira-helper',
        manifestPath: '/skills/other/jira-helper/mcp.json',
        serverNames: ['atlassian'],
      },
    ]);
    buildMergedMcpConfigDocumentMock.mockReturnValue({
      baseConfigPath: '/repo/.mcp.json',
      baseConfigExists: true,
      baseServerNames: ['github'],
      searchedPaths: ['/repo/.mcp.json', '/repo/.mcp/config.json'],
      bundledServerCount: 1,
      manifestPaths: ['/skills/other/jira-helper/mcp.json'],
      document: {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['@mcp/github'],
          },
          atlassian: {
            command: 'pa',
            args: ['mcp', 'serve', 'atlassian'],
          },
        },
      },
    });
    readMcpConfigDocumentMock.mockReturnValue({
      path: '/repo/.mcp.json',
      exists: true,
      searchedPaths: ['/repo/.mcp.json', '/repo/.mcp/config.json'],
      servers: [
        {
          name: 'atlassian',
          transport: 'remote',
          command: undefined,
          args: [],
          cwd: undefined,
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
          url: undefined,
          raw: {},
        },
      ],
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
      additionalSkillPaths: ['/skills/other/jira-helper'],
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
      dependentCliTools: [
        {
          id: '1password-cli',
          name: '1Password CLI',
          description: 'Resolves op:// secret references used by personal-agent features and extensions.',
          configuredBy: 'PERSONAL_AGENT_OP_BIN',
          usedBy: ['op:// secret references', 'web-tools extension'],
          binary: { command: 'op-custom', exists: true },
        },
      ],
      mcp: {
        configPath: '/repo/.mcp.json',
        configExists: true,
        searchedPaths: ['/repo/.mcp.json', '/repo/.mcp/config.json'],
        servers: [
          {
            name: 'atlassian',
            transport: 'remote',
            command: undefined,
            args: [],
            cwd: undefined,
            url: 'https://mcp.atlassian.com/v1/mcp',
            source: 'skill',
            sourcePath: '/skills/other/jira-helper/mcp.json',
            skillName: 'jira-helper',
            skillPath: '/skills/other/jira-helper',
            manifestPath: '/skills/other/jira-helper/mcp.json',
            hasOAuth: true,
            callbackUrl: 'http://localhost:3118/callback',
            authorizeResource: 'https://datadoghq.atlassian.net/',
            raw: {},
          },
          {
            name: 'github',
            transport: 'stdio',
            command: 'npx',
            args: ['@mcp/github'],
            cwd: '/repo',
            url: undefined,
            source: 'config',
            sourcePath: '/repo/.mcp.json',
            skillName: undefined,
            skillPath: undefined,
            manifestPath: undefined,
            hasOAuth: false,
            callbackUrl: undefined,
            authorizeResource: undefined,
            raw: {},
          },
        ],
        bundledSkills: [
          {
            skillName: 'jira-helper',
            skillPath: '/skills/other/jira-helper',
            manifestPath: '/skills/other/jira-helper/mcp.json',
            serverNames: ['atlassian'],
            overriddenServerNames: [],
          },
        ],
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
    expect(logErrorMock).toHaveBeenCalledWith(
      'request handler error',
      expect.objectContaining({
        message: 'inspect failed',
      }),
    );
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'inspect failed' });
  });
});

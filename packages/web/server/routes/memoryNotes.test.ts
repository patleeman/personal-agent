import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildRecentReadUsageMock,
  existsSyncMock,
  getDurableAgentFilePathMock,
  getProfilesRootMock,
  getVaultRootMock,
  listMemoryDocsMock,
  listProfilesMock,
  listSkillsForProfileMock,
  listVaultFilesMock,
  logErrorMock,
  normalizeMemoryPathMock,
  readFileSyncMock,
  resolveResourceProfileMock,
} = vi.hoisted(() => ({
  buildRecentReadUsageMock: vi.fn(),
  existsSyncMock: vi.fn(),
  getDurableAgentFilePathMock: vi.fn(() => '/vault/AGENTS.md'),
  getProfilesRootMock: vi.fn(() => '/profiles'),
  getVaultRootMock: vi.fn(() => '/vault'),
  listMemoryDocsMock: vi.fn(),
  listProfilesMock: vi.fn(),
  listSkillsForProfileMock: vi.fn(),
  listVaultFilesMock: vi.fn(),
  logErrorMock: vi.fn(),
  normalizeMemoryPathMock: vi.fn((path: string) => path),
  readFileSyncMock: vi.fn(),
  resolveResourceProfileMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('@personal-agent/core', () => ({
  getDurableAgentFilePath: getDurableAgentFilePathMock,
  getProfilesRoot: getProfilesRootMock,
  getVaultRoot: getVaultRootMock,
  listProfiles: listProfilesMock,
  resolveResourceProfile: resolveResourceProfileMock,
}));

vi.mock('../knowledge/memoryDocs.js', () => ({
  buildRecentReadUsage: buildRecentReadUsageMock,
  listMemoryDocs: listMemoryDocsMock,
  listSkillsForProfile: listSkillsForProfileMock,
  normalizeMemoryPath: normalizeMemoryPathMock,
}));

vi.mock('../knowledge/vaultFiles.js', () => ({
  listVaultFiles: listVaultFilesMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerMemoryNotesRoutes } from './memoryNotes.js';

type Handler = (
  req: { query?: Record<string, unknown>; body?: Record<string, unknown> },
  res: ReturnType<typeof createResponse>,
) => Promise<void> | void;

function createResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createHarness(options?: {
  profile?: string;
  repoRoot?: string;
}) {
  const getHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
    }),
  };

  registerMemoryNotesRoutes(router as never, {
    getCurrentProfile: () => options?.profile ?? 'assistant',
    getRepoRoot: () => options?.repoRoot ?? '/repo',
  });

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
  };
}

describe('registerMemoryNotesRoutes', () => {
  beforeEach(() => {
    buildRecentReadUsageMock.mockReset();
    existsSyncMock.mockReset();
    getDurableAgentFilePathMock.mockClear();
    getProfilesRootMock.mockClear();
    getVaultRootMock.mockClear();
    listMemoryDocsMock.mockReset();
    listProfilesMock.mockReset();
    listSkillsForProfileMock.mockReset();
    listVaultFilesMock.mockReset();
    logErrorMock.mockReset();
    normalizeMemoryPathMock.mockClear();
    readFileSyncMock.mockReset();
    resolveResourceProfileMock.mockReset();
  });

  it('lists memory data for the requested profile and applies recent usage metadata', () => {
    const { getHandler } = createHarness({ profile: 'assistant', repoRoot: '/repo' });
    const handler = getHandler('/api/memory');
    const res = createResponse();
    const skills = [
      { name: 'agent-browser', path: '/skills/agent-browser/SKILL.md' },
      { name: 'auto-mode', path: '/skills/auto-mode/SKILL.md' },
    ];
    const memoryDocs = [
      { id: 'desktop', path: '/notes/Desktop GPU-Enabled Server Notes.md' },
      { id: 'wiki', path: '/notes/Wiki.md' },
    ];

    listProfilesMock.mockReturnValueOnce(['assistant', 'other']);
    resolveResourceProfileMock.mockReturnValueOnce({
      agentsFiles: [
        '/profiles/other/AGENTS.md',
        '/shared/skills/agent-browser/SKILL.md',
        '/vault/AGENTS.md',
      ],
    });
    existsSyncMock.mockImplementation((path: string) => path !== '/vault/AGENTS.md');
    readFileSyncMock.mockImplementation((path: string) => `content:${path}`);
    listSkillsForProfileMock.mockReturnValueOnce(skills);
    listMemoryDocsMock.mockReturnValueOnce(memoryDocs);
    buildRecentReadUsageMock.mockReturnValueOnce(new Map([
      ['/skills/agent-browser/SKILL.md', {
        recentSessionCount: 3,
        lastUsedAt: '2026-04-09T16:00:00.000Z',
        usedInLastSession: true,
      }],
      ['/notes/Desktop GPU-Enabled Server Notes.md', {
        recentSessionCount: 1,
        lastUsedAt: '2026-04-08T10:00:00.000Z',
        usedInLastSession: false,
      }],
    ]));

    handler({ query: { viewProfile: 'other' } }, res);

    expect(listProfilesMock).toHaveBeenCalledWith({
      repoRoot: '/repo',
      profilesRoot: '/profiles',
    });
    expect(resolveResourceProfileMock).toHaveBeenCalledWith('other', {
      repoRoot: '/repo',
      profilesRoot: '/profiles',
    });
    expect(buildRecentReadUsageMock).toHaveBeenCalledWith([
      '/skills/agent-browser/SKILL.md',
      '/skills/auto-mode/SKILL.md',
      '/notes/Desktop GPU-Enabled Server Notes.md',
      '/notes/Wiki.md',
    ]);
    expect(res.json).toHaveBeenCalledWith({
      profile: 'other',
      agentsMd: [
        {
          source: 'profile',
          path: '/profiles/other/AGENTS.md',
          exists: true,
          content: 'content:/profiles/other/AGENTS.md',
        },
        {
          source: 'global',
          path: '/shared/skills/agent-browser/SKILL.md',
          exists: true,
          content: 'content:/shared/skills/agent-browser/SKILL.md',
        },
        {
          source: 'shared',
          path: '/vault/AGENTS.md',
          exists: false,
          content: undefined,
        },
      ],
      skills: [
        {
          name: 'agent-browser',
          path: '/skills/agent-browser/SKILL.md',
          recentSessionCount: 3,
          lastUsedAt: '2026-04-09T16:00:00.000Z',
          usedInLastSession: true,
        },
        {
          name: 'auto-mode',
          path: '/skills/auto-mode/SKILL.md',
        },
      ],
      memoryDocs: [
        {
          id: 'desktop',
          path: '/notes/Desktop GPU-Enabled Server Notes.md',
          recentSessionCount: 1,
          lastUsedAt: '2026-04-08T10:00:00.000Z',
          usedInLastSession: false,
        },
        {
          id: 'wiki',
          path: '/notes/Wiki.md',
        },
      ],
    });
  });

  it('rejects unknown profiles and reports lookup failures with route-specific status codes', () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/memory');

    listProfilesMock.mockReturnValueOnce(['assistant']);
    const unknownRes = createResponse();
    handler({ query: { viewProfile: 'missing' } }, unknownRes);
    expect(unknownRes.status).toHaveBeenCalledWith(400);
    expect(unknownRes.json).toHaveBeenCalledWith({ error: 'Unknown profile: missing' });

    resolveResourceProfileMock.mockImplementationOnce(() => {
      throw new Error('resolve failed');
    });
    const failureRes = createResponse();
    handler({ query: {} }, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'resolve failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'resolve failed' });
  });

  it('lists vault files and surfaces vault read failures', () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/vault-files');

    listVaultFilesMock.mockReturnValueOnce([
      { id: 'notes/', kind: 'folder', name: 'notes', path: '/vault/notes', sizeBytes: 0, updatedAt: '2026-04-18T12:00:00.000Z' },
      { id: 'notes/a.md', kind: 'file', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' },
    ]);
    const successRes = createResponse();
    handler({}, successRes);
    expect(successRes.json).toHaveBeenCalledWith({
      root: '/vault',
      files: [
        { id: 'notes/', kind: 'folder', name: 'notes', path: '/vault/notes', sizeBytes: 0, updatedAt: '2026-04-18T12:00:00.000Z' },
        { id: 'notes/a.md', kind: 'file', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' },
      ],
    });

    listVaultFilesMock.mockImplementationOnce(() => {
      throw new Error('vault failed');
    });
    const failureRes = createResponse();
    handler({}, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'vault failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'vault failed' });
  });

});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildRecentReadUsageMock,
  clearMemoryBrowserCachesMock,
  existsSyncMock,
  getProfilesRootMock,
  getVaultRootMock,
  isEditableMemoryFilePathMock,
  listMemoryDocsMock,
  listProfilesMock,
  listSkillsForProfileMock,
  listVaultFilesMock,
  logErrorMock,
  normalizeMemoryPathMock,
  readFileSyncMock,
  resolveResourceProfileMock,
  writeFileSyncMock,
} = vi.hoisted(() => ({
  buildRecentReadUsageMock: vi.fn(),
  clearMemoryBrowserCachesMock: vi.fn(),
  existsSyncMock: vi.fn(),
  getProfilesRootMock: vi.fn(() => '/profiles'),
  getVaultRootMock: vi.fn(() => '/vault'),
  isEditableMemoryFilePathMock: vi.fn(),
  listMemoryDocsMock: vi.fn(),
  listProfilesMock: vi.fn(),
  listSkillsForProfileMock: vi.fn(),
  listVaultFilesMock: vi.fn(),
  logErrorMock: vi.fn(),
  normalizeMemoryPathMock: vi.fn((path: string) => path),
  readFileSyncMock: vi.fn(),
  resolveResourceProfileMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
  };
});

vi.mock('@personal-agent/core', () => ({
  getProfilesRoot: getProfilesRootMock,
  getVaultRoot: getVaultRootMock,
}));

vi.mock('@personal-agent/resources', () => ({
  listProfiles: listProfilesMock,
  resolveResourceProfile: resolveResourceProfileMock,
}));

vi.mock('../knowledge/memoryDocs.js', () => ({
  buildRecentReadUsage: buildRecentReadUsageMock,
  clearMemoryBrowserCaches: clearMemoryBrowserCachesMock,
  isEditableMemoryFilePath: isEditableMemoryFilePathMock,
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
  const postHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
    }),
    post: vi.fn((path: string, handler: Handler) => {
      postHandlers.set(path, handler);
    }),
  };

  registerMemoryNotesRoutes(router as never, {
    getCurrentProfile: () => options?.profile ?? 'assistant',
    getRepoRoot: () => options?.repoRoot ?? '/repo',
  });

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('registerMemoryNotesRoutes', () => {
  beforeEach(() => {
    buildRecentReadUsageMock.mockReset();
    clearMemoryBrowserCachesMock.mockReset();
    existsSyncMock.mockReset();
    getProfilesRootMock.mockClear();
    getVaultRootMock.mockClear();
    isEditableMemoryFilePathMock.mockReset();
    listMemoryDocsMock.mockReset();
    listProfilesMock.mockReset();
    listSkillsForProfileMock.mockReset();
    listVaultFilesMock.mockReset();
    logErrorMock.mockReset();
    normalizeMemoryPathMock.mockClear();
    readFileSyncMock.mockReset();
    resolveResourceProfileMock.mockReset();
    writeFileSyncMock.mockReset();
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
        '/repo/AGENTS.md',
      ],
    });
    existsSyncMock.mockImplementation((path: string) => path !== '/repo/AGENTS.md');
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
          source: 'project',
          path: '/repo/AGENTS.md',
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

    listVaultFilesMock.mockReturnValueOnce(['notes/a.md', 'notes/b.md']);
    const successRes = createResponse();
    handler({}, successRes);
    expect(successRes.json).toHaveBeenCalledWith({
      root: '/vault',
      files: ['notes/a.md', 'notes/b.md'],
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

  it('validates readable memory file requests and returns file contents', () => {
    const { getHandler } = createHarness({ profile: 'datadog' });
    const handler = getHandler('/api/memory/file');

    const missingPathRes = createResponse();
    handler({ query: {} }, missingPathRes);
    expect(missingPathRes.status).toHaveBeenCalledWith(400);
    expect(missingPathRes.json).toHaveBeenCalledWith({ error: 'path required' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(false);
    const deniedRes = createResponse();
    handler({ query: { path: '/tmp/private.md' } }, deniedRes);
    expect(isEditableMemoryFilePathMock).toHaveBeenCalledWith('/tmp/private.md', 'datadog');
    expect(deniedRes.status).toHaveBeenCalledWith(403);
    expect(deniedRes.json).toHaveBeenCalledWith({ error: 'Access denied' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    existsSyncMock.mockReturnValueOnce(false);
    const missingFileRes = createResponse();
    handler({ query: { path: '/tmp/missing.md' } }, missingFileRes);
    expect(missingFileRes.status).toHaveBeenCalledWith(404);
    expect(missingFileRes.json).toHaveBeenCalledWith({ error: 'File not found' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockReturnValueOnce('# durable memory');
    const successRes = createResponse();
    handler({ query: { path: '/tmp/memory.md' } }, successRes);
    expect(readFileSyncMock).toHaveBeenCalledWith('/tmp/memory.md', 'utf-8');
    expect(successRes.json).toHaveBeenCalledWith({
      content: '# durable memory',
      path: '/tmp/memory.md',
    });
  });

  it('logs unexpected memory file read failures and write failures', () => {
    const harness = createHarness();
    const readHandler = harness.getHandler('/api/memory/file');
    const writeHandler = harness.postHandler('/api/memory/file');

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error('read failed');
    });
    const readFailureRes = createResponse();
    readHandler({ query: { path: '/tmp/memory.md' } }, readFailureRes);
    expect(readFailureRes.status).toHaveBeenCalledWith(500);
    expect(readFailureRes.json).toHaveBeenCalledWith({ error: 'Error: read failed' });

    const missingBodyRes = createResponse();
    writeHandler({ body: {} }, missingBodyRes);
    expect(missingBodyRes.status).toHaveBeenCalledWith(400);
    expect(missingBodyRes.json).toHaveBeenCalledWith({ error: 'path and content required' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(false);
    const deniedWriteRes = createResponse();
    writeHandler({ body: { path: '/tmp/private.md', content: 'x' } }, deniedWriteRes);
    expect(deniedWriteRes.status).toHaveBeenCalledWith(403);
    expect(deniedWriteRes.json).toHaveBeenCalledWith({ error: 'Access denied' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    const successRes = createResponse();
    writeHandler({ body: { path: '/tmp/memory.md', content: '# updated' } }, successRes);
    expect(writeFileSyncMock).toHaveBeenCalledWith('/tmp/memory.md', '# updated', 'utf-8');
    expect(clearMemoryBrowserCachesMock).toHaveBeenCalledTimes(1);
    expect(successRes.json).toHaveBeenCalledWith({ ok: true });

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    writeFileSyncMock.mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    const writeFailureRes = createResponse();
    writeHandler({ body: { path: '/tmp/memory.md', content: '# bad' } }, writeFailureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'write failed',
    }));
    expect(writeFailureRes.status).toHaveBeenCalledWith(500);
    expect(writeFailureRes.json).toHaveBeenCalledWith({ error: 'Error: write failed' });
  });
});

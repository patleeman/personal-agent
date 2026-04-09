import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  existsSyncMock,
  readFileSyncMock,
  readConversationModelPreferenceStateByIdMock,
  isEditableMemoryFilePathMock,
  listMemoryDocsMock,
  listSkillsForProfileMock,
  logErrorMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  readConversationModelPreferenceStateByIdMock: vi.fn(),
  isEditableMemoryFilePathMock: vi.fn(),
  listMemoryDocsMock: vi.fn(),
  listSkillsForProfileMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('../conversations/conversationService.js', () => ({
  readConversationModelPreferenceStateById: readConversationModelPreferenceStateByIdMock,
}));

vi.mock('../knowledge/memoryDocs.js', () => ({
  isEditableMemoryFilePath: isEditableMemoryFilePathMock,
  listMemoryDocs: listMemoryDocsMock,
  listSkillsForProfile: listSkillsForProfileMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import {
  registerCompanionMemoryRoutes,
  registerCompanionModelPreferenceRoutes,
} from './companionMemory.js';

type Handler = (req: any, res: any) => Promise<void> | void;

function createResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createHarness(profile = 'assistant') {
  const getHandlers = new Map<string, Handler>();
  const patchHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
    }),
    patch: vi.fn((path: string, handler: Handler) => {
      patchHandlers.set(path, handler);
    }),
  };

  registerCompanionMemoryRoutes(router as never, {
    getCurrentProfile: () => profile,
  });
  registerCompanionModelPreferenceRoutes(router as never);

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
  };
}

describe('companion memory routes', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    readConversationModelPreferenceStateByIdMock.mockReset();
    isEditableMemoryFilePathMock.mockReset();
    listMemoryDocsMock.mockReset();
    listSkillsForProfileMock.mockReset();
    logErrorMock.mockReset();
  });

  it('lists skills and memory docs and reports list failures', () => {
    const harness = createHarness('datadog');
    const listHandler = harness.getHandler('/api/memory');

    listSkillsForProfileMock.mockReturnValueOnce([{ name: 'agent-browser' }]);
    listMemoryDocsMock.mockReturnValueOnce([{ id: 'desktop-notes' }]);

    const successRes = createResponse();
    listHandler({}, successRes);
    expect(listSkillsForProfileMock).toHaveBeenCalledWith('datadog');
    expect(successRes.json).toHaveBeenCalledWith({
      skills: [{ name: 'agent-browser' }],
      memoryDocs: [{ id: 'desktop-notes' }],
    });

    listSkillsForProfileMock.mockImplementationOnce(() => {
      throw new Error('list failed');
    });

    const failureRes = createResponse();
    listHandler({}, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'list failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'Error: list failed' });
  });

  it('validates companion memory file requests and returns file contents', () => {
    const harness = createHarness();
    const fileHandler = harness.getHandler('/api/memory/file');

    const missingPathRes = createResponse();
    fileHandler({ query: {} }, missingPathRes);
    expect(missingPathRes.status).toHaveBeenCalledWith(400);
    expect(missingPathRes.json).toHaveBeenCalledWith({ error: 'path required' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(false);
    const forbiddenRes = createResponse();
    fileHandler({ query: { path: '/tmp/private.md' } }, forbiddenRes);
    expect(isEditableMemoryFilePathMock).toHaveBeenCalledWith('/tmp/private.md', 'assistant');
    expect(forbiddenRes.status).toHaveBeenCalledWith(403);
    expect(forbiddenRes.json).toHaveBeenCalledWith({ error: 'Access denied' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    existsSyncMock.mockReturnValueOnce(false);
    const missingFileRes = createResponse();
    fileHandler({ query: { path: '/tmp/missing.md' } }, missingFileRes);
    expect(missingFileRes.status).toHaveBeenCalledWith(404);
    expect(missingFileRes.json).toHaveBeenCalledWith({ error: 'File not found' });

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockReturnValueOnce('# durable note');
    const successRes = createResponse();
    fileHandler({ query: { path: '/tmp/memory.md' } }, successRes);
    expect(readFileSyncMock).toHaveBeenCalledWith('/tmp/memory.md', 'utf-8');
    expect(successRes.json).toHaveBeenCalledWith({
      content: '# durable note',
      path: '/tmp/memory.md',
    });
  });

  it('logs unexpected companion memory file failures', () => {
    const harness = createHarness();
    const fileHandler = harness.getHandler('/api/memory/file');

    isEditableMemoryFilePathMock.mockReturnValueOnce(true);
    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error('read failed');
    });

    const res = createResponse();
    fileHandler({ query: { path: '/tmp/memory.md' } }, res);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'read failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: read failed' });
  });

  it('handles companion conversation model preference lookups and rejects patches', async () => {
    const harness = createHarness();
    const getHandler = harness.getHandler('/api/conversations/:id/model-preferences');
    const patchHandler = harness.patchHandler('/api/conversations/:id/model-preferences');

    readConversationModelPreferenceStateByIdMock.mockResolvedValueOnce(null);
    const missingRes = createResponse();
    await getHandler({ params: { id: 'conv-1' } }, missingRes);
    expect(readConversationModelPreferenceStateByIdMock).toHaveBeenCalledWith('conv-1');
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Conversation preferences not found.' });

    readConversationModelPreferenceStateByIdMock.mockResolvedValueOnce({ model: 'gpt-5' });
    const successRes = createResponse();
    await getHandler({ params: { id: 'conv-2' } }, successRes);
    expect(successRes.json).toHaveBeenCalledWith({ model: 'gpt-5' });

    readConversationModelPreferenceStateByIdMock.mockRejectedValueOnce(new Error('lookup failed'));
    const failureRes = createResponse();
    await getHandler({ params: { id: 'conv-3' } }, failureRes);
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'lookup failed' });

    const patchRes = createResponse();
    await patchHandler({ params: { id: 'conv-3' } }, patchRes);
    expect(patchRes.status).toHaveBeenCalledWith(405);
    expect(patchRes.json).toHaveBeenCalledWith({
      error: 'Per-conversation model changes are not supported in companion mode.',
    });
  });
});

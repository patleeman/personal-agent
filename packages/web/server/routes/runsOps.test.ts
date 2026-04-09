import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearDurableRunsListCacheMock,
  getDurableRunMock,
  getDurableRunAttentionSignatureMock,
  markDurableRunAttentionReadMock,
  markDurableRunAttentionUnreadMock,
  invalidateAppTopicsMock,
  logErrorMock,
} = vi.hoisted(() => ({
  clearDurableRunsListCacheMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  getDurableRunAttentionSignatureMock: vi.fn(),
  markDurableRunAttentionReadMock: vi.fn(),
  markDurableRunAttentionUnreadMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  clearDurableRunsListCache: clearDurableRunsListCacheMock,
  getDurableRun: getDurableRunMock,
}));

vi.mock('../automation/durableRunAttention.js', () => ({
  getDurableRunAttentionSignature: getDurableRunAttentionSignatureMock,
}));

vi.mock('@personal-agent/core', () => ({
  markDurableRunAttentionRead: markDurableRunAttentionReadMock,
  markDurableRunAttentionUnread: markDurableRunAttentionUnreadMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
}));

import { registerRunsOpsRoutes } from './runsOps.js';

describe('registerRunsOpsRoutes', () => {
  beforeEach(() => {
    clearDurableRunsListCacheMock.mockReset();
    getDurableRunMock.mockReset();
    getDurableRunAttentionSignatureMock.mockReset();
    markDurableRunAttentionReadMock.mockReset();
    markDurableRunAttentionUnreadMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
  });

  function createHarness() {
    let handler: ((req: any, res: any) => Promise<void>) | undefined;
    const router = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn((path: string, next: typeof handler) => {
        expect(path).toBe('/api/runs/:id/attention');
        handler = next;
      }),
    };

    registerRunsOpsRoutes(router as never);

    return {
      handler: handler!,
      router,
    };
  }

  function createResponse() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    return res;
  }

  it('marks attention unread when read=false is requested', async () => {
    const { handler } = createHarness();
    getDurableRunMock.mockResolvedValue({ run: { runId: 'run-123' } });
    getDurableRunAttentionSignatureMock.mockReturnValue('sig-123');
    const res = createResponse();

    await handler({ params: { id: 'run-123' }, body: { read: false } }, res);

    expect(markDurableRunAttentionUnreadMock).toHaveBeenCalledWith({ runId: 'run-123' });
    expect(markDurableRunAttentionReadMock).not.toHaveBeenCalled();
    expect(clearDurableRunsListCacheMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('marks attention read when a signature is available', async () => {
    const { handler } = createHarness();
    getDurableRunMock.mockResolvedValue({ run: { runId: 'run-123' } });
    getDurableRunAttentionSignatureMock.mockReturnValue('sig-123');
    const res = createResponse();

    await handler({ params: { id: 'run-123' }, body: { read: true } }, res);

    expect(markDurableRunAttentionReadMock).toHaveBeenCalledWith({ runId: 'run-123', attentionSignature: 'sig-123' });
    expect(markDurableRunAttentionUnreadMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 404 when the run is missing', async () => {
    const { handler } = createHarness();
    getDurableRunMock.mockResolvedValue(undefined);
    const res = createResponse();

    await handler({ params: { id: 'missing' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Run not found' });
  });

  it('logs and returns 500 on handler errors', async () => {
    const { handler } = createHarness();
    getDurableRunMock.mockRejectedValue(new Error('boom'));
    const res = createResponse();

    await handler({ params: { id: 'run-123' }, body: {} }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({ message: 'boom' }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: boom' });
  });
});

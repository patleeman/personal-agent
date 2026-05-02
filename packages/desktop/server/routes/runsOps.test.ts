import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  markDurableRunAttentionCapabilityMock,
  DurableRunCapabilityInputErrorMock,
  logErrorMock,
} = vi.hoisted(() => ({
  markDurableRunAttentionCapabilityMock: vi.fn(),
  DurableRunCapabilityInputErrorMock: class DurableRunCapabilityInputError extends Error {},
  logErrorMock: vi.fn(),
}));

vi.mock('../automation/durableRunCapability.js', () => ({
  markDurableRunAttentionCapability: markDurableRunAttentionCapabilityMock,
  DurableRunCapabilityInputError: DurableRunCapabilityInputErrorMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerRunsOpsRoutes } from './runsOps.js';

describe('registerRunsOpsRoutes', () => {
  beforeEach(() => {
    markDurableRunAttentionCapabilityMock.mockReset();
    logErrorMock.mockReset();
  });

  function createHarness() {
    let handler: ((req: { params: { id: string }; body?: { read?: boolean } }, res: ReturnType<typeof createResponse>) => Promise<void>) | undefined;
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

  it('passes the run attention request through to the shared capability', async () => {
    const { handler } = createHarness();
    markDurableRunAttentionCapabilityMock.mockResolvedValue({ ok: true });
    const res = createResponse();

    await handler({ params: { id: 'run-123' }, body: { read: false } }, res);

    expect(markDurableRunAttentionCapabilityMock).toHaveBeenCalledWith({ runId: 'run-123', read: false });
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 400 for capability input errors', async () => {
    const { handler } = createHarness();
    markDurableRunAttentionCapabilityMock.mockRejectedValue(new DurableRunCapabilityInputErrorMock('runId required'));
    const res = createResponse();

    await handler({ params: { id: '   ' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'runId required' });
  });

  it('returns 404 when the capability reports a missing run', async () => {
    const { handler } = createHarness();
    markDurableRunAttentionCapabilityMock.mockRejectedValue(new Error('Run not found'));
    const res = createResponse();

    await handler({ params: { id: 'missing' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Run not found' });
  });

  it('logs and returns 500 on unexpected handler errors', async () => {
    const { handler } = createHarness();
    markDurableRunAttentionCapabilityMock.mockRejectedValue(new Error('boom'));
    const res = createResponse();

    await handler({ params: { id: 'run-123' }, body: {} }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({ message: 'boom' }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: boom' });
  });
});

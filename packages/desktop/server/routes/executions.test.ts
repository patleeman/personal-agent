import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelExecutionMock,
  getExecutionLogMock,
  getExecutionMock,
  invalidateAppTopicsMock,
  listConversationExecutionsMock,
  listExecutionsMock,
  logErrorMock,
} = vi.hoisted(() => ({
  cancelExecutionMock: vi.fn(),
  getExecutionLogMock: vi.fn(),
  getExecutionMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  listConversationExecutionsMock: vi.fn(),
  listExecutionsMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('../executions/executionService.js', () => ({
  cancelExecution: cancelExecutionMock,
  getExecution: getExecutionMock,
  getExecutionLog: getExecutionLogMock,
  listConversationExecutions: listConversationExecutionsMock,
  listExecutions: listExecutionsMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
}));

import { registerExecutionRoutes } from './executions.js';

describe('registerExecutionRoutes', () => {
  beforeEach(() => {
    cancelExecutionMock.mockReset();
    getExecutionLogMock.mockReset();
    getExecutionMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    listConversationExecutionsMock.mockReset();
    listExecutionsMock.mockReset();
    logErrorMock.mockReset();
  });

  function createHarness() {
    const handlers: Record<string, (req: unknown, res: unknown) => Promise<void> | void> = {};
    const router = {
      get: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`POST ${path}`] = next;
      }),
    };

    registerExecutionRoutes(router as never);

    return {
      listHandler: handlers['GET /api/executions']!,
      conversationHandler: handlers['GET /api/conversations/:id/executions']!,
      detailHandler: handlers['GET /api/executions/:id']!,
      logHandler: handlers['GET /api/executions/:id/log']!,
      cancelHandler: handlers['POST /api/executions/:id/cancel']!,
    };
  }

  function createJsonResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('lists all executions and conversation-scoped executions', async () => {
    const { listHandler, conversationHandler } = createHarness();
    const all = { executions: [{ id: 'run-1', kind: 'background-command' }] };
    const scoped = { conversationId: 'conv-1', primary: [{ id: 'run-1' }], system: [], hidden: [], executions: [{ id: 'run-1' }] };
    listExecutionsMock.mockResolvedValue(all);
    listConversationExecutionsMock.mockResolvedValue(scoped);

    const listRes = createJsonResponse();
    await listHandler({}, listRes);
    expect(listRes.json).toHaveBeenCalledWith(all);

    const scopedRes = createJsonResponse();
    await conversationHandler({ params: { id: 'conv-1' } }, scopedRes);
    expect(listConversationExecutionsMock).toHaveBeenCalledWith('conv-1');
    expect(scopedRes.json).toHaveBeenCalledWith(scoped);
  });

  it('returns details, logs, and 404s missing executions', async () => {
    const { detailHandler, logHandler } = createHarness();
    getExecutionMock.mockResolvedValue({ execution: { id: 'run-1' } });
    getExecutionLogMock.mockResolvedValue({ path: '/runs/run-1/output.log', log: 'ok' });

    const detailRes = createJsonResponse();
    await detailHandler({ params: { id: 'run-1' } }, detailRes);
    expect(detailRes.json).toHaveBeenCalledWith({ execution: { id: 'run-1' } });

    const logRes = createJsonResponse();
    await logHandler({ params: { id: 'run-1' }, query: { tail: '20' } }, logRes);
    expect(getExecutionLogMock).toHaveBeenCalledWith('run-1', 20);
    expect(logRes.json).toHaveBeenCalledWith({ path: '/runs/run-1/output.log', log: 'ok' });

    getExecutionMock.mockResolvedValue(undefined);
    const missingRes = createJsonResponse();
    await detailHandler({ params: { id: 'missing' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Execution not found' });
  });

  it('cancels executions and invalidates execution plus legacy run topics', async () => {
    const { cancelHandler } = createHarness();
    cancelExecutionMock.mockResolvedValue({ cancelled: true, runId: 'run-1' });

    const res = createJsonResponse();
    await cancelHandler({ params: { id: 'run-1' } }, res);

    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('executions', 'runs');
    expect(res.json).toHaveBeenCalledWith({ cancelled: true, runId: 'run-1' });
  });
});

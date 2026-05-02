import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logErrorMock, readDaemonStateMock, updateDaemonPowerAndReadStateMock } = vi.hoisted(() => ({
  logErrorMock: vi.fn(),
  readDaemonStateMock: vi.fn(),
  updateDaemonPowerAndReadStateMock: vi.fn(),
}));

vi.mock('../automation/daemon.js', () => ({
  readDaemonState: readDaemonStateMock,
  updateDaemonPowerAndReadState: updateDaemonPowerAndReadStateMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerDaemonRoutes } from './daemon.js';

type TestRequest = Record<string, never>;
type TestResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};
type TestHandler = (req: TestRequest, res: TestResponse) => Promise<void> | void;

describe('registerDaemonRoutes', () => {
  beforeEach(() => {
    logErrorMock.mockReset();
    readDaemonStateMock.mockReset();
    updateDaemonPowerAndReadStateMock.mockReset();
  });

  function createHarness() {
    const handlers: Record<string, TestHandler> = {};
    const router = {
      get: vi.fn((path: string, next: TestHandler) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: TestHandler) => {
        handlers[`POST ${path}`] = next;
      }),
      patch: vi.fn((path: string, next: TestHandler) => {
        handlers[`PATCH ${path}`] = next;
      }),
    };

    registerDaemonRoutes(router as never);

    return {
      stateHandler: handlers['GET /api/daemon']!,
      powerHandler: handlers['PATCH /api/daemon/power']!,
    };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('reads daemon state and logs failures', async () => {
    const { stateHandler } = createHarness();

    readDaemonStateMock.mockResolvedValue({ installed: true, running: true });

    const stateRes = createResponse();
    await stateHandler({}, stateRes);
    expect(stateRes.json).toHaveBeenCalledWith({ installed: true, running: true });

    readDaemonStateMock.mockRejectedValueOnce(new Error('state failed'));
    const failingRes = createResponse();
    await stateHandler({}, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: state failed' });
    expect(logErrorMock).toHaveBeenCalledWith(
      'request handler error',
      expect.objectContaining({
        message: 'state failed',
      }),
    );
  });

  it('updates daemon power state and validates the request body', async () => {
    const { powerHandler } = createHarness();

    updateDaemonPowerAndReadStateMock.mockResolvedValue({ power: { keepAwake: true, active: true, supported: true } });

    const res = createResponse();
    await powerHandler({ body: { keepAwake: true } } as never, res);
    expect(updateDaemonPowerAndReadStateMock).toHaveBeenCalledWith({ keepAwake: true });
    expect(res.json).toHaveBeenCalledWith({ power: { keepAwake: true, active: true, supported: true } });

    const failingRes = createResponse();
    await powerHandler({ body: { keepAwake: 'yes' } } as never, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: keepAwake must be a boolean.' });
  });
});

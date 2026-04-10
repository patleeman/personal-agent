import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  installDaemonServiceAndReadStateMock,
  invalidateAppTopicsMock,
  logErrorMock,
  readDaemonStateMock,
  restartDaemonServiceAndReadStateMock,
  startDaemonServiceAndReadStateMock,
  stopDaemonServiceAndReadStateMock,
  suppressMonitoredServiceAttentionMock,
  uninstallDaemonServiceAndReadStateMock,
} = vi.hoisted(() => ({
  installDaemonServiceAndReadStateMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
  readDaemonStateMock: vi.fn(),
  restartDaemonServiceAndReadStateMock: vi.fn(),
  startDaemonServiceAndReadStateMock: vi.fn(),
  stopDaemonServiceAndReadStateMock: vi.fn(),
  suppressMonitoredServiceAttentionMock: vi.fn(),
  uninstallDaemonServiceAndReadStateMock: vi.fn(),
}));

vi.mock('../automation/daemon.js', () => ({
  installDaemonServiceAndReadState: installDaemonServiceAndReadStateMock,
  readDaemonState: readDaemonStateMock,
  restartDaemonServiceAndReadState: restartDaemonServiceAndReadStateMock,
  startDaemonServiceAndReadState: startDaemonServiceAndReadStateMock,
  stopDaemonServiceAndReadState: stopDaemonServiceAndReadStateMock,
  uninstallDaemonServiceAndReadState: uninstallDaemonServiceAndReadStateMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
}));

vi.mock('../shared/internalAttention.js', () => ({
  createServiceAttentionMonitor: vi.fn(),
  suppressMonitoredServiceAttention: suppressMonitoredServiceAttentionMock,
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
    installDaemonServiceAndReadStateMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
    readDaemonStateMock.mockReset();
    restartDaemonServiceAndReadStateMock.mockReset();
    startDaemonServiceAndReadStateMock.mockReset();
    stopDaemonServiceAndReadStateMock.mockReset();
    suppressMonitoredServiceAttentionMock.mockReset();
    uninstallDaemonServiceAndReadStateMock.mockReset();
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
    };

    registerDaemonRoutes(router as never);

    return {
      stateHandler: handlers['GET /api/daemon']!,
      installHandler: handlers['POST /api/daemon/service/install']!,
      startHandler: handlers['POST /api/daemon/service/start']!,
      restartHandler: handlers['POST /api/daemon/service/restart']!,
      stopHandler: handlers['POST /api/daemon/service/stop']!,
      uninstallHandler: handlers['POST /api/daemon/service/uninstall']!,
    };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('reads daemon state and performs each lifecycle action', async () => {
    const { stateHandler, installHandler, startHandler, restartHandler, stopHandler, uninstallHandler } = createHarness();

    readDaemonStateMock.mockResolvedValue({ installed: true, running: true });
    installDaemonServiceAndReadStateMock.mockResolvedValue({ action: 'install' });
    startDaemonServiceAndReadStateMock.mockResolvedValue({ action: 'start' });
    restartDaemonServiceAndReadStateMock.mockResolvedValue({ action: 'restart' });
    stopDaemonServiceAndReadStateMock.mockResolvedValue({ action: 'stop' });
    uninstallDaemonServiceAndReadStateMock.mockResolvedValue({ action: 'uninstall' });

    const stateRes = createResponse();
    await stateHandler({}, stateRes);
    expect(stateRes.json).toHaveBeenCalledWith({ installed: true, running: true });

    const installRes = createResponse();
    await installHandler({}, installRes);
    expect(installRes.json).toHaveBeenCalledWith({ action: 'install' });

    const startRes = createResponse();
    await startHandler({}, startRes);
    expect(startRes.json).toHaveBeenCalledWith({ action: 'start' });

    const restartRes = createResponse();
    await restartHandler({}, restartRes);
    expect(restartRes.json).toHaveBeenCalledWith({ action: 'restart' });

    const stopRes = createResponse();
    await stopHandler({}, stopRes);
    expect(stopRes.json).toHaveBeenCalledWith({ action: 'stop' });

    const uninstallRes = createResponse();
    await uninstallHandler({}, uninstallRes);
    expect(uninstallRes.json).toHaveBeenCalledWith({ action: 'uninstall' });

    expect(suppressMonitoredServiceAttentionMock).toHaveBeenCalledTimes(5);
    expect(suppressMonitoredServiceAttentionMock).toHaveBeenCalledWith('daemon');
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(5);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('daemon');
  });

  it('returns 400 for desktop-runtime daemon lifecycle errors', async () => {
    const { installHandler, startHandler, restartHandler, stopHandler, uninstallHandler } = createHarness();
    const desktopError = new Error('Managed daemon service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local daemon runtime.');

    installDaemonServiceAndReadStateMock.mockRejectedValueOnce(desktopError);
    const installRes = createResponse();
    await installHandler({}, installRes);
    expect(installRes.status).toHaveBeenCalledWith(400);
    expect(installRes.json).toHaveBeenCalledWith({ error: desktopError.message });

    startDaemonServiceAndReadStateMock.mockRejectedValueOnce(desktopError);
    const startRes = createResponse();
    await startHandler({}, startRes);
    expect(startRes.status).toHaveBeenCalledWith(400);

    restartDaemonServiceAndReadStateMock.mockRejectedValueOnce(desktopError);
    const restartRes = createResponse();
    await restartHandler({}, restartRes);
    expect(restartRes.status).toHaveBeenCalledWith(400);

    stopDaemonServiceAndReadStateMock.mockRejectedValueOnce(desktopError);
    const stopRes = createResponse();
    await stopHandler({}, stopRes);
    expect(stopRes.status).toHaveBeenCalledWith(400);

    uninstallDaemonServiceAndReadStateMock.mockRejectedValueOnce(desktopError);
    const uninstallRes = createResponse();
    await uninstallHandler({}, uninstallRes);
    expect(uninstallRes.status).toHaveBeenCalledWith(400);

  });

  it('logs and returns 500 when daemon state or lifecycle handlers fail', async () => {
    const { stateHandler, installHandler, startHandler, restartHandler, stopHandler, uninstallHandler } = createHarness();

    readDaemonStateMock.mockRejectedValueOnce(new Error('state failed'));
    const stateRes = createResponse();
    await stateHandler({}, stateRes);
    expect(stateRes.status).toHaveBeenCalledWith(500);
    expect(stateRes.json).toHaveBeenCalledWith({ error: 'Error: state failed' });

    installDaemonServiceAndReadStateMock.mockRejectedValueOnce(new Error('install failed'));
    const installRes = createResponse();
    await installHandler({}, installRes);
    expect(installRes.status).toHaveBeenCalledWith(500);

    startDaemonServiceAndReadStateMock.mockRejectedValueOnce(new Error('start failed'));
    const startRes = createResponse();
    await startHandler({}, startRes);
    expect(startRes.status).toHaveBeenCalledWith(500);

    restartDaemonServiceAndReadStateMock.mockRejectedValueOnce(new Error('restart failed'));
    const restartRes = createResponse();
    await restartHandler({}, restartRes);
    expect(restartRes.status).toHaveBeenCalledWith(500);

    stopDaemonServiceAndReadStateMock.mockRejectedValueOnce(new Error('stop failed'));
    const stopRes = createResponse();
    await stopHandler({}, stopRes);
    expect(stopRes.status).toHaveBeenCalledWith(500);

    uninstallDaemonServiceAndReadStateMock.mockRejectedValueOnce(new Error('uninstall failed'));
    const uninstallRes = createResponse();
    await uninstallHandler({}, uninstallRes);
    expect(uninstallRes.status).toHaveBeenCalledWith(500);


    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'state failed',
    }));
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'install failed',
    }));
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'start failed',
    }));
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'restart failed',
    }));
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'stop failed',
    }));
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'uninstall failed',
    }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recoverDurableLiveConversationsMock = vi.hoisted(() => vi.fn());
const logInfoMock = vi.hoisted(() => vi.fn());
const logWarnMock = vi.hoisted(() => vi.fn());
const reloadAllLiveSessionAuthMock = vi.hoisted(() => vi.fn());
const subscribeProviderOAuthLoginsMock = vi.hoisted(() => vi.fn());
const createServiceAttentionMonitorMock = vi.hoisted(() => vi.fn());
const startAppEventMonitorMock = vi.hoisted(() => vi.fn());

vi.mock('../conversations/conversationRecovery.js', () => ({
  recoverDurableLiveConversations: recoverDurableLiveConversationsMock,
}));

vi.mock('../middleware/index.js', () => ({
  applyWebSecurityHeaders: (_req: unknown, _res: unknown, next: () => void) => next(),
  enforceSameOriginUnsafeRequests: (_req: unknown, _res: unknown, next: () => void) => next(),
  logInfo: logInfoMock,
  logWarn: logWarnMock,
  reloadAllLiveSessionAuth: reloadAllLiveSessionAuthMock,
  webRequestLoggingMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../models/providerAuth.js', () => ({
  subscribeProviderOAuthLogins: subscribeProviderOAuthLoginsMock,
}));

vi.mock('../shared/internalAttention.js', () => ({
  createServiceAttentionMonitor: createServiceAttentionMonitorMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  startAppEventMonitor: startAppEventMonitorMock,
}));

import {
  normalizeDeferredResumePollMs,
  startBootstrapMonitors,
  startConversationRecovery,
  startDeferredResumeLoop,
  startServerListeners,
} from './bootstrap.js';

describe('bootstrap monitor helpers', () => {
  beforeEach(() => {
    recoverDurableLiveConversationsMock.mockReset();
    logInfoMock.mockReset();
    logWarnMock.mockReset();
    reloadAllLiveSessionAuthMock.mockReset();
    subscribeProviderOAuthLoginsMock.mockReset();
    createServiceAttentionMonitorMock.mockReset();
    startAppEventMonitorMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('defaults malformed deferred resume poll intervals', () => {
    expect(normalizeDeferredResumePollMs(1.5)).toBe(5_000);
    expect(normalizeDeferredResumePollMs(Number.MAX_SAFE_INTEGER + 1)).toBe(5_000);
    expect(normalizeDeferredResumePollMs(Number.MAX_SAFE_INTEGER)).toBe(60_000);
  });

  it('starts bootstrap monitors and reloads session auth after completed OAuth logins', () => {
    let oauthCallback: ((login: { status: string }) => void) | undefined;
    const startMonitor = vi.fn();
    subscribeProviderOAuthLoginsMock.mockImplementation((callback: (login: { status: string }) => void) => {
      oauthCallback = callback;
    });
    createServiceAttentionMonitorMock.mockReturnValue({ start: startMonitor });

    startBootstrapMonitors({
      repoRoot: '/repo',
      sessionsDir: '/repo/sessions',
      taskStateFile: '/repo/tasks.json',
      profileConfigFile: '/repo/profile.json',
      daemonRoot: '/daemon',
      getCurrentProfile: () => 'assistant',
      readDaemonState: () => ({ status: 'ok' }),
    });

    expect(startAppEventMonitorMock).toHaveBeenCalledWith({
      repoRoot: '/repo',
      sessionsDir: '/repo/sessions',
      taskStateFile: '/repo/tasks.json',
      profileConfigFile: '/repo/profile.json',
      getCurrentProfile: expect.any(Function),
    });
    expect(createServiceAttentionMonitorMock).toHaveBeenCalledWith({
      repoRoot: '/repo',
      stateRoot: '/daemon',
      getCurrentProfile: expect.any(Function),
      readDaemonState: expect.any(Function),
      logger: { warn: expect.any(Function) },
    });
    expect(startMonitor).toHaveBeenCalledTimes(1);

    oauthCallback?.({ status: 'pending' });
    oauthCallback?.({ status: 'completed' });
    expect(reloadAllLiveSessionAuthMock).toHaveBeenCalledTimes(1);

    const logger = createServiceAttentionMonitorMock.mock.calls[0]?.[0]?.logger as {
      warn: (message: string, fields?: Record<string, unknown>) => void;
    };
    logger.warn('monitor warning', { area: 'attention' });
    expect(logWarnMock).toHaveBeenCalledWith('monitor warning', { area: 'attention' });
  });

  it('logs deferred resume loop failures for the initial flush and interval retries', async () => {
    vi.useFakeTimers();
    const flushLiveDeferredResumes = vi.fn().mockRejectedValue(new Error('boom'));

    startDeferredResumeLoop({
      flushLiveDeferredResumes,
      pollMs: 1_000,
    });
    await Promise.resolve();

    expect(flushLiveDeferredResumes).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalledWith('Deferred resume loop failed: boom');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushLiveDeferredResumes).toHaveBeenCalledTimes(2);
    expect(logWarnMock).toHaveBeenCalledTimes(2);
  });

  it('flushes deferred resumes after successful conversation recovery', async () => {
    const flushLiveDeferredResumes = vi.fn().mockResolvedValue(undefined);
    recoverDurableLiveConversationsMock.mockImplementation(
      async (options: { logger: { info: (message: string) => void; warn: (message: string) => void } }) => {
        options.logger.info('recovery detail');
        options.logger.warn('recovery warning');
        return { recovered: [{ id: 'run-1' }] };
      },
    );

    startConversationRecovery({
      flushLiveDeferredResumes,
      buildLiveSessionResourceOptions: () => ({ cwd: '/repo' }) as never,
      buildLiveSessionExtensionFactories: () => [] as never,
      isLive: () => true,
      resumeSession: async () => undefined,
      queuePromptContext: async () => undefined,
      promptSession: async () => undefined,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(recoverDurableLiveConversationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        loaderOptions: {
          cwd: '/repo',
          extensionFactories: [],
        },
        logger: {
          info: expect.any(Function),
          warn: expect.any(Function),
        },
      }),
    );
    expect(logInfoMock).toHaveBeenCalledWith('recovery detail');
    expect(logWarnMock).toHaveBeenCalledWith('recovery warning');
    expect(logInfoMock).toHaveBeenCalledWith('Recovered 1 live conversation runs from durable state.');
    expect(flushLiveDeferredResumes).toHaveBeenCalledTimes(1);
  });

  it('logs conversation recovery failures', async () => {
    recoverDurableLiveConversationsMock.mockRejectedValue(new Error('recovery exploded'));

    startConversationRecovery({
      flushLiveDeferredResumes: async () => undefined,
      buildLiveSessionResourceOptions: () => ({}) as never,
      buildLiveSessionExtensionFactories: () => [] as never,
      isLive: () => false,
      resumeSession: async () => undefined,
      queuePromptContext: async () => undefined,
      promptSession: async () => undefined,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(logWarnMock).toHaveBeenCalledWith('Conversation recovery failed: recovery exploded');
  });
});

describe('startServerListeners', () => {
  beforeEach(() => {
    logInfoMock.mockReset();
  });

  it('logs startup details for the main server', () => {
    const appListen = vi.fn((_port: number, _host: string, callback: () => void) => {
      callback();
      return {};
    });

    startServerListeners({
      app: { listen: appListen } as never,
      port: 3000,
      loopbackHost: '127.0.0.1',
      getCurrentProfile: () => 'assistant',
      getDefaultWebCwd: () => '/repo/packages/desktop/ui',
      repoRoot: '/repo',
      distDir: '/repo/packages/desktop/ui/dist',
    });

    expect(appListen).toHaveBeenCalledWith(3000, '127.0.0.1', expect.any(Function));
    expect(logInfoMock).toHaveBeenCalledWith('desktop renderer server started', {
      url: 'http://127.0.0.1:3000',
      profile: 'assistant',
      repoRoot: '/repo',
      cwd: '/repo/packages/desktop/ui',
      dist: '/repo/packages/desktop/ui/dist',
    });
  });
});

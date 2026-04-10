import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  session: {
    fromPartition: vi.fn(() => ({
      protocol: {
        handle: vi.fn(),
      },
    })),
  },
}));

import type { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import type { LocalApiModule } from '../local-api-module.js';
import { LocalHostController } from './local-host-controller.js';

describe('LocalHostController', () => {
  it('routes live-session mutations through the local API module without booting the web child', async () => {
    const invokeDesktopLocalApi = vi.fn().mockResolvedValue({ ok: true, accepted: true });
    const loadLocalApi = vi.fn().mockResolvedValue({
      invokeDesktopLocalApi,
      dispatchDesktopLocalApiRequest: vi.fn(),
      readDesktopConversationBootstrap: vi.fn(),
      createDesktopLiveSession: vi.fn(),
      resumeDesktopLiveSession: vi.fn(),
      submitDesktopLiveSessionPrompt: vi.fn(),
      takeOverDesktopLiveSession: vi.fn(),
      abortDesktopLiveSession: vi.fn(),
      subscribeDesktopLocalApiStream: vi.fn(),
      subscribeDesktopAppEvents: vi.fn(),
    } satisfies LocalApiModule);
    const backend = {
      ensureStarted: vi.fn(),
      getStatus: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
    } as unknown as LocalBackendProcesses;

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.invokeLocalApi('POST', '/api/live-sessions/live-1/prompt', {
      text: 'hello',
      surfaceId: 'surface-1',
    })).resolves.toEqual({ ok: true, accepted: true });

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(invokeDesktopLocalApi).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/live-sessions/live-1/prompt',
      body: {
        text: 'hello',
        surfaceId: 'surface-1',
      },
    });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes live-session event streams through the local API module without loopback proxying', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopLocalApiStream = vi.fn().mockResolvedValue(unsubscribe);
    const loadLocalApi = vi.fn().mockResolvedValue({
      invokeDesktopLocalApi: vi.fn(),
      dispatchDesktopLocalApiRequest: vi.fn(),
      readDesktopConversationBootstrap: vi.fn(),
      createDesktopLiveSession: vi.fn(),
      resumeDesktopLiveSession: vi.fn(),
      submitDesktopLiveSessionPrompt: vi.fn(),
      takeOverDesktopLiveSession: vi.fn(),
      abortDesktopLiveSession: vi.fn(),
      subscribeDesktopLocalApiStream,
      subscribeDesktopAppEvents: vi.fn(),
    } satisfies LocalApiModule);
    const backend = {
      ensureStarted: vi.fn(),
      getStatus: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
    } as unknown as LocalBackendProcesses;

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );
    const onEvent = vi.fn();

    await expect(controller.subscribeApiStream('/api/live-sessions/live-1/events?tailBlocks=20', onEvent)).resolves.toBe(unsubscribe);

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/live-sessions/live-1/events?tailBlocks=20', onEvent);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated live-session capabilities through the local API module without loopback proxying', async () => {
    const readDesktopConversationBootstrap = vi.fn().mockResolvedValue({
      conversationId: 'live-1',
      sessionDetail: null,
      liveSession: { live: true, id: 'live-1' },
    });
    const createDesktopLiveSession = vi.fn().mockResolvedValue({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl' });
    const resumeDesktopLiveSession = vi.fn().mockResolvedValue({ id: 'live-1' });
    const submitDesktopLiveSessionPrompt = vi.fn().mockResolvedValue({
      ok: true,
      accepted: true,
      delivery: 'started',
      referencedTaskIds: [],
      referencedMemoryDocIds: [],
      referencedVaultFileIds: [],
      referencedAttachmentIds: [],
    });
    const takeOverDesktopLiveSession = vi.fn().mockResolvedValue({ controllerSurfaceId: 'surface-1' });
    const abortDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const loadLocalApi = vi.fn().mockResolvedValue({
      invokeDesktopLocalApi: vi.fn(),
      dispatchDesktopLocalApiRequest: vi.fn(),
      readDesktopConversationBootstrap,
      createDesktopLiveSession,
      resumeDesktopLiveSession,
      submitDesktopLiveSessionPrompt,
      takeOverDesktopLiveSession,
      abortDesktopLiveSession,
      subscribeDesktopLocalApiStream: vi.fn(),
      subscribeDesktopAppEvents: vi.fn(),
    } satisfies LocalApiModule);
    const backend = {
      ensureStarted: vi.fn(),
      getStatus: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
    } as unknown as LocalBackendProcesses;

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readConversationBootstrap?.({ conversationId: 'live-1', tailBlocks: 12 })).resolves.toEqual({
      conversationId: 'live-1',
      sessionDetail: null,
      liveSession: { live: true, id: 'live-1' },
    });
    await expect(controller.createLiveSession?.({ cwd: '/repo', model: 'gpt-5.4' })).resolves.toEqual({
      id: 'live-1',
      sessionFile: '/tmp/live-1.jsonl',
    });
    await expect(controller.resumeLiveSession?.('/tmp/live-1.jsonl')).resolves.toEqual({ id: 'live-1' });
    await expect(controller.takeOverLiveSession?.({ conversationId: 'live-1', surfaceId: 'surface-1' })).resolves.toEqual({
      controllerSurfaceId: 'surface-1',
    });
    await expect(controller.submitLiveSessionPrompt?.({
      conversationId: 'live-1',
      text: 'hello',
      surfaceId: 'surface-1',
    })).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'started' }));
    await expect(controller.abortLiveSession?.('live-1')).resolves.toEqual({ ok: true });

    expect(readDesktopConversationBootstrap).toHaveBeenCalledWith({ conversationId: 'live-1', tailBlocks: 12 });
    expect(createDesktopLiveSession).toHaveBeenCalledWith({ cwd: '/repo', model: 'gpt-5.4' });
    expect(resumeDesktopLiveSession).toHaveBeenCalledWith('/tmp/live-1.jsonl');
    expect(takeOverDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', surfaceId: 'surface-1' });
    expect(submitDesktopLiveSessionPrompt).toHaveBeenCalledWith({
      conversationId: 'live-1',
      text: 'hello',
      surfaceId: 'surface-1',
    });
    expect(abortDesktopLiveSession).toHaveBeenCalledWith('live-1');
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop app events through the local API module without loopback proxying', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopAppEvents = vi.fn().mockResolvedValue(unsubscribe);
    const loadLocalApi = vi.fn().mockResolvedValue({
      invokeDesktopLocalApi: vi.fn(),
      dispatchDesktopLocalApiRequest: vi.fn(),
      readDesktopConversationBootstrap: vi.fn(),
      createDesktopLiveSession: vi.fn(),
      resumeDesktopLiveSession: vi.fn(),
      submitDesktopLiveSessionPrompt: vi.fn(),
      takeOverDesktopLiveSession: vi.fn(),
      abortDesktopLiveSession: vi.fn(),
      subscribeDesktopLocalApiStream: vi.fn(),
      subscribeDesktopAppEvents,
    } satisfies LocalApiModule);
    const backend = {
      ensureStarted: vi.fn(),
      getStatus: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
    } as unknown as LocalBackendProcesses;

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );
    const onEvent = vi.fn();

    await expect(controller.subscribeDesktopAppEvents?.(onEvent)).resolves.toBe(unsubscribe);

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(subscribeDesktopAppEvents).toHaveBeenCalledWith(onEvent);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitDaemonEventMock = vi.fn();

vi.mock('@personal-agent/daemon', () => ({
  emitDaemonEvent: (...args: unknown[]) => emitDaemonEventMock(...args),
}));

import deferredResumeExtension from './deferred-resume.js';
import { setGatewayExtensionRuntimeContext } from './runtime-context.js';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  emitDaemonEventMock.mockReset();
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('deferred-resume gateway extension', () => {
  it('registers the deferred_resume tool and schedules a daemon event', async () => {
    let registeredTool: any;

    const pi = {
      registerTool: vi.fn((tool) => {
        registeredTool = tool;
      }),
      on: vi.fn(),
    };

    deferredResumeExtension(pi as never);
    expect(registeredTool?.name).toBe('deferred_resume');

    emitDaemonEventMock.mockResolvedValue(true);

    const sessionManager = {
      getSessionFile: () => '/tmp/sessions/123.jsonl',
    };
    setGatewayExtensionRuntimeContext(sessionManager, {
      provider: 'telegram',
      conversationId: '123',
    });

    const result = await registeredTool.execute(
      'tool-1',
      { delay: '10m', prompt: 'check the logs and continue' },
      undefined,
      undefined,
      { sessionManager },
    );

    expect(emitDaemonEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'gateway.deferred-followup.schedule',
      source: 'gateway-extension:deferred-resume',
      payload: expect.objectContaining({
        gateway: 'telegram',
        conversationId: '123',
        sessionFile: '/tmp/sessions/123.jsonl',
        prompt: 'check the logs and continue',
      }),
    }));
    expect(result.isError).not.toBe(true);
  });

  it('adds deferred resume guidance to the system prompt for gateway-bound sessions', () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();

    const pi = {
      registerTool: vi.fn(),
      on: vi.fn((eventName: string, handler: (...args: any[]) => unknown) => {
        handlers.set(eventName, handler);
      }),
    };

    deferredResumeExtension(pi as never);

    const handler = handlers.get('before_agent_start');
    expect(handler).toBeDefined();

    const sessionManager = {
      getSessionFile: () => '/tmp/sessions/123.jsonl',
    };
    setGatewayExtensionRuntimeContext(sessionManager, {
      provider: 'telegram',
      conversationId: '123',
    });

    const result = handler?.({ systemPrompt: 'base prompt' }, { sessionManager });
    expect(result).toEqual(expect.objectContaining({
      systemPrompt: expect.stringContaining('DEFERRED_RESUME_GUIDANCE'),
    }));
    expect((result as { systemPrompt: string }).systemPrompt).toContain('deferred_resume tool');
  });
});

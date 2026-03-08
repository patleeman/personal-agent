import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitDaemonEventMock = vi.fn();

vi.mock('@personal-agent/daemon', () => ({
  emitDaemonEvent: (...args: unknown[]) => emitDaemonEventMock(...args),
}));

import deferredResumeExtension, {
  buildDeferredResumeStatusText,
  loadDeferredResumeEntries,
} from './index';

const originalEnv = process.env;
const GATEWAY_RUNTIME_CONTEXT_SYMBOL = Symbol.for('personal-agent.gateway.runtime-context');

beforeEach(() => {
  process.env = { ...originalEnv };
  emitDaemonEventMock.mockReset();
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('deferred-resume shared extension', () => {
  it('loads deferred resume entries from daemon state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deferred-resume-state-'));
    const stateFile = join(dir, 'deferred-followups-state.json');

    writeFileSync(stateFile, JSON.stringify({
      version: 1,
      followUps: {
        one: {
          id: 'one',
          gateway: 'telegram',
          conversationId: 'chat-1',
          sessionFile: '/tmp/sessions/1.jsonl',
          prompt: 'continue',
          dueAt: '2026-03-08T12:00:00.000Z',
          status: 'scheduled',
          attempts: 0,
        },
      },
    }));

    expect(loadDeferredResumeEntries(stateFile)).toEqual([
      { sessionFile: '/tmp/sessions/1.jsonl' },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it('also loads generic session deferred resume entries from daemon state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-deferred-resume-state-'));
    const stateFile = join(dir, 'session-deferred-resumes-state.json');

    writeFileSync(stateFile, JSON.stringify({
      version: 1,
      resumes: {
        one: {
          id: 'one',
          sessionFile: '/tmp/sessions/2.jsonl',
          cwd: '/tmp/workspace',
          prompt: 'continue',
          dueAt: '2026-03-08T12:00:00.000Z',
          status: 'scheduled',
          attempts: 0,
        },
      },
    }));

    expect(loadDeferredResumeEntries(stateFile)).toEqual([
      { sessionFile: '/tmp/sessions/2.jsonl' },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it('builds a highlighted status when the current session has queued resumes', () => {
    const theme = {
      fg: (_tone: string, text: string) => text,
    };

    expect(buildDeferredResumeStatusText({
      totalCount: 2,
      currentSessionCount: 1,
      theme,
    })).toContain('resume:1*');
  });

  it('registers deferred_resume and schedules a generic persisted-session resume', async () => {
    let registeredTool: any;

    const pi = {
      registerTool: vi.fn((tool) => {
        registeredTool = tool;
      }),
      on: vi.fn(),
    };

    deferredResumeExtension(pi as never);
    emitDaemonEventMock.mockResolvedValue(true);

    const result = await registeredTool.execute(
      'tool-1',
      { delay: '10m', prompt: 'check the logs and continue' },
      undefined,
      undefined,
      {
        cwd: '/tmp/workspace',
        sessionManager: {
          getSessionFile: () => '/tmp/sessions/current.jsonl',
        },
        hasUI: false,
      },
    );

    expect(emitDaemonEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session.deferred-resume.schedule',
      source: 'extension:deferred-resume',
      payload: expect.objectContaining({
        sessionFile: '/tmp/sessions/current.jsonl',
        cwd: '/tmp/workspace',
        prompt: 'check the logs and continue',
      }),
    }));
    expect(result.isError).not.toBe(true);
  });

  it('schedules a gateway deferred follow-up when gateway runtime context is present', async () => {
    let registeredTool: any;

    const pi = {
      registerTool: vi.fn((tool) => {
        registeredTool = tool;
      }),
      on: vi.fn(),
    };

    deferredResumeExtension(pi as never);
    emitDaemonEventMock.mockResolvedValue(true);

    const sessionManager = {
      getSessionFile: () => '/tmp/sessions/current.jsonl',
      [GATEWAY_RUNTIME_CONTEXT_SYMBOL]: {
        provider: 'telegram' as const,
        conversationId: 'chat-123',
      },
    };

    const result = await registeredTool.execute(
      'tool-1',
      { delay: '10m', prompt: 'check the logs and continue' },
      undefined,
      undefined,
      {
        cwd: '/tmp/workspace',
        sessionManager,
        hasUI: false,
      },
    );

    expect(emitDaemonEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'gateway.deferred-followup.schedule',
      payload: expect.objectContaining({
        gateway: 'telegram',
        conversationId: 'chat-123',
        sessionFile: '/tmp/sessions/current.jsonl',
      }),
    }));
    expect(result.isError).not.toBe(true);
  });

  it('sets footer status on session start using both gateway and session resume state', async () => {
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};

    const pi = {
      registerTool: vi.fn(),
      on: (eventName: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[eventName] = handler;
      },
    };

    deferredResumeExtension(pi as never);

    const tempRoot = mkdtempSync(join(tmpdir(), 'deferred-resume-status-root-'));
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: tempRoot,
    };

    mkdirSync(join(tempRoot, 'daemon'), { recursive: true });
    writeFileSync(join(tempRoot, 'daemon', 'deferred-followups-state.json'), JSON.stringify({
      version: 1,
      followUps: {
        one: {
          id: 'one',
          gateway: 'telegram',
          conversationId: 'chat-1',
          sessionFile: '/tmp/sessions/current.jsonl',
          prompt: 'continue',
          dueAt: '2026-03-08T12:00:00.000Z',
          status: 'scheduled',
          attempts: 0,
        },
      },
    }));
    writeFileSync(join(tempRoot, 'daemon', 'session-deferred-resumes-state.json'), JSON.stringify({
      version: 1,
      resumes: {
        two: {
          id: 'two',
          sessionFile: '/tmp/sessions/other.jsonl',
          cwd: '/tmp/workspace',
          prompt: 'continue',
          dueAt: '2026-03-08T12:00:00.000Z',
          status: 'scheduled',
          attempts: 0,
        },
      },
    }));

    const setStatus = vi.fn();
    const ctx = {
      hasUI: true,
      sessionManager: {
        getSessionFile: () => '/tmp/sessions/current.jsonl',
      },
      ui: {
        setStatus,
        theme: {
          fg: (_tone: string, text: string) => text,
        },
      },
    };

    await handlers.session_start?.({}, ctx);

    const update = setStatus.mock.calls.find((call) => call[0] === 'deferred-resume');
    expect(update?.[1]).toContain('resume:1*');

    rmSync(tempRoot, { recursive: true, force: true });
  });
});

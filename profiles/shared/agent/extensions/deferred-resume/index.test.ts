import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import deferredResumeStatusExtension, {
  buildDeferredResumeStatusText,
  loadDeferredResumeEntries,
} from './index';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('deferred-resume status extension', () => {
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

  it('sets footer status on session start', async () => {
    const handlers: Record<string, (...args: any[]) => Promise<void>> = {};

    const pi = {
      on: (eventName: string, handler: (...args: any[]) => Promise<void>) => {
        handlers[eventName] = handler;
      },
    };

    deferredResumeStatusExtension(pi as never);

    const tempRoot = mkdtempSync(join(tmpdir(), 'deferred-resume-status-root-'));
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: tempRoot,
    };

    const stateFile = join(tempRoot, 'daemon', 'deferred-followups-state.json');
    mkdirSync(join(tempRoot, 'daemon'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({
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

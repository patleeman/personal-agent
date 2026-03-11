import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import deferredResumeExtension, {
  buildDeferredResumeStatusText,
  loadDeferredResumeEntries,
  resolveDeferredResumeStateFile,
} from './index';

const originalEnv = process.env;
const GATEWAY_RUNTIME_CONTEXT_SYMBOL = Symbol.for('personal-agent.gateway.runtime-context');

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

function setupExtension(): {
  registeredTool: any;
  handlers: Record<string, (...args: any[]) => Promise<void> | void>;
  commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> | void }>;
  sendUserMessage: ReturnType<typeof vi.fn>;
} {
  let registeredTool: any;
  const handlers: Record<string, (...args: any[]) => Promise<void> | void> = {};
  const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> | void }> = {};
  const sendUserMessage = vi.fn();

  const pi = {
    registerTool: vi.fn((tool) => {
      registeredTool = tool;
    }),
    registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: any) => Promise<void> | void }) => {
      commands[name] = command;
    }),
    on: vi.fn((event: string, handler: (...args: any[]) => Promise<void> | void) => {
      handlers[event] = handler;
    }),
    sendUserMessage,
  };

  deferredResumeExtension(pi as never);

  return {
    registeredTool,
    handlers,
    commands,
    sendUserMessage,
  };
}

function createContext(sessionFile: string): {
  cwd: string;
  hasUI: boolean;
  isIdle: () => boolean;
  sessionManager: { getSessionFile: () => string };
  ui: {
    notify: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    theme: { fg: (_tone: string, text: string) => string };
  };
} {
  return {
    cwd: '/tmp/workspace',
    hasUI: true,
    isIdle: () => true,
    sessionManager: {
      getSessionFile: () => sessionFile,
    },
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: {
        fg: (_tone: string, text: string) => text,
      },
    },
  };
}

function createSessionFile(root: string, sessionId = 'conv-123'): string {
  const sessionDir = join(root, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const sessionFile = join(sessionDir, `${sessionId}.jsonl`);
  writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: sessionId, timestamp: '2026-03-10T12:00:00.000Z', cwd: '/tmp/workspace' }) + '\n');
  return sessionFile;
}

describe('deferred-resume shared extension (TUI-only)', () => {
  it('loads deferred resume entries from local state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deferred-resume-state-'));
    const stateFile = join(dir, 'state.json');

    writeFileSync(stateFile, JSON.stringify({
      version: 1,
      resumes: {
        one: {
          id: 'one',
          sessionFile: '/tmp/sessions/1.jsonl',
          prompt: 'continue',
          dueAt: '2026-03-08T12:00:00.000Z',
          createdAt: '2026-03-08T11:50:00.000Z',
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

  it('registers deferred_resume and persists scheduled state', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'deferred-resume-local-'));
    const sessionFile = createSessionFile(tempRoot, 'conv-scheduled');
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: tempRoot,
    };

    const { registeredTool } = setupExtension();
    const ctx = createContext(sessionFile);

    const result = await registeredTool.execute(
      'tool-1',
      { delay: '10m', prompt: 'check the logs and continue' },
      undefined,
      undefined,
      ctx,
    );

    expect(result.isError).not.toBe(true);

    const stateFile = resolveDeferredResumeStateFile();
    const persisted = JSON.parse(readFileSync(stateFile, 'utf-8')) as {
      resumes: Record<string, { sessionFile: string; prompt: string; status: string }>;
    };

    const entries = Object.values(persisted.resumes);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(expect.objectContaining({
      sessionFile,
      prompt: 'check the logs and continue',
      status: 'scheduled',
    }));

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('rejects deferred_resume in gateway-bound sessions', async () => {
    const { registeredTool } = setupExtension();

    const sessionManager = {
      getSessionFile: () => '/tmp/sessions/current.jsonl',
      [GATEWAY_RUNTIME_CONTEXT_SYMBOL]: {
        provider: 'telegram' as const,
        conversationId: 'chat-123',
      },
    };

    const result = await registeredTool.execute(
      'tool-1',
      { delay: '10m', prompt: 'continue' },
      undefined,
      undefined,
      {
        cwd: '/tmp/workspace',
        hasUI: true,
        isIdle: () => true,
        sessionManager,
        ui: {
          notify: vi.fn(),
          setStatus: vi.fn(),
          theme: {
            fg: (_tone: string, text: string) => text,
          },
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('disabled in gateway');
  });

  it('lists and cancels deferred resumes with /deferred', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'deferred-resume-command-'));
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: tempRoot,
    };

    const stateFile = resolveDeferredResumeStateFile();
    mkdirSync(join(tempRoot, 'pi-agent'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({
      version: 1,
      resumes: {
        keep: {
          id: 'keep',
          sessionFile: '/tmp/sessions/other.jsonl',
          prompt: 'other session',
          dueAt: '2026-03-08T12:00:00.000Z',
          createdAt: '2026-03-08T11:50:00.000Z',
          attempts: 0,
        },
        remove: {
          id: 'remove',
          sessionFile: '/tmp/sessions/current.jsonl',
          prompt: 'current session',
          dueAt: '2026-03-08T12:01:00.000Z',
          createdAt: '2026-03-08T11:50:00.000Z',
          attempts: 0,
        },
      },
    }));

    const { commands } = setupExtension();
    const ctx = createContext('/tmp/sessions/current.jsonl');

    await commands.deferred.handler('', ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('remove'), 'info');
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining('keep'), 'info');

    await commands.deferred.handler('cancel remove', ctx);

    const persisted = JSON.parse(readFileSync(stateFile, 'utf-8')) as {
      resumes: Record<string, unknown>;
    };

    expect(Object.keys(persisted.resumes)).toEqual(['keep']);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('delivers due resumes in-session on session start and clears them from state', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'deferred-resume-delivery-'));
    const sessionFile = createSessionFile(tempRoot, 'conv-delivery');
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: tempRoot,
    };

    const stateFile = resolveDeferredResumeStateFile();
    mkdirSync(join(tempRoot, 'pi-agent'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({
      version: 1,
      resumes: {
        due: {
          id: 'due',
          sessionFile,
          prompt: 'resume now',
          dueAt: '2026-03-08T12:00:00.000Z',
          createdAt: '2026-03-08T11:59:00.000Z',
          attempts: 0,
        },
      },
    }));

    const { handlers, sendUserMessage } = setupExtension();
    const ctx = createContext(sessionFile);

    await handlers.session_start?.({}, ctx);

    expect(sendUserMessage).toHaveBeenCalledWith('resume now');

    const persisted = JSON.parse(readFileSync(stateFile, 'utf-8')) as {
      resumes: Record<string, unknown>;
    };
    expect(Object.keys(persisted.resumes)).toEqual([]);

    await handlers.session_shutdown?.({}, ctx);
    rmSync(tempRoot, { recursive: true, force: true });
  });
});

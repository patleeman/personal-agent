import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSessionFileExists, getLiveSessions, patchSessionManagerPersistence, registry, renameSession, resolvePersistentSessionDir, subscribe, toSse, type SseEvent } from './liveSessions.js';

const tempDirs: string[] = [];

afterEach(() => {
  registry.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('live session subscriptions', () => {
  it('replays a snapshot of the current live conversation before future events', () => {
    registry.set('session-1', {
      sessionId: 'session-1',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: '',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      session: {
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'How do I fix this?' }],
              timestamp: 1,
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Start by checking the live session snapshot.' }],
              timestamp: 2,
            },
          ],
          streamMessage: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Rebuilding the visible transcript…' }],
            timestamp: 3,
          },
        },
        getContextUsage: () => null,
        isStreaming: true,
      },
    } as any);

    const events: SseEvent[] = [];
    const unsubscribe = subscribe('session-1', (event) => {
      events.push(event);
    });

    expect(unsubscribe).toBeTypeOf('function');
    expect(events[0]).toEqual({
      type: 'snapshot',
      blocks: [
        {
          type: 'user',
          id: 'live-0',
          ts: new Date(1).toISOString(),
          text: 'How do I fix this?',
        },
        {
          type: 'text',
          id: 'live-1-x1',
          ts: new Date(2).toISOString(),
          text: 'Start by checking the live session snapshot.',
        },
        {
          type: 'thinking',
          id: 'live-2-t2',
          ts: new Date(3).toISOString(),
          text: 'Rebuilding the visible transcript…',
        },
      ],
    });
    expect(events[1]).toEqual({ type: 'title_update', title: 'How do I fix this?' });
    expect(events[2]).toEqual({ type: 'context_usage', usage: null });
    expect(events[3]).toEqual({ type: 'queue_state', steering: [], followUp: [] });
    expect(events[4]).toEqual({ type: 'agent_start' });
  });

  it('includes the current live title in live session snapshots', () => {
    registry.set('session-2', {
      sessionId: 'session-2',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: '',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      session: {
        sessionFile: '/tmp/workspace/session-2.jsonl',
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Keep this sidebar title fresh' }],
              timestamp: 1,
            },
          ],
          streamMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    } as any);

    expect(getLiveSessions()).toEqual([
      {
        id: 'session-2',
        cwd: '/tmp/workspace',
        sessionFile: '/tmp/workspace/session-2.jsonl',
        title: 'Keep this sidebar title fresh',
        isStreaming: false,
      },
    ]);
  });

  it('prefers the persisted session name over the first user message fallback', () => {
    registry.set('session-3', {
      sessionId: 'session-3',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: '',
      autoTitleRequested: true,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile: '/tmp/workspace/session-3.jsonl',
        sessionName: 'Generated title',
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Fallback first prompt' }],
              timestamp: 1,
            },
          ],
          streamMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    } as any);

    expect(getLiveSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-3',
      title: 'Generated title',
    }));

    const events: SseEvent[] = [];
    subscribe('session-3', (event) => {
      events.push(event);
    });

    expect(events[1]).toEqual({ type: 'title_update', title: 'Generated title' });
  });

  it('broadcasts manual renames immediately', () => {
    const session = {
      sessionFile: '/tmp/workspace/session-rename.jsonl',
      sessionName: undefined as string | undefined,
      state: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Fallback first prompt' }],
            timestamp: 1,
          },
        ],
        streamMessage: null,
      },
      getContextUsage: () => null,
      isStreaming: false,
      setSessionName: vi.fn((name: string) => {
        session.sessionName = name;
      }),
    };

    registry.set('session-rename', {
      sessionId: 'session-rename',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: '',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session,
    } as any);

    const events: SseEvent[] = [];
    subscribe('session-rename', (event) => {
      events.push(event);
    });
    events.length = 0;

    renameSession('session-rename', 'Better generated title');

    expect(session.setSessionName).toHaveBeenCalledWith('Better generated title');
    expect(getLiveSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-rename',
      title: 'Better generated title',
    }));
    expect(events).toContainEqual({ type: 'title_update', title: 'Better generated title' });
  });
});

describe('event translation', () => {
  it('surfaces user messages from message_start events immediately', () => {
    expect(toSse({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Show this prompt right away.' }],
        timestamp: 1,
      },
    } as any)).toEqual({
      type: 'user_message',
      block: {
        type: 'user',
        id: 'live-user',
        ts: new Date(1).toISOString(),
        text: 'Show this prompt right away.',
      },
    });
  });

  it('ignores user message_end events to avoid duplicate rows', () => {
    expect(toSse({
      type: 'message_end',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Show this prompt right away.' }],
        timestamp: 1,
      },
    } as any)).toBeNull();
  });

  it('surfaces assistant error messages from message_end events', () => {
    expect(toSse({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Codex error: upstream overloaded',
        timestamp: 1,
      },
    } as any)).toEqual({
      type: 'error',
      message: 'Codex error: upstream overloaded',
    });
  });
});

describe('session directory resolution', () => {
  it('stores web-created sessions under cwd-specific subdirectories', () => {
    expect(resolvePersistentSessionDir('/Users/patrick/workingdir/personal-agent')).toBe(
      join(homedir(), '.local/state/personal-agent/pi-agent', 'sessions', '--Users-patrick-workingdir-personal-agent--'),
    );
  });
});

describe('session file persistence', () => {
  it('creates a session file immediately for a brand-new session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session.jsonl');

    const manager = {
      persist: true,
      sessionFile,
      flushed: false,
      _rewriteFile() {
        this.flushed = false;
        writeFileSync(sessionFile, '{"type":"session","id":"session-1"}\n');
      },
    };

    ensureSessionFileExists(manager as any);

    expect(existsSync(sessionFile)).toBe(true);
    expect(manager.flushed).toBe(true);
    expect(readFileSync(sessionFile, 'utf-8')).toContain('"type":"session"');
  });

  it('persists user-only session state instead of waiting for the first assistant reply', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session.jsonl');
    const entries: unknown[] = [
      { type: 'session', id: 'session-1' },
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp: '2026-03-11T16:55:00.000Z',
        message: { role: 'user', content: 'Keep this draft alive.' },
      },
    ];

    const manager = {
      persist: true,
      sessionFile,
      flushed: false,
      fileEntries: entries,
      _rewriteFile() {
        writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
      },
    } as any;

    patchSessionManagerPersistence(manager);
    manager._persist?.(entries[1]);

    expect(manager.flushed).toBe(true);
    expect(readFileSync(sessionFile, 'utf-8')).toContain('Keep this draft alive.');
  });
});

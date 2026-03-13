import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureSessionFileExists,
  getLiveSessions,
  patchSessionManagerPersistence,
  registry,
  renameSession,
  resolvePersistentSessionDir,
  restoreQueuedMessage,
  subscribe,
  toSse,
  type SseEvent,
} from './liveSessions.js';
import { clearSessionCaches } from './sessions.js';

const tempDirs: string[] = [];

afterEach(() => {
  registry.clear();
  clearSessionCaches();
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
      title: 'How do I fix this?',
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

  it('merges persisted history into truncated live snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-merged.jsonl');
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'session', id: 'session-merged', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
      JSON.stringify({
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp: '2026-03-13T18:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'First prompt' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        timestamp: '2026-03-13T18:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'user-2',
        parentId: 'assistant-1',
        timestamp: '2026-03-13T18:00:03.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Second prompt' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-2',
        parentId: 'user-2',
        timestamp: '2026-03-13T18:00:04.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] },
      }),
      '',
    ].join('\n'));

    registry.set('session-merged', {
      sessionId: 'session-merged',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Merged transcript',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile,
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Second prompt' }],
              timestamp: '2026-03-13T18:00:03.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Second answer' }],
              timestamp: '2026-03-13T18:00:04.000Z',
            },
          ],
          streamMessage: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Planning the next step' }],
            timestamp: '2026-03-13T18:00:05.000Z',
          },
        },
        getContextUsage: () => null,
        isStreaming: true,
      },
    } as any);

    const events: SseEvent[] = [];
    subscribe('session-merged', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blocks: [
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:01.000Z',
          text: 'First prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:02.000Z',
          text: 'First answer',
        },
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:03.000Z',
          text: 'Second prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:04.000Z',
          text: 'Second answer',
        },
        {
          type: 'thinking',
          id: 'live-2-t2',
          ts: '2026-03-13T18:00:05.000Z',
          text: 'Planning the next step',
        },
      ],
    });
  });

  it('includes compaction summaries in the live snapshot', () => {
    registry.set('session-summary', {
      sessionId: 'session-summary',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Compacted conversation',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: {
          messages: [
            {
              role: 'compactionSummary',
              summary: '## Goal\nKeep the compacted context visible.',
              timestamp: 1,
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Continue from the summary' }],
              timestamp: 2,
            },
          ],
          streamMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    } as any);

    const events: SseEvent[] = [];
    subscribe('session-summary', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blocks: [
        {
          type: 'summary',
          id: 'live-0',
          ts: new Date(1).toISOString(),
          kind: 'compaction',
          title: 'Compaction summary',
          text: '## Goal\nKeep the compacted context visible.',
        },
        {
          type: 'user',
          id: 'live-1',
          ts: new Date(2).toISOString(),
          text: 'Continue from the summary',
        },
      ],
    });
  });

  it('uses the persisted transcript for idle live sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-live-sessions-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session-idle.jsonl');
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'session', id: 'session-idle', timestamp: '2026-03-13T18:00:00.000Z', cwd: '/tmp/workspace' }),
      JSON.stringify({
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp: '2026-03-13T18:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'First prompt' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        timestamp: '2026-03-13T18:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'user-2',
        parentId: 'assistant-1',
        timestamp: '2026-03-13T18:00:03.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Second prompt' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-2',
        parentId: 'user-2',
        timestamp: '2026-03-13T18:00:04.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] },
      }),
      '',
    ].join('\n'));

    registry.set('session-idle', {
      sessionId: 'session-idle',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Keep this sidebar title fresh',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      session: {
        sessionFile,
        state: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Second prompt' }],
              timestamp: '2026-03-13T18:00:03.000Z',
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Second answer' }],
              timestamp: '2026-03-13T18:00:04.000Z',
            },
          ],
          streamMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    } as any);

    const events: SseEvent[] = [];
    subscribe('session-idle', (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({
      type: 'snapshot',
      blocks: [
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:01.000Z',
          text: 'First prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:02.000Z',
          text: 'First answer',
        },
        {
          type: 'user',
          id: expect.any(String),
          ts: '2026-03-13T18:00:03.000Z',
          text: 'Second prompt',
        },
        {
          type: 'text',
          id: expect.any(String),
          ts: '2026-03-13T18:00:04.000Z',
          text: 'Second answer',
        },
      ],
    });
  });

  it('includes the current live title in live session snapshots', () => {
    registry.set('session-2', {
      sessionId: 'session-2',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Keep this sidebar title fresh',
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

  it('keeps the sticky conversation title even if in-memory messages shift later', () => {
    registry.set('session-sticky', {
      sessionId: 'session-sticky',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Original conversation title',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        sessionFile: '/tmp/workspace/session-sticky.jsonl',
        state: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Compaction summary' }],
              timestamp: 1,
            },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Most recent prompt after compaction' }],
              timestamp: 2,
            },
          ],
          streamMessage: null,
        },
        getContextUsage: () => null,
        isStreaming: false,
      },
    } as any);

    expect(getLiveSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-sticky',
      title: 'Original conversation title',
    }));

    const events: SseEvent[] = [];
    subscribe('session-sticky', (event) => {
      events.push(event);
    });

    expect(events[1]).toEqual({ type: 'title_update', title: 'Original conversation title' });
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

describe('queued prompt restore', () => {
  it('restores a queued prompt back to the composer payload without disturbing other queued items', () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const steeringQueue = [
      { role: 'custom', content: 'hidden steer context' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'first queued prompt' }],
      },
      { role: 'custom', content: 'more hidden steer context' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'second queued prompt' },
          { type: 'image', data: 'b64-image', mimeType: 'image/png' },
        ],
      },
    ];

    registry.set('session-queue-restore', {
      sessionId: 'session-queue-restore',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: 'Restore queued prompt',
      autoTitleRequested: false,
      lastContextUsageJson: null,
      lastQueueStateJson: null,
      session: {
        state: { messages: [], streamMessage: null },
        getContextUsage: () => null,
        isStreaming: true,
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        agent: {
          steeringQueue,
          followUpQueue: [],
        },
      },
    } as any);

    const events: SseEvent[] = [];
    subscribe('session-queue-restore', (event) => {
      events.push(event);
    });
    events.length = 0;

    const restored = restoreQueuedMessage('session-queue-restore', 'steer', 1);

    expect(restored).toEqual({
      text: 'second queued prompt',
      images: [{ type: 'image', data: 'b64-image', mimeType: 'image/png' }],
    });
    expect(steeringMessages).toEqual(['first queued prompt']);
    expect(steeringQueue).toEqual([
      { role: 'custom', content: 'hidden steer context' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'first queued prompt' }],
      },
      { role: 'custom', content: 'more hidden steer context' },
    ]);
    expect(events).toContainEqual({ type: 'queue_state', steering: ['first queued prompt'], followUp: [] });
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

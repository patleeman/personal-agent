import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSessionFileExists, getLiveSessions, patchSessionManagerPersistence, registry, subscribe, type SseEvent } from './liveSessions.js';

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
      sentTitle: false,
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
    expect(events[3]).toEqual({ type: 'agent_start' });
  });

  it('includes the current live title in live session snapshots', () => {
    registry.set('session-2', {
      sessionId: 'session-2',
      cwd: '/tmp/workspace',
      listeners: new Set(),
      title: '',
      sentTitle: false,
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

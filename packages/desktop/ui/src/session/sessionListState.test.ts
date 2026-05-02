import { describe, expect, it } from 'vitest';

import type { SessionMeta } from '../shared/types';
import {
  mergeSessionSnapshotPreservingOrder,
  removeSessionMetaPreservingOrder,
  replaceSessionMetaPreservingOrder,
} from './sessionListState';

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? 'conv-1',
    file: overrides.file ?? `/tmp/${overrides.id ?? 'conv-1'}.jsonl`,
    timestamp: overrides.timestamp ?? '2026-04-07T12:00:00.000Z',
    cwd: overrides.cwd ?? '/tmp/project',
    cwdSlug: overrides.cwdSlug ?? 'project',
    model: overrides.model ?? 'openai/gpt-test',
    title: overrides.title ?? 'Conversation',
    messageCount: overrides.messageCount ?? 1,
    ...overrides,
  };
}

describe('sessionListState', () => {
  it('keeps the existing relative order when a fresh snapshot arrives', () => {
    const previousSessions = [
      createSession({ id: 'alpha', title: 'Alpha' }),
      createSession({ id: 'beta', title: 'Beta' }),
      createSession({ id: 'gamma', title: 'Gamma' }),
    ];
    const nextSnapshot = [
      createSession({ id: 'gamma', title: 'Gamma refreshed' }),
      createSession({ id: 'alpha', title: 'Alpha refreshed' }),
      createSession({ id: 'delta', title: 'Delta' }),
      createSession({ id: 'beta', title: 'Beta refreshed' }),
    ];

    expect(mergeSessionSnapshotPreservingOrder(previousSessions, nextSnapshot)).toEqual([
      createSession({ id: 'alpha', title: 'Alpha refreshed' }),
      createSession({ id: 'beta', title: 'Beta refreshed' }),
      createSession({ id: 'gamma', title: 'Gamma refreshed' }),
      createSession({ id: 'delta', title: 'Delta' }),
    ]);
  });

  it('replaces a session in place without changing surrounding order', () => {
    const sessions = [
      createSession({ id: 'alpha', title: 'Alpha' }),
      createSession({ id: 'beta', title: 'Beta' }),
      createSession({ id: 'gamma', title: 'Gamma' }),
    ];

    expect(
      replaceSessionMetaPreservingOrder(
        sessions,
        createSession({
          id: 'beta',
          title: 'Beta refreshed',
          lastActivityAt: '2026-04-07T12:30:00.000Z',
        }),
      ),
    ).toEqual([
      createSession({ id: 'alpha', title: 'Alpha' }),
      createSession({
        id: 'beta',
        title: 'Beta refreshed',
        lastActivityAt: '2026-04-07T12:30:00.000Z',
      }),
      createSession({ id: 'gamma', title: 'Gamma' }),
    ]);
  });

  it('appends brand new sessions at the end', () => {
    const sessions = [createSession({ id: 'alpha', title: 'Alpha' }), createSession({ id: 'beta', title: 'Beta' })];

    expect(replaceSessionMetaPreservingOrder(sessions, createSession({ id: 'gamma', title: 'Gamma' }))).toEqual([
      createSession({ id: 'alpha', title: 'Alpha' }),
      createSession({ id: 'beta', title: 'Beta' }),
      createSession({ id: 'gamma', title: 'Gamma' }),
    ]);
  });

  it('removes a session without disturbing the remaining order', () => {
    const sessions = [
      createSession({ id: 'alpha', title: 'Alpha' }),
      createSession({ id: 'beta', title: 'Beta' }),
      createSession({ id: 'gamma', title: 'Gamma' }),
    ];

    expect(removeSessionMetaPreservingOrder(sessions, 'beta')).toEqual([
      createSession({ id: 'alpha', title: 'Alpha' }),
      createSession({ id: 'gamma', title: 'Gamma' }),
    ]);
  });
});

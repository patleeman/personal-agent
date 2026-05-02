import { describe, expect, it } from 'vitest';

import { normalizeAppEvent } from './appEventTransport';

describe('normalizeAppEvent', () => {
  it('drops connected events and maps durable run snapshots onto desktop app events', () => {
    expect(normalizeAppEvent({ type: 'connected' })).toBeNull();
    expect(
      normalizeAppEvent({
        type: 'runs_snapshot',
        result: {
          scannedAt: '2026-04-10T10:00:00.000Z',
          runsRoot: '/tmp/runs',
          summary: { total: 0, recoveryActions: {}, statuses: {} },
          runs: [],
        },
      }),
    ).toEqual({
      type: 'runs',
      result: {
        scannedAt: '2026-04-10T10:00:00.000Z',
        runsRoot: '/tmp/runs',
        summary: { total: 0, recoveryActions: {}, statuses: {} },
        runs: [],
      },
    });
  });

  it('passes through invalidation and conversation events unchanged', () => {
    expect(normalizeAppEvent({ type: 'invalidate', topics: ['workspace', 'attachments'] })).toEqual({
      type: 'invalidate',
      topics: ['workspace', 'attachments'],
    });
    expect(normalizeAppEvent({ type: 'session_meta_changed', sessionId: 'conversation-1' })).toEqual({
      type: 'session_meta_changed',
      sessionId: 'conversation-1',
    });
  });
});

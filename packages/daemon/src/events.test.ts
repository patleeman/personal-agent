import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDaemonEvent, DAEMON_EVENT_VERSION, isDaemonEvent } from './events.js';

describe('daemon events', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates daemon events with defaults', () => {
    const event = createDaemonEvent({ type: 'task.started', source: 'tasks' });

    expect(event.id.startsWith('evt_')).toBe(true);
    expect(event.version).toBe(DAEMON_EVENT_VERSION);
    expect(event.type).toBe('task.started');
    expect(event.source).toBe('tasks');
    expect(event.payload).toEqual({});
    expect(isDaemonEvent(event)).toBe(true);
  });

  it('respects explicit id/timestamp/payload', () => {
    const event = createDaemonEvent({
      id: 'evt_custom',
      type: 'task.done',
      source: 'runner',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { id: 'task-1' },
    });

    expect(event).toMatchObject({
      id: 'evt_custom',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { id: 'task-1' },
    });
  });

  it('falls back to the current clock for malformed explicit timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    expect(
      createDaemonEvent({
        type: 'task.done',
        source: 'runner',
        timestamp: 'not-a-date',
      }).timestamp,
    ).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to the current clock for non-ISO explicit timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    expect(
      createDaemonEvent({
        type: 'task.done',
        source: 'runner',
        timestamp: '1',
      }).timestamp,
    ).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects daemon event shapes with non-ISO timestamps', () => {
    expect(
      isDaemonEvent({
        id: 'x',
        version: 1,
        type: 't',
        source: 's',
        timestamp: '1',
        payload: {},
      }),
    ).toBe(false);
  });

  it('rejects non-daemon event shapes', () => {
    expect(isDaemonEvent(null)).toBe(false);
    expect(isDaemonEvent({})).toBe(false);
    expect(
      isDaemonEvent({
        id: 'x',
        version: 1,
        type: 't',
        source: 's',
        timestamp: 'now',
        payload: {},
      }),
    ).toBe(false);
    expect(
      isDaemonEvent({
        id: 'x',
        version: 1,
        type: 't',
        source: 's',
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: null,
      }),
    ).toBe(false);
  });
});

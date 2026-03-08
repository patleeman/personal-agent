import { describe, expect, it } from 'vitest';
import { createDaemonEvent } from './events.js';
import { parseRequest } from './ipc-protocol.js';

describe('parseRequest', () => {
  it('parses emit request', () => {
    const request = {
      id: 'req_1',
      type: 'emit',
      event: createDaemonEvent({
        type: 'session.updated',
        source: 'test',
        payload: {},
      }),
    };

    const parsed = parseRequest(JSON.stringify(request));
    expect(parsed.type).toBe('emit');
  });

  it('parses notifications.pull request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_2',
      type: 'notifications.pull',
      gateway: 'telegram',
      limit: 10,
    }));

    expect(parsed).toEqual({
      id: 'req_2',
      type: 'notifications.pull',
      gateway: 'telegram',
      limit: 10,
    });
  });

  it('parses deferred-followups.pull request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_3',
      type: 'deferred-followups.pull',
      gateway: 'discord',
      limit: 5,
    }));

    expect(parsed).toEqual({
      id: 'req_3',
      type: 'deferred-followups.pull',
      gateway: 'discord',
      limit: 5,
    });
  });

  it('rejects invalid envelope', () => {
    expect(() => parseRequest(JSON.stringify({ nope: true }))).toThrow('Invalid request envelope');
  });
});

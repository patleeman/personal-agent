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

  it('rejects invalid envelope', () => {
    expect(() => parseRequest(JSON.stringify({ nope: true }))).toThrow('Invalid request envelope');
  });
});

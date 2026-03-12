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

  it('parses runs.list request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_3',
      type: 'runs.list',
    }));

    expect(parsed).toEqual({
      id: 'req_3',
      type: 'runs.list',
    });
  });

  it('parses runs.get request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_4',
      type: 'runs.get',
      runId: 'run-123',
    }));

    expect(parsed).toEqual({
      id: 'req_4',
      type: 'runs.get',
      runId: 'run-123',
    });
  });

  it('rejects runs.get request without runId', () => {
    expect(() => parseRequest(JSON.stringify({
      id: 'req_5',
      type: 'runs.get',
      runId: '',
    }))).toThrow('runs.get runId must be a non-empty string');
  });

  it('rejects invalid envelope', () => {
    expect(() => parseRequest(JSON.stringify({ nope: true }))).toThrow('Invalid request envelope');
  });
});

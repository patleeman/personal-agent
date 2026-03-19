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

  it('parses runs.startTask request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_6',
      type: 'runs.startTask',
      filePath: '/tmp/task.task.md',
    }));

    expect(parsed).toEqual({
      id: 'req_6',
      type: 'runs.startTask',
      filePath: '/tmp/task.task.md',
    });
  });

  it('rejects runs.startTask request without filePath', () => {
    expect(() => parseRequest(JSON.stringify({
      id: 'req_7',
      type: 'runs.startTask',
      filePath: '',
    }))).toThrow('runs.startTask filePath must be a non-empty string');
  });

  it('parses runs.startBackground request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_7b',
      type: 'runs.startBackground',
      input: {
        taskSlug: 'code-review',
        cwd: '/tmp/work',
        argv: ['pa', '-p', 'hello'],
        source: {
          type: 'cli',
          id: 'code-review',
        },
      },
    }));

    expect(parsed).toEqual({
      id: 'req_7b',
      type: 'runs.startBackground',
      input: {
        taskSlug: 'code-review',
        cwd: '/tmp/work',
        argv: ['pa', '-p', 'hello'],
        source: {
          type: 'cli',
          id: 'code-review',
        },
      },
    });
  });

  it('parses runs.startBackground agent request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_7ba',
      type: 'runs.startBackground',
      input: {
        taskSlug: 'subagent',
        cwd: '/tmp/work',
        agent: {
          prompt: 'Review the latest diff',
          profile: 'datadog',
          model: 'openai-codex/gpt-5.4',
          noSession: true,
        },
      },
    }));

    expect(parsed).toEqual({
      id: 'req_7ba',
      type: 'runs.startBackground',
      input: {
        taskSlug: 'subagent',
        cwd: '/tmp/work',
        agent: {
          prompt: 'Review the latest diff',
          profile: 'datadog',
          model: 'openai-codex/gpt-5.4',
          noSession: true,
        },
      },
    });
  });

  it('parses runs.startBackground manifest metadata and checkpoint payload', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_7bb',
      type: 'runs.startBackground',
      input: {
        taskSlug: 'remote-run',
        cwd: '/tmp/work',
        shellCommand: 'node worker.mjs',
        manifestMetadata: {
          remoteExecution: {
            targetId: 'gpu-box',
          },
        },
        checkpointPayload: {
          remoteExecution: {
            import: {
              status: 'not_ready',
            },
          },
        },
      },
    }));

    expect(parsed).toEqual({
      id: 'req_7bb',
      type: 'runs.startBackground',
      input: {
        taskSlug: 'remote-run',
        cwd: '/tmp/work',
        shellCommand: 'node worker.mjs',
        manifestMetadata: {
          remoteExecution: {
            targetId: 'gpu-box',
          },
        },
        checkpointPayload: {
          remoteExecution: {
            import: {
              status: 'not_ready',
            },
          },
        },
      },
    });
  });

  it('parses runs.cancel request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_7c',
      type: 'runs.cancel',
      runId: 'run-code-review-2026-03-12',
    }));

    expect(parsed).toEqual({
      id: 'req_7c',
      type: 'runs.cancel',
      runId: 'run-code-review-2026-03-12',
    });
  });

  it('parses conversations.sync request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_8',
      type: 'conversations.sync',
      input: {
        conversationId: 'conv-123',
        sessionFile: '/tmp/conv-123.jsonl',
        cwd: '/tmp',
        state: 'running',
        pendingOperation: {
          type: 'prompt',
          text: 'continue',
          enqueuedAt: '2026-03-12T17:00:00.000Z',
        },
      },
    }));

    expect(parsed).toEqual({
      id: 'req_8',
      type: 'conversations.sync',
      input: {
        conversationId: 'conv-123',
        sessionFile: '/tmp/conv-123.jsonl',
        cwd: '/tmp',
        state: 'running',
        pendingOperation: {
          type: 'prompt',
          text: 'continue',
          enqueuedAt: '2026-03-12T17:00:00.000Z',
        },
      },
    });
  });

  it('parses conversations.recoverable request', () => {
    const parsed = parseRequest(JSON.stringify({
      id: 'req_9',
      type: 'conversations.recoverable',
    }));

    expect(parsed).toEqual({
      id: 'req_9',
      type: 'conversations.recoverable',
    });
  });

  it('rejects invalid envelope', () => {
    expect(() => parseRequest(JSON.stringify({ nope: true }))).toThrow('Invalid request envelope');
  });
});

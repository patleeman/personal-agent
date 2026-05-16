import { describe, expect, it, vi } from 'vitest';

const mockWorkerPostMessage = vi.fn();
const mockWorkerOn = vi.fn();
const mockWorkerTerminate = vi.fn();

vi.mock('node:worker_threads', () => {
  function MockWorker(this: { postMessage: unknown; on: unknown; terminate: unknown }) {
    this.postMessage = mockWorkerPostMessage;
    this.on = mockWorkerOn;
    this.terminate = mockWorkerTerminate;
  }
  return { Worker: MockWorker as unknown as (typeof import('node:worker_threads'))['Worker'] };
});

import { LocalApiWorkerClient } from './local-api-worker-client.js';

describe('LocalApiWorkerClient', () => {
  it('creates a worker on first call and posts a message', () => {
    const client = new LocalApiWorkerClient();
    client.call('testMethod', ['arg1']);

    // Worker should be created
    expect(mockWorkerOn).toHaveBeenCalled();

    // message handler should have been registered via .on('message', ...)
    const messageHandlerCall = mockWorkerOn.mock.calls.find((call: unknown[]) => call[0] === 'message');
    expect(messageHandlerCall).toBeDefined();

    // postMessage should have been called with request
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(expect.objectContaining({ methodName: 'testMethod', args: ['arg1'] }));
  });
});

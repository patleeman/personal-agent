import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}));

import { SshRemoteConversationRuntime } from './ssh-remote-runtime.js';

describe('SshRemoteConversationRuntime', () => {
  it('ignores helper greeting responses without ids and continues parsing later responses', () => {
    const runtime = new SshRemoteConversationRuntime('patrick@bender', 'bender', 'Bender');
    const resolve = vi.fn();
    const reject = vi.fn();

    (runtime as unknown as {
      pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
      handleSocketData(fragment: string): void;
    }).pendingRequests.set('req-1', { resolve, reject });

    (runtime as unknown as {
      handleSocketData(fragment: string): void;
    }).handleSocketData([
      JSON.stringify({ type: 'response', ok: true, data: { connected: true, helperVersion: '1' } }),
      JSON.stringify({ type: 'response', id: 'req-1', ok: true, data: { cwd: '/tmp' } }),
      '',
    ].join('\n'));

    expect(resolve).toHaveBeenCalledWith({ cwd: '/tmp' });
    expect(reject).not.toHaveBeenCalled();
  });
});

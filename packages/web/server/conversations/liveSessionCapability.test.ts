import { describe, expect, it } from 'vitest';
import { restoreQueuedLiveSessionMessageCapability } from './liveSessionCapability.js';

describe('liveSessionCapability input validation', () => {
  it('rejects unsafe queued restore indexes before reading session state', async () => {
    await expect(restoreQueuedLiveSessionMessageCapability({
      conversationId: 'session-1',
      behavior: 'steer',
      index: Number.MAX_SAFE_INTEGER + 1,
    })).rejects.toThrow('index must be a non-negative integer');
  });
});

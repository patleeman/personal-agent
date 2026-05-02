import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client/api', () => ({
  api: {
    sessions: vi.fn(),
  },
}));

import { api } from '../client/api';
import { fetchSessionsSnapshot } from './sessionSnapshot';

describe('fetchSessionsSnapshot', () => {
  beforeEach(() => {
    vi.mocked(api.sessions).mockReset();
  });

  it('uses the server-authoritative sessions snapshot directly', async () => {
    const sessions = [{ id: 'conv-1', title: 'Conversation', file: '/tmp/conv-1.jsonl' }];
    vi.mocked(api.sessions).mockResolvedValue(sessions as never);

    await expect(fetchSessionsSnapshot()).resolves.toBe(sessions);
    expect(api.sessions).toHaveBeenCalledTimes(1);
  });
});

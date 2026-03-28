import { describe, expect, it } from 'vitest';
import { buildConversationBootstrapVersionKey } from './useConversationBootstrap.js';

describe('buildConversationBootstrapVersionKey', () => {
  it('tracks both session list and session file invalidations', () => {
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 0, sessionFilesVersion: 0 })).toBe('0:0');
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 7, sessionFilesVersion: 3 })).toBe('7:3');
  });
});

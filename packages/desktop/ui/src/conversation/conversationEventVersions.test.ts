import { describe, expect, it } from 'vitest';

import {
  bumpConversationScopedEventVersions,
  INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS,
  readConversationScopedEventVersion,
} from './conversationEventVersions';

describe('conversationEventVersions', () => {
  it('tracks versions independently per conversation', () => {
    const first = bumpConversationScopedEventVersions(INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS, 'conv-1');
    const second = bumpConversationScopedEventVersions(first, 'conv-1');
    const third = bumpConversationScopedEventVersions(second, 'conv-2');

    expect(readConversationScopedEventVersion(third, 'conv-1')).toBe(2);
    expect(readConversationScopedEventVersion(third, 'conv-2')).toBe(1);
    expect(readConversationScopedEventVersion(third, 'missing')).toBe(0);
  });

  it('ignores empty conversation ids', () => {
    const next = bumpConversationScopedEventVersions(INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS, '   ');
    expect(next).toBe(INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS);
    expect(readConversationScopedEventVersion(next, '')).toBe(0);
  });
});

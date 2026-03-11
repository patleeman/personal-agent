import { describe, expect, it } from 'vitest';
import type { MessageBlock } from './types';
import { buildConversationHref, resolveForkEntryForMessage } from './forking';

describe('resolveForkEntryForMessage', () => {
  it('maps an assistant reply to the preceding user turn fork entry', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-11T18:00:00.000Z', text: 'First prompt' },
      { type: 'text', ts: '2026-03-11T18:00:01.000Z', text: 'First reply' },
      { type: 'user', ts: '2026-03-11T18:00:02.000Z', text: 'Second prompt' },
      { type: 'text', ts: '2026-03-11T18:00:03.000Z', text: 'Second reply' },
    ];

    expect(resolveForkEntryForMessage(messages, 3, [
      { entryId: 'entry-1', text: 'First prompt' },
      { entryId: 'entry-2', text: 'Second prompt' },
    ])).toEqual({ entryId: 'entry-2', text: 'Second prompt' });
  });

  it('falls back to the latest fork entry when the transcript index runs ahead of persisted entries', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-11T18:00:00.000Z', text: 'First prompt' },
      { type: 'text', ts: '2026-03-11T18:00:01.000Z', text: 'First reply' },
      { type: 'user', ts: '2026-03-11T18:00:02.000Z', text: 'Second prompt' },
    ];

    expect(resolveForkEntryForMessage(messages, 2, [
      { entryId: 'entry-1', text: 'First prompt' },
    ])).toEqual({ entryId: 'entry-1', text: 'First prompt' });
  });

  it('returns null when there is no prior user turn to fork from', () => {
    const messages: MessageBlock[] = [
      { type: 'thinking', ts: '2026-03-11T18:00:00.000Z', text: 'Working…' },
      { type: 'text', ts: '2026-03-11T18:00:01.000Z', text: 'Reply' },
    ];

    expect(resolveForkEntryForMessage(messages, 1, [
      { entryId: 'entry-1', text: 'Prompt' },
    ])).toBeNull();
  });
});

describe('buildConversationHref', () => {
  it('builds an absolute conversation URL from the current page', () => {
    expect(buildConversationHref('fork-123', 'http://localhost:5173/inbox')).toBe('http://localhost:5173/conversations/fork-123');
  });
});

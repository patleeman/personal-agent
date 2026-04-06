import { describe, expect, it } from 'vitest';
import { toPublicLiveSessionMeta } from './conversationService.js';

describe('toPublicLiveSessionMeta', () => {
  it('returns only the public live session fields', () => {
    const input = {
      id: 'conv-123',
      cwd: '/tmp/workspace',
      sessionFile: '/tmp/workspace/session.jsonl',
      title: 'Conversation title',
      isStreaming: true,
      hasPendingHiddenTurn: true,
      session: {
        get theme() {
          throw new Error('Theme not initialized. Call initTheme() first.');
        },
      },
    };

    expect(() => JSON.stringify({ live: true, ...input })).toThrow('Theme not initialized. Call initTheme() first.');

    const result = toPublicLiveSessionMeta(input);

    expect(result).toEqual({
      id: 'conv-123',
      cwd: '/tmp/workspace',
      sessionFile: '/tmp/workspace/session.jsonl',
      title: 'Conversation title',
      isStreaming: true,
      hasPendingHiddenTurn: true,
    });
    expect('session' in result).toBe(false);
    expect(() => JSON.stringify({ live: true, ...result })).not.toThrow();
  });
});

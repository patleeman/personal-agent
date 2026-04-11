import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONVERSATION_AUTO_MODE_STATE,
  readConversationAutoModeStateFromEntries,
  readConversationAutoModeStateFromSessionManager,
  writeConversationAutoModeState,
} from './conversationAutoMode.js';

describe('conversation auto mode state', () => {
  it('returns the default state when no custom entries are present', () => {
    expect(readConversationAutoModeStateFromEntries([])).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });

  it('reads the latest valid auto mode state entry', () => {
    expect(readConversationAutoModeStateFromEntries([
      { type: 'custom', customType: 'other', data: { enabled: true } },
      { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: true, updatedAt: '2026-04-12T10:00:00.000Z' } },
      { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: false, stopReason: 'needs user input', updatedAt: '2026-04-12T10:05:00.000Z' } },
    ])).toEqual({
      enabled: false,
      stopReason: 'needs user input',
      updatedAt: '2026-04-12T10:05:00.000Z',
    });
  });

  it('ignores malformed state entries', () => {
    expect(readConversationAutoModeStateFromEntries([
      { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: 'yes' } },
    ])).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });

  it('writes normalized state entries back through the session manager', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState({
      getEntries: () => [],
      appendCustomEntry,
    }, {
      enabled: false,
      stopReason: '  blocked on tests  ',
      updatedAt: '2026-04-12T11:00:00-04:00',
    });

    expect(state).toEqual({
      enabled: false,
      stopReason: 'blocked on tests',
      updatedAt: '2026-04-12T15:00:00.000Z',
    });
    expect(appendCustomEntry).toHaveBeenCalledWith('conversation-auto-mode', state);
  });

  it('clears stale stop reasons when re-enabling auto mode', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState({
      getEntries: () => [],
      appendCustomEntry,
    }, {
      enabled: true,
      stopReason: 'done',
      updatedAt: '2026-04-12T15:10:00.000Z',
    });

    expect(state).toEqual({
      enabled: true,
      stopReason: null,
      updatedAt: '2026-04-12T15:10:00.000Z',
    });
    expect(readConversationAutoModeStateFromSessionManager({
      getEntries: () => [{ type: 'custom', customType: 'conversation-auto-mode', data: state }],
    })).toEqual(state);
  });
});

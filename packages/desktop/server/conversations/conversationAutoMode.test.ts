import { describe, expect, it, vi } from 'vitest';

import {
  CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT,
  DEFAULT_CONVERSATION_AUTO_MODE_STATE,
  formatConversationAutoModePrompt,
  readConversationAutoModeStateFromEntries,
  readConversationAutoModeStateFromSessionManager,
  writeConversationAutoModeState,
} from './conversationAutoMode.js';

const defaultEnabledState = {
  enabled: true,
  stopReason: null,
  updatedAt: null,
  mission: null,
  mode: 'normal',
  budget: null,
  stopCategory: null,
  stopConfidence: null,
} as const;

describe('conversation auto mode state', () => {
  it('returns the default state when no custom entries are present', () => {
    expect(readConversationAutoModeStateFromEntries([])).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });

  it('reads the latest valid auto mode state entry', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        { type: 'custom', customType: 'other', data: { enabled: true } },
        { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: true, updatedAt: '2026-04-12T10:00:00.000Z' } },
        {
          type: 'custom',
          customType: 'conversation-auto-mode',
          data: { enabled: false, stopReason: 'needs user input', updatedAt: '2026-04-12T10:05:00.000Z' },
        },
      ]),
    ).toEqual({
      enabled: false,
      stopReason: 'needs user input',
      updatedAt: '2026-04-12T10:05:00.000Z',
      mission: null,
      mode: 'normal',
      budget: null,
      stopCategory: null,
      stopConfidence: null,
    });
  });

  it('ignores malformed state entries', () => {
    expect(
      readConversationAutoModeStateFromEntries([{ type: 'custom', customType: 'conversation-auto-mode', data: { enabled: 'yes' } }]),
    ).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });

  it('drops non-ISO auto mode state timestamps', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: true, updatedAt: '1' } },
      ]),
    ).toEqual(defaultEnabledState);
  });

  it('drops overflowed auto mode state timestamps', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: true, updatedAt: '2026-02-31T10:00:00.000Z' } },
      ]),
    ).toEqual(defaultEnabledState);
  });

  it('writes normalized state entries back through the session manager', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState(
      {
        getEntries: () => [],
        appendCustomEntry,
      },
      {
        enabled: false,
        stopReason: '  blocked on tests  ',
        updatedAt: '2026-04-12T11:00:00-04:00',
      },
    );

    expect(state).toEqual({
      enabled: false,
      stopReason: 'blocked on tests',
      updatedAt: '2026-04-12T15:00:00.000Z',
      mission: null,
      mode: 'normal',
      budget: null,
      stopCategory: null,
      stopConfidence: null,
    });
    expect(appendCustomEntry).toHaveBeenCalledWith('conversation-auto-mode', state);
  });

  it('clears stale stop metadata when re-enabling auto mode', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState(
      {
        getEntries: () => [],
        appendCustomEntry,
      },
      {
        enabled: true,
        stopReason: 'done',
        stopCategory: 'complete',
        stopConfidence: 1,
        updatedAt: '2026-04-12T15:10:00.000Z',
      },
    );

    expect(state).toEqual({
      enabled: true,
      stopReason: null,
      updatedAt: '2026-04-12T15:10:00.000Z',
      mission: null,
      mode: 'normal',
      budget: null,
      stopCategory: null,
      stopConfidence: null,
    });
    expect(
      readConversationAutoModeStateFromSessionManager({
        getEntries: () => [{ type: 'custom', customType: 'conversation-auto-mode', data: state }],
      }),
    ).toEqual(state);
  });

  it('persists mission, mode, budget, and structured stop metadata', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState(
      {
        getEntries: () => [],
        appendCustomEntry,
      },
      {
        enabled: false,
        mission: 'Fix reconnect bugs',
        mode: 'forced',
        budget: { maxTurns: 5 },
        stopReason: 'budget used',
        stopCategory: 'budget_exhausted',
        stopConfidence: 2,
        updatedAt: '2026-04-12T15:10:00.000Z',
      },
    );

    expect(state).toEqual({
      enabled: false,
      stopReason: 'budget used',
      updatedAt: '2026-04-12T15:10:00.000Z',
      mission: 'Fix reconnect bugs',
      mode: 'forced',
      budget: { maxTurns: 5 },
      stopCategory: 'budget_exhausted',
      stopConfidence: 1,
    });
  });

  it('formats the controller prompt with the active mission and mode', () => {
    const prompt = formatConversationAutoModePrompt(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT, {
      enabled: true,
      stopReason: null,
      updatedAt: '2026-04-12T15:10:00.000Z',
      mission: 'Fix reconnect bugs',
      mode: 'tenacious',
      budget: { maxTurns: 3 },
      stopCategory: null,
      stopConfidence: null,
    });

    expect(prompt).toContain('Active mission: Fix reconnect bugs');
    expect(prompt).toContain('Autonomy mode: tenacious');
    expect(prompt).toContain('Budget: 3 turns');
  });

  it('tells the hidden review turn to keep going until the work is actually done', () => {
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain(
      'The user enabled auto mode because they want you to keep working without waiting for user input.',
    );
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain('Active mission: {autoMission}');
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain(
      'Use action "stop" only when the mission is complete, blocked on a real dependency, needs user input, or the explicit budget is exhausted.',
    );
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain(
      'If the user did not give an explicit validation target, infer the expected level of doneness from their request and the work so far.',
    );
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain('Err toward continuing when useful work remains.');
  });
});

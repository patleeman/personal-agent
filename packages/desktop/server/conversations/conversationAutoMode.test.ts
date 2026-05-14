import { describe, expect, it, vi } from 'vitest';

import {
  areAllTasksDone,
  CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT,
  createTask,
  DEFAULT_CONVERSATION_AUTO_MODE_STATE,
  normalizeRunMode,
  readConversationAutoModeStateFromEntries,
  readConversationAutoModeStateFromSessionManager,
  writeConversationAutoModeState,
} from './conversationAutoMode.js';

describe('normalizeRunMode', () => {
  it('maps "manual"', () => {
    expect(normalizeRunMode('manual')).toBe('manual');
  });

  it('maps "nudge"', () => {
    expect(normalizeRunMode('nudge')).toBe('nudge');
  });

  it('maps "mission"', () => {
    expect(normalizeRunMode('mission')).toBe('mission');
  });

  it('maps "loop"', () => {
    expect(normalizeRunMode('loop')).toBe('loop');
  });

  it('falls back to "manual" for unknown values', () => {
    expect(normalizeRunMode(undefined)).toBe('manual');
    expect(normalizeRunMode('auto')).toBe('manual');
    expect(normalizeRunMode('')).toBe('manual');
    expect(normalizeRunMode(null)).toBe('manual');
  });
});

describe('createTask', () => {
  it('creates a task with default status pending', () => {
    const task = createTask('Fix the layout');
    expect(task.description).toBe('Fix the layout');
    expect(task.status).toBe('pending');
    expect(typeof task.id).toBe('string');
    expect(task.id.length).toBeGreaterThan(0);
  });

  it('creates a task with custom status', () => {
    const task = createTask('Check it', 'in_progress');
    expect(task.description).toBe('Check it');
    expect(task.status).toBe('in_progress');
  });
});

describe('areAllTasksDone', () => {
  it('returns false for empty task list so mission mode can bootstrap tasks', () => {
    expect(areAllTasksDone([])).toBe(false);
  });

  it('returns true when all tasks are done', () => {
    const tasks = [createTask('Task 1', 'done'), createTask('Task 2', 'done')];
    expect(areAllTasksDone(tasks)).toBe(true);
  });

  it('returns false when any task is pending', () => {
    const tasks = [createTask('Task 1', 'done'), createTask('Task 2', 'pending')];
    expect(areAllTasksDone(tasks)).toBe(false);
  });

  it('returns false when any task is in_progress', () => {
    const tasks = [createTask('Task 1', 'done'), createTask('Task 2', 'in_progress')];
    expect(areAllTasksDone(tasks)).toBe(false);
  });

  it('returns false when any task is blocked', () => {
    const tasks = [createTask('Task 1', 'done'), createTask('Task 2', 'blocked')];
    expect(areAllTasksDone(tasks)).toBe(false);
  });
});

describe('conversation auto mode state defaults', () => {
  it('returns the default state when no custom entries are present', () => {
    expect(readConversationAutoModeStateFromEntries([])).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });

  it('default mode is "manual" with enabled = false', () => {
    expect(DEFAULT_CONVERSATION_AUTO_MODE_STATE.mode).toBe('manual');
    expect(DEFAULT_CONVERSATION_AUTO_MODE_STATE.enabled).toBe(false);
  });
});

describe('readConversationAutoModeStateFromEntries', () => {
  it('reads the latest valid auto mode state entry (backward compat: enabled=true → mode=nudge)', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: true, updatedAt: '2026-04-12T10:00:00.000Z' } },
      ]),
    ).toEqual({
      enabled: true,
      mode: 'nudge',
      stopReason: null,
      updatedAt: '2026-04-12T10:00:00.000Z',
    });
  });

  it('reads the latest valid auto mode state entry (backward compat: enabled=false → mode=manual)', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: false, updatedAt: '2026-04-12T10:00:00.000Z' } },
      ]),
    ).toEqual({
      enabled: false,
      mode: 'manual',
      stopReason: null,
      updatedAt: '2026-04-12T10:00:00.000Z',
    });
  });

  it('reads mode: "nudge" as enabled', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        {
          type: 'custom',
          customType: 'conversation-auto-mode',
          data: { mode: 'nudge', enabled: true, updatedAt: '2026-04-12T10:00:00.000Z' },
        },
      ]),
    ).toMatchObject({ mode: 'nudge', enabled: true });
  });

  it('reads mode: "mission" with mission state', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        {
          type: 'custom',
          customType: 'conversation-auto-mode',
          data: {
            mode: 'mission',
            enabled: true,
            mission: {
              goal: 'Fix the page',
              tasks: [
                { id: 't1', description: 'Inspect layout', status: 'done' },
                { id: 't2', description: 'Fix overflow', status: 'pending' },
              ],
            },
            updatedAt: '2026-04-12T10:00:00.000Z',
          },
        },
      ]),
    ).toEqual({
      mode: 'mission',
      enabled: true,
      stopReason: null,
      updatedAt: '2026-04-12T10:00:00.000Z',
      mission: {
        goal: 'Fix the page',
        tasks: [
          { id: 't1', description: 'Inspect layout', status: 'done' },
          { id: 't2', description: 'Fix overflow', status: 'pending' },
        ],
      },
    });
  });

  it('reads mode: "loop" with loop state', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        {
          type: 'custom',
          customType: 'conversation-auto-mode',
          data: {
            mode: 'loop',
            enabled: true,
            loop: {
              prompt: 'Find a bug, fix it.',
              maxIterations: 5,
              iterationsUsed: 2,
              delay: 'After each turn',
            },
            updatedAt: '2026-04-12T10:00:00.000Z',
          },
        },
      ]),
    ).toEqual({
      mode: 'loop',
      enabled: true,
      stopReason: null,
      updatedAt: '2026-04-12T10:00:00.000Z',
      loop: {
        prompt: 'Find a bug, fix it.',
        maxIterations: 5,
        iterationsUsed: 2,
        delay: 'After each turn',
      },
    });
  });

  it('prefers explicit mode over implied mode', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        {
          type: 'custom',
          customType: 'conversation-auto-mode',
          data: {
            enabled: false,
            mode: 'nudge',
            updatedAt: '2026-04-12T10:00:00.000Z',
          },
        },
      ]),
    ).toMatchObject({ mode: 'nudge', enabled: true });
  });

  it('ignores malformed state entries', () => {
    expect(
      readConversationAutoModeStateFromEntries([{ type: 'custom', customType: 'conversation-auto-mode', data: { enabled: 'yes' } }]),
    ).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });

  it('ignores entries with invalid mode', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        {
          type: 'custom',
          customType: 'conversation-auto-mode',
          data: { enabled: true, mode: 'turbo', updatedAt: '2026-04-12T10:00:00.000Z' },
        },
      ]),
    ).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });

  it('drops non-ISO timestamps', () => {
    expect(
      readConversationAutoModeStateFromEntries([
        { type: 'custom', customType: 'conversation-auto-mode', data: { enabled: true, updatedAt: '1' } },
      ]),
    ).toMatchObject({ enabled: true, stopReason: null, updatedAt: null });
  });
});

describe('writeConversationAutoModeState', () => {
  it('writes normalized state entries back through the session manager', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState(
      { getEntries: () => [], appendCustomEntry },
      { enabled: false, stopReason: '  blocked on tests  ' },
    );

    expect(state).toMatchObject({
      enabled: false,
      mode: 'manual',
      stopReason: 'blocked on tests',
    });
    expect(typeof state.updatedAt).toBe('string');
    expect(appendCustomEntry).toHaveBeenCalledWith('conversation-auto-mode', expect.objectContaining({ mode: 'manual' }));
  });

  it('clears stale stop reasons when re-enabling', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState({ getEntries: () => [], appendCustomEntry }, { enabled: true, stopReason: 'done' });

    expect(state).toEqual({
      enabled: true,
      mode: 'nudge',
      stopReason: null,
      updatedAt: expect.any(String),
    });
  });

  it('writes mission state with mode', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState(
      { getEntries: () => [], appendCustomEntry },
      {
        enabled: true,
        mode: 'mission',
        mission: {
          goal: 'Fix the page',
          tasks: [createTask('Inspect')],
        },
      },
    );

    expect(state.mode).toBe('mission');
    expect(state.mission?.goal).toBe('Fix the page');
    expect(state.mission?.tasks).toHaveLength(1);
    expect(state.mission?.tasks[0].status).toBe('pending');
  });

  it('writes loop state with mode', () => {
    const appendCustomEntry = vi.fn();
    const state = writeConversationAutoModeState(
      { getEntries: () => [], appendCustomEntry },
      {
        enabled: true,
        mode: 'loop',
        loop: {
          prompt: 'Find bugs',
          maxIterations: 5,
          iterationsUsed: 0,
          delay: 'After each turn',
        },
      },
    );

    expect(state.mode).toBe('loop');
    expect(state.loop?.prompt).toBe('Find bugs');
    expect(state.loop?.maxIterations).toBe(5);
  });
});

describe('readConversationAutoModeStateFromSessionManager', () => {
  it('returns default for empty session manager', () => {
    expect(readConversationAutoModeStateFromSessionManager({ getEntries: () => [] })).toEqual(DEFAULT_CONVERSATION_AUTO_MODE_STATE);
  });
});

describe('auto mode controller prompt', () => {
  it('tells the review event to keep going until the work is actually done', () => {
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain(
      'The user enabled auto mode because they want you to keep working without waiting for user input.',
    );
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain(
      'Use action "stop" only when the task is complete for the user\'s request, blocked on a real dependency, or needs user input.',
    );
    expect(CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT).toContain('Err toward continuing when useful work remains.');
  });
});

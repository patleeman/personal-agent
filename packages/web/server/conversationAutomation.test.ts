import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConversationAutomationItemPrompt,
  buildConversationAutomationPromptContext,
  conversationAutomationDocumentExists,
  createConversationAutomationTodoItem,
  loadConversationAutomationState,
  readSavedConversationAutomationPreferences,
  replaceConversationAutomationItems,
  resetConversationAutomationFromItem,
  resolveConversationAutomationPath,
  resumeConversationAutomationAfterUserMessage,
  setConversationAutomationWaitingForUser,
  updateConversationAutomationItemStatus,
  templateTodoItemFromRuntimeItem,
  writeSavedConversationAutomationPreferences,
  writeConversationAutomationState,
  writeSavedConversationAutomationWorkflowPresets,
} from './conversationAutomation.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('conversationAutomation state', () => {
  it('loads the default preset items for conversations without a local override', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const settingsFile = join(stateRoot, 'settings.json');

    const presetLibrary = writeSavedConversationAutomationWorkflowPresets({
      defaultPresetIds: ['preset-checkpoint'],
      presets: [{
        id: 'preset-checkpoint',
        name: 'Checkpoint flow',
        updatedAt: '2026-03-18T12:00:00.000Z',
        items: [{
          id: 'item-default-1',
          kind: 'skill',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
        }],
      }],
    }, settingsFile);

    const loaded = loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
      settingsFile,
    });

    expect(presetLibrary.defaultPresetIds).toEqual(['preset-checkpoint']);
    expect(loaded.inheritedPresetIds).toEqual(['preset-checkpoint']);
    expect(loaded.presetLibrary.presets).toEqual(presetLibrary.presets);
    expect(loaded.document).toEqual({
      version: 4,
      conversationId: 'conv-123',
      updatedAt: loaded.document.updatedAt,
      enabled: true,
      items: [
        expect.objectContaining({
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
          status: 'pending',
        }),
      ],
    });
    expect(conversationAutomationDocumentExists({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    })).toBe(false);
  });

  it('can enable inherited default presets automatically for new conversations', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const settingsFile = join(stateRoot, 'settings.json');

    writeSavedConversationAutomationPreferences({ defaultEnabled: true }, settingsFile);
    writeSavedConversationAutomationWorkflowPresets({
      defaultPresetIds: ['preset-checkpoint'],
      presets: [{
        id: 'preset-checkpoint',
        name: 'Checkpoint flow',
        updatedAt: '2026-03-18T12:00:00.000Z',
        items: [{
          id: 'item-default-1',
          kind: 'skill',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
        }],
      }],
    }, settingsFile);

    const loaded = loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-enabled',
      settingsFile,
    });

    expect(loaded.document.enabled).toBe(true);
  });

  it('combines the default preset stack for conversations without a local override', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const settingsFile = join(stateRoot, 'settings.json');

    const presetLibrary = writeSavedConversationAutomationWorkflowPresets({
      defaultPresetIds: ['preset-a', 'preset-b'],
      presets: [{
        id: 'preset-a',
        name: 'Code review',
        updatedAt: '2026-03-18T12:00:00.000Z',
        items: [{
          id: 'item-a-1',
          kind: 'skill',
          label: 'review',
          skillName: 'subagent-code-review',
        }],
      }, {
        id: 'preset-b',
        name: 'Follow-up',
        updatedAt: '2026-03-18T12:05:00.000Z',
        items: [{
          id: 'item-b-1',
          kind: 'skill',
          label: 'checkpoint',
          skillName: 'workflow-checkpoint',
        }],
      }],
    }, settingsFile);

    const loaded = loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-stacked',
      settingsFile,
    });

    expect(presetLibrary.defaultPresetIds).toEqual(['preset-a', 'preset-b']);
    expect(loaded.inheritedPresetIds).toEqual(['preset-a', 'preset-b']);
    expect(loaded.document.items).toHaveLength(2);
    expect(loaded.document.items.map((item) => item.label)).toEqual(['review', 'checkpoint']);
    expect(new Set(loaded.document.items.map((item) => item.id)).size).toBe(2);
  });

  it('migrates the legacy saved default workflow into a default preset', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const settingsFile = join(stateRoot, 'settings.json');

    writeFileSync(settingsFile, JSON.stringify({
      webUi: {
        conversationAutomation: {
          defaultWorkflow: {
            updatedAt: '2026-03-18T12:00:00.000Z',
            gates: [{
              id: 'gate-default-1',
              label: 'Ready to checkpoint?',
              prompt: 'Pass only when the latest assistant message requests a checkpoint.',
              skills: [{
                id: 'skill-default-1',
                label: 'workflow-checkpoint',
                skillName: 'workflow-checkpoint',
              }],
            }],
          },
        },
      },
    }, null, 2) + '\n');

    const loaded = loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-legacy',
      settingsFile,
    });

    expect(loaded.inheritedPresetIds).toEqual(['preset-default']);
    expect(loaded.presetLibrary).toEqual({
      defaultPresetIds: ['preset-default'],
      presets: [{
        id: 'preset-default',
        name: 'Default workflow',
        updatedAt: '2026-03-18T12:00:00.000Z',
        items: [{
          id: 'skill-default-1',
          kind: 'skill',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
        }],
      }],
    });
  });

  it('saves and reloads todo items under local state', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const checkpointItem = createConversationAutomationTodoItem({
      id: 'item-1',
      label: 'workflow-checkpoint',
      skillName: 'workflow-checkpoint',
      skillArgs: 'commit only my files',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:00.000Z',
        enabled: true,
        items: [checkpointItem],
      },
    });

    const loaded = loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });

    expect(resolveConversationAutomationPath({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    })).toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-automation', 'datadog', 'conv-123.json'));
    expect(loaded.inheritedPresetIds).toEqual([]);
    expect(loaded.document.enabled).toBe(true);
    expect(loaded.document.items).toEqual([
      expect.objectContaining({
        id: 'item-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
        skillArgs: 'commit only my files',
        status: 'pending',
      }),
    ]);
    expect(buildConversationAutomationItemPrompt(loaded.document.items[0]!)).toContain('/skill:workflow-checkpoint commit only my files');
    expect(buildConversationAutomationItemPrompt(loaded.document.items[0]!)).toContain('todo_list tool');
  });

  it('replaces items from editable template data and resets runtime state', () => {
    const updated = replaceConversationAutomationItems({
      version: 4,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:03:00.000Z',
      enabled: true,
      activeItemId: 'item-1',
      items: [{
        ...createConversationAutomationTodoItem({
          id: 'item-1',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
          now: '2026-03-18T12:00:00.000Z',
        }),
        status: 'running',
        startedAt: '2026-03-18T12:02:00.000Z',
        resultReason: 'Started earlier.',
      }],
      review: {
        status: 'running',
        round: 1,
        createdAt: '2026-03-18T12:02:30.000Z',
        updatedAt: '2026-03-18T12:03:00.000Z',
        startedAt: '2026-03-18T12:02:30.000Z',
      },
    }, [{
      id: 'item-1',
      kind: 'skill',
      label: 'subagent-code-review',
      skillName: 'subagent-code-review',
    }], '2026-03-18T12:04:00.000Z');

    expect(updated.activeItemId).toBeUndefined();
    expect(updated.review).toBeUndefined();
    expect(updated.updatedAt).toBe('2026-03-18T12:04:00.000Z');
    expect(updated.items).toEqual([
      expect.objectContaining({
        id: 'item-1',
        label: 'subagent-code-review',
        skillName: 'subagent-code-review',
        status: 'pending',
        createdAt: '2026-03-18T12:00:00.000Z',
        updatedAt: '2026-03-18T12:04:00.000Z',
      }),
    ]);
    expect(updated.items[0]).not.toHaveProperty('startedAt');
    expect(updated.items[0]).not.toHaveProperty('resultReason');
  });

  it('marks an item blocked and clears the active item', () => {
    const blocked = updateConversationAutomationItemStatus({
      version: 4,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:03:00.000Z',
      enabled: true,
      activeItemId: 'item-2',
      items: [
        {
          ...createConversationAutomationTodoItem({
            id: 'item-1',
            label: 'workflow-checkpoint',
            skillName: 'workflow-checkpoint',
            now: '2026-03-18T12:00:00.000Z',
          }),
          status: 'completed' as const,
          startedAt: '2026-03-18T12:00:10.000Z',
          completedAt: '2026-03-18T12:00:20.000Z',
          resultReason: 'Done.',
          updatedAt: '2026-03-18T12:00:20.000Z',
        },
        {
          ...createConversationAutomationTodoItem({
            id: 'item-2',
            label: 'subagent-code-review',
            skillName: 'subagent-code-review',
            now: '2026-03-18T12:01:00.000Z',
          }),
          status: 'running' as const,
          startedAt: '2026-03-18T12:01:05.000Z',
          updatedAt: '2026-03-18T12:01:05.000Z',
        },
      ],
    }, 'item-2', 'blocked', {
      now: '2026-03-18T12:04:00.000Z',
      resultReason: 'Waiting on approval.',
      enabled: false,
    });

    expect(blocked.enabled).toBe(false);
    expect(blocked.activeItemId).toBeUndefined();
    expect(blocked.items[1]).toMatchObject({
      status: 'blocked',
      completedAt: '2026-03-18T12:04:00.000Z',
      resultReason: 'Waiting on approval.',
    });
  });

  it('resets an item and every later item back to pending', () => {
    const first = {
      ...createConversationAutomationTodoItem({
        id: 'item-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
        now: '2026-03-18T12:00:00.000Z',
      }),
      status: 'completed' as const,
      startedAt: '2026-03-18T12:00:10.000Z',
      completedAt: '2026-03-18T12:00:20.000Z',
      resultReason: 'Done.',
      updatedAt: '2026-03-18T12:00:20.000Z',
    };
    const second = {
      ...createConversationAutomationTodoItem({
        id: 'item-2',
        label: 'subagent-code-review',
        skillName: 'subagent-code-review',
        now: '2026-03-18T12:01:00.000Z',
      }),
      status: 'failed' as const,
      startedAt: '2026-03-18T12:01:05.000Z',
      completedAt: '2026-03-18T12:01:15.000Z',
      resultReason: 'Not approved yet.',
      updatedAt: '2026-03-18T12:01:15.000Z',
    };

    const reset = resetConversationAutomationFromItem({
      version: 4,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:03:00.000Z',
      enabled: false,
      activeItemId: 'item-2',
      items: [first, second],
      review: {
        status: 'pending',
        round: 1,
        createdAt: '2026-03-18T12:02:00.000Z',
        updatedAt: '2026-03-18T12:03:00.000Z',
      },
    }, 'item-2', {
      now: '2026-03-18T12:04:00.000Z',
      enabled: true,
    });

    expect(reset.enabled).toBe(true);
    expect(reset.activeItemId).toBeUndefined();
    expect(reset.review).toBeUndefined();
    expect(reset.items[0]).toMatchObject({ status: 'completed', resultReason: 'Done.' });
    expect(reset.items[1]).toMatchObject({ status: 'pending', updatedAt: '2026-03-18T12:04:00.000Z' });
    expect(reset.items[1]?.startedAt).toBeUndefined();
    expect(reset.items[1]?.completedAt).toBeUndefined();
    expect(reset.items[1]?.resultReason).toBeUndefined();
  });

  it('reads and writes automation default preferences without dropping preset settings', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const settingsFile = join(stateRoot, 'settings.json');

    writeSavedConversationAutomationWorkflowPresets({
      defaultPresetIds: ['preset-checkpoint'],
      presets: [{
        id: 'preset-checkpoint',
        name: 'Checkpoint flow',
        updatedAt: '2026-03-18T12:00:00.000Z',
        items: [{
          id: 'item-default-1',
          kind: 'skill',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
        }],
      }],
    }, settingsFile);

    expect(writeSavedConversationAutomationPreferences({ defaultEnabled: true }, settingsFile)).toEqual({
      defaultEnabled: true,
    });
    expect(readSavedConversationAutomationPreferences(settingsFile)).toEqual({
      defaultEnabled: true,
    });
    expect(loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-defaults',
      settingsFile,
    }).presetLibrary.defaultPresetIds).toEqual(['preset-checkpoint']);
  });

  it('migrates the legacy flat queue into todo items', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const path = resolveConversationAutomationPath({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });

    mkdirp(path);
    writeFileSync(path, JSON.stringify({
      version: 1,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:05:00.000Z',
      paused: false,
      activeSkillId: 'skill-2',
      steps: [
        {
          id: 'judge-1',
          kind: 'judge',
          label: 'Ready?',
          prompt: 'Pass when the conversation is ready.',
          status: 'completed',
          createdAt: '2026-03-18T12:00:00.000Z',
          updatedAt: '2026-03-18T12:00:10.000Z',
        },
        {
          id: 'skill-1',
          kind: 'skill',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
          status: 'completed',
          createdAt: '2026-03-18T12:00:00.000Z',
          updatedAt: '2026-03-18T12:00:20.000Z',
        },
        {
          id: 'judge-2',
          kind: 'judge',
          label: 'Approved?',
          prompt: 'Pass when approved.',
          status: 'completed',
          createdAt: '2026-03-18T12:01:00.000Z',
          updatedAt: '2026-03-18T12:01:10.000Z',
        },
        {
          id: 'skill-2',
          kind: 'skill',
          label: 'subagent-code-review',
          skillName: 'subagent-code-review',
          status: 'running',
          createdAt: '2026-03-18T12:01:00.000Z',
          updatedAt: '2026-03-18T12:01:20.000Z',
        },
      ],
    }, null, 2) + '\n');

    const loaded = loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });

    expect(loaded.document.enabled).toBe(true);
    expect(loaded.document.activeItemId).toBe('skill-2');
    expect(loaded.document.items.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
    }))).toEqual([
      { id: 'skill-1', label: 'workflow-checkpoint', status: 'completed' },
      { id: 'skill-2', label: 'subagent-code-review', status: 'running' },
    ]);
    expect(templateTodoItemFromRuntimeItem(loaded.document.items[0]!)).toEqual({
      id: 'skill-1',
      kind: 'skill',
      label: 'workflow-checkpoint',
      skillName: 'workflow-checkpoint',
    });
  });

  it('supports custom instruction steps', () => {
    const item = createConversationAutomationTodoItem({
      id: 'item-instruction',
      kind: 'instruction',
      text: 'Open the failing test output, identify the root cause, and summarize the fix plan.',
      now: '2026-03-18T12:00:00.000Z',
    });

    expect(item).toMatchObject({
      id: 'item-instruction',
      kind: 'instruction',
      status: 'pending',
      text: 'Open the failing test output, identify the root cause, and summarize the fix plan.',
    });
    expect(buildConversationAutomationItemPrompt(item)).toContain('Carry out this checklist item:');
    expect(buildConversationAutomationItemPrompt(item)).toContain('todo_list tool');
    expect(templateTodoItemFromRuntimeItem(item)).toEqual({
      id: 'item-instruction',
      kind: 'instruction',
      label: 'Open the failing test output, identify the root cause, and summarize…',
      text: 'Open the failing test output, identify the root cause, and summarize the fix plan.',
    });
  });

  it('builds prompt context that injects the current todo list and reminder', () => {
    const promptContext = buildConversationAutomationPromptContext({
      activeItemId: 'item-1',
      review: {
        status: 'running',
        round: 2,
        createdAt: '2026-03-18T12:00:00.000Z',
        updatedAt: '2026-03-18T12:00:05.000Z',
      },
      waitingForUser: {
        createdAt: '2026-03-18T12:00:06.000Z',
        updatedAt: '2026-03-18T12:00:06.000Z',
        reason: 'Need the deployment target from the user.',
      },
      items: [{
        ...createConversationAutomationTodoItem({
          id: 'item-1',
          kind: 'instruction',
          text: 'Inspect the broken todo reminder flow and fix it.',
          now: '2026-03-18T12:00:00.000Z',
        }),
        status: 'running',
        startedAt: '2026-03-18T12:00:01.000Z',
        updatedAt: '2026-03-18T12:00:05.000Z',
      }],
    });

    expect(promptContext).toContain('Conversation automation context:');
    expect(promptContext).toContain('automation todo list');
    expect(promptContext).toContain('todo_list tool');
    expect(promptContext).toContain('Active todo item: @item-1');
    expect(promptContext).toContain('Automation review: running (round 2)');
    expect(promptContext).toContain('Waiting for user: Need the deployment target from the user.');
    expect(promptContext).toContain('@item-1 [active]');
    expect(promptContext).toContain('Inspect the broken todo reminder flow and fix it.');
  });

  it('pauses checklist automation explicitly for user input and resumes on the next user message', () => {
    const waiting = setConversationAutomationWaitingForUser({
      version: 4,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:00:05.000Z',
      enabled: true,
      activeItemId: 'item-1',
      items: [{
        ...createConversationAutomationTodoItem({
          id: 'item-1',
          kind: 'instruction',
          text: 'Ask the user which deployment target to use, then continue.',
          now: '2026-03-18T12:00:00.000Z',
        }),
        status: 'running',
        startedAt: '2026-03-18T12:00:05.000Z',
        updatedAt: '2026-03-18T12:00:05.000Z',
      }],
    }, {
      now: '2026-03-18T12:00:10.000Z',
      reason: 'Need the deployment target from the user.',
    });

    expect(waiting.enabled).toBe(false);
    expect(waiting.activeItemId).toBeUndefined();
    expect(waiting.waitingForUser?.reason).toBe('Need the deployment target from the user.');
    expect(waiting.items[0]).toMatchObject({
      status: 'waiting',
      resultReason: 'Need the deployment target from the user.',
    });

    const resumed = resumeConversationAutomationAfterUserMessage(waiting, '2026-03-18T12:00:20.000Z');
    expect(resumed.enabled).toBe(true);
    expect(resumed.waitingForUser).toBeUndefined();
    expect(resumed.items[0]).toMatchObject({
      status: 'pending',
      resultReason: undefined,
    });
  });
});

function mkdirp(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

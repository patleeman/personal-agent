import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConversationAutomationSkillPrompt,
  conversationAutomationDocumentExists,
  createConversationAutomationGate,
  createConversationAutomationSkillStep,
  loadConversationAutomationState,
  replaceConversationAutomationGates,
  resetConversationAutomationFromGate,
  resolveConversationAutomationPath,
  templateGateFromRuntimeGate,
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
  it('loads the default preset for conversations without a local override', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const settingsFile = join(stateRoot, 'settings.json');

    const presetLibrary = writeSavedConversationAutomationWorkflowPresets({
      defaultPresetId: 'preset-checkpoint',
      presets: [{
        id: 'preset-checkpoint',
        name: 'Checkpoint flow',
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
      }],
    }, settingsFile);

    const loaded = loadConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
      settingsFile,
    });

    expect(presetLibrary.defaultPresetId).toBe('preset-checkpoint');
    expect(loaded.inheritedPresetId).toBe('preset-checkpoint');
    expect(loaded.presetLibrary.presets).toEqual(presetLibrary.presets);
    expect(loaded.document).toEqual({
      version: 2,
      conversationId: 'conv-123',
      updatedAt: loaded.document.updatedAt,
      enabled: false,
      gates: [
        expect.objectContaining({
          id: 'gate-default-1',
          label: 'Ready to checkpoint?',
          prompt: 'Pass only when the latest assistant message requests a checkpoint.',
          status: 'pending',
          skills: [
            expect.objectContaining({
              id: 'skill-default-1',
              label: 'workflow-checkpoint',
              skillName: 'workflow-checkpoint',
              status: 'pending',
            }),
          ],
        }),
      ],
    });
    expect(conversationAutomationDocumentExists({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    })).toBe(false);
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

    expect(loaded.inheritedPresetId).toBe('preset-default');
    expect(loaded.presetLibrary).toEqual({
      defaultPresetId: 'preset-default',
      presets: [{
        id: 'preset-default',
        name: 'Default workflow',
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
      }],
    });
  });

  it('saves and reloads nested gates under local state', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const checkpointGate = createConversationAutomationGate({
      id: 'gate-1',
      label: 'Ready to checkpoint?',
      prompt: 'Pass only when the conversation is ready for a checkpoint.',
      skills: [{
        id: 'skill-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
        skillArgs: 'commit only my files',
      }],
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 2,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:00.000Z',
        enabled: true,
        gates: [checkpointGate],
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
    expect(loaded.inheritedPresetId).toBeNull();
    expect(loaded.document.enabled).toBe(true);
    expect(loaded.document.gates).toEqual([
      expect.objectContaining({
        id: 'gate-1',
        label: 'Ready to checkpoint?',
        status: 'pending',
        skills: [
          expect.objectContaining({
            id: 'skill-1',
            label: 'workflow-checkpoint',
            skillName: 'workflow-checkpoint',
            skillArgs: 'commit only my files',
            status: 'pending',
          }),
        ],
      }),
    ]);
    expect(buildConversationAutomationSkillPrompt(loaded.document.gates[0]!.skills[0]!)).toBe('/skill:workflow-checkpoint commit only my files');
  });

  it('replaces gates from editable template data and resets runtime state', () => {
    const updated = replaceConversationAutomationGates({
      version: 2,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:03:00.000Z',
      enabled: true,
      activeGateId: 'gate-1',
      activeSkillId: 'skill-1',
      gates: [{
        ...createConversationAutomationGate({
          id: 'gate-1',
          label: 'Old gate',
          prompt: 'Old prompt',
          skills: [{
            id: 'skill-1',
            label: 'workflow-checkpoint',
            skillName: 'workflow-checkpoint',
          }],
          now: '2026-03-18T12:00:00.000Z',
        }),
        status: 'running',
        startedAt: '2026-03-18T12:01:00.000Z',
        resultReason: 'Passed earlier.',
        skills: [{
          ...createConversationAutomationSkillStep({
            id: 'skill-1',
            label: 'workflow-checkpoint',
            skillName: 'workflow-checkpoint',
            now: '2026-03-18T12:00:00.000Z',
          }),
          status: 'running',
          startedAt: '2026-03-18T12:02:00.000Z',
        }],
      }],
    }, [{
      id: 'gate-1',
      label: 'Ready for review?',
      prompt: 'Pass only when the output is ready for review.',
      skills: [{
        id: 'skill-1',
        label: 'subagent-code-review',
        skillName: 'subagent-code-review',
      }],
    }], '2026-03-18T12:04:00.000Z');

    expect(updated.activeGateId).toBeUndefined();
    expect(updated.activeSkillId).toBeUndefined();
    expect(updated.updatedAt).toBe('2026-03-18T12:04:00.000Z');
    expect(updated.gates).toEqual([
      expect.objectContaining({
        id: 'gate-1',
        label: 'Ready for review?',
        prompt: 'Pass only when the output is ready for review.',
        status: 'pending',
        createdAt: '2026-03-18T12:00:00.000Z',
        updatedAt: '2026-03-18T12:04:00.000Z',
        skills: [
          expect.objectContaining({
            id: 'skill-1',
            label: 'subagent-code-review',
            skillName: 'subagent-code-review',
            status: 'pending',
            createdAt: '2026-03-18T12:00:00.000Z',
            updatedAt: '2026-03-18T12:04:00.000Z',
          }),
        ],
      }),
    ]);
    expect(updated.gates[0]).not.toHaveProperty('startedAt');
    expect(updated.gates[0]).not.toHaveProperty('resultReason');
    expect(updated.gates[0]!.skills[0]).not.toHaveProperty('startedAt');
  });

  it('resets a gate and every later gate back to pending', () => {
    const first = {
      ...createConversationAutomationGate({
        id: 'gate-1',
        label: 'Ready?',
        prompt: 'Pass when ready.',
        skills: [{
          id: 'skill-1',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
        }],
        now: '2026-03-18T12:00:00.000Z',
      }),
      status: 'completed' as const,
      startedAt: '2026-03-18T12:00:10.000Z',
      completedAt: '2026-03-18T12:00:20.000Z',
      resultReason: 'Passed.',
      skills: [{
        ...createConversationAutomationSkillStep({
          id: 'skill-1',
          label: 'workflow-checkpoint',
          skillName: 'workflow-checkpoint',
          now: '2026-03-18T12:00:00.000Z',
        }),
        status: 'completed' as const,
        startedAt: '2026-03-18T12:00:12.000Z',
        completedAt: '2026-03-18T12:00:20.000Z',
        resultReason: 'Done.',
      }],
    };
    const second = {
      ...createConversationAutomationGate({
        id: 'gate-2',
        label: 'Approved?',
        prompt: 'Pass when approved.',
        skills: [{
          id: 'skill-2',
          label: 'subagent-code-review',
          skillName: 'subagent-code-review',
        }],
        now: '2026-03-18T12:01:00.000Z',
      }),
      status: 'failed' as const,
      startedAt: '2026-03-18T12:01:05.000Z',
      completedAt: '2026-03-18T12:01:15.000Z',
      resultReason: 'Not approved yet.',
      resultConfidence: 0.75,
    };

    const reset = resetConversationAutomationFromGate({
      version: 2,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:03:00.000Z',
      enabled: false,
      gates: [first, second],
    }, 'gate-2', {
      now: '2026-03-18T12:04:00.000Z',
      enabled: true,
    });

    expect(reset.enabled).toBe(true);
    expect(reset.gates[0]).toMatchObject({ status: 'completed', resultReason: 'Passed.' });
    expect(reset.gates[1]).toMatchObject({ status: 'pending', updatedAt: '2026-03-18T12:04:00.000Z' });
    expect(reset.gates[1]).not.toHaveProperty('startedAt');
    expect(reset.gates[1]).not.toHaveProperty('completedAt');
    expect(reset.gates[1]).not.toHaveProperty('resultReason');
    expect(reset.gates[1]!.skills[0]).toMatchObject({ status: 'pending', updatedAt: '2026-03-18T12:04:00.000Z' });
    expect(reset.gates[1]!.skills[0]).not.toHaveProperty('startedAt');
  });

  it('migrates the legacy flat queue into nested judge gates', () => {
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
      activeStepId: 'skill-2',
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
    expect(loaded.document.activeGateId).toBe('judge-2');
    expect(loaded.document.activeSkillId).toBe('skill-2');
    expect(loaded.document.gates.map((gate) => ({
      id: gate.id,
      label: gate.label,
      status: gate.status,
      skills: gate.skills.map((skill) => skill.id),
    }))).toEqual([
      { id: 'judge-1', label: 'Ready?', status: 'completed', skills: ['skill-1'] },
      { id: 'judge-2', label: 'Approved?', status: 'running', skills: ['skill-2'] },
    ]);
    expect(templateGateFromRuntimeGate(loaded.document.gates[0]!)).toEqual({
      id: 'judge-1',
      label: 'Ready?',
      prompt: 'Pass when the conversation is ready.',
      skills: [{
        id: 'skill-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
      }],
    });
  });
});

function mkdirp(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

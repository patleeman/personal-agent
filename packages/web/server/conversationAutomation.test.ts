import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConversationAutomationSkillPrompt,
  createConversationAutomationJudgeStep,
  createConversationAutomationSkillStep,
  getConversationAutomationState,
  moveConversationAutomationStep,
  resetConversationAutomationFromStep,
  resolveConversationAutomationPath,
  writeConversationAutomationState,
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
  it('saves and reloads conversation-local automation steps under local state', () => {
    const stateRoot = createTempDir('pa-conversation-automation-');
    const skillStep = createConversationAutomationSkillStep({
      skillName: 'workflow-checkpoint',
      skillArgs: 'commit only my files',
      now: '2026-03-18T12:00:00.000Z',
    });
    const judgeStep = createConversationAutomationJudgeStep({
      label: 'Ready for review?',
      prompt: 'Decide whether the conversation is ready for code review.',
      now: '2026-03-18T12:01:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 1,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:01:00.000Z',
        paused: true,
        steps: [skillStep, judgeStep],
      },
    });

    const loaded = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });

    expect(resolveConversationAutomationPath({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    })).toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-automation', 'datadog', 'conv-123.json'));
    expect(loaded).toEqual({
      version: 1,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:01:00.000Z',
      paused: true,
      steps: [
        expect.objectContaining({
          kind: 'skill',
          skillName: 'workflow-checkpoint',
          skillArgs: 'commit only my files',
          status: 'pending',
        }),
        expect.objectContaining({
          kind: 'judge',
          label: 'Ready for review?',
          prompt: 'Decide whether the conversation is ready for code review.',
          status: 'pending',
        }),
      ],
    });
    expect(buildConversationAutomationSkillPrompt(loaded.steps[0] as typeof skillStep)).toBe('/skill:workflow-checkpoint commit only my files');
  });

  it('resets a step and all later steps back to pending', () => {
    const skillStep = createConversationAutomationSkillStep({
      skillName: 'subagent-code-review',
      now: '2026-03-18T12:00:00.000Z',
    });
    const judgeStep = createConversationAutomationJudgeStep({
      prompt: 'Did the review pass?',
      now: '2026-03-18T12:01:00.000Z',
    });

    const document = {
      version: 1 as const,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:03:00.000Z',
      paused: true,
      steps: [
        {
          ...skillStep,
          status: 'completed' as const,
          startedAt: '2026-03-18T12:00:10.000Z',
          completedAt: '2026-03-18T12:00:30.000Z',
          resultReason: 'Completed.',
          updatedAt: '2026-03-18T12:00:30.000Z',
        },
        {
          ...judgeStep,
          status: 'failed' as const,
          startedAt: '2026-03-18T12:02:00.000Z',
          completedAt: '2026-03-18T12:02:10.000Z',
          resultReason: 'Not ready yet.',
          resultConfidence: 0.91,
          updatedAt: '2026-03-18T12:02:10.000Z',
        },
      ],
    };

    const reset = resetConversationAutomationFromStep(document, judgeStep.id, {
      now: '2026-03-18T12:04:00.000Z',
      paused: false,
    });

    expect(reset.paused).toBe(false);
    expect(reset.activeStepId).toBeUndefined();
    expect(reset.steps[0]).toMatchObject({ status: 'completed', resultReason: 'Completed.' });
    expect(reset.steps[1]).toMatchObject({ status: 'pending', updatedAt: '2026-03-18T12:04:00.000Z' });
    expect(reset.steps[1]).not.toHaveProperty('startedAt');
    expect(reset.steps[1]).not.toHaveProperty('completedAt');
    expect(reset.steps[1]).not.toHaveProperty('resultReason');
    expect(reset.steps[1]).not.toHaveProperty('resultConfidence');
  });

  it('moves pending steps up and down within the queue', () => {
    const first = createConversationAutomationSkillStep({ skillName: 'workflow-checkpoint' });
    const second = createConversationAutomationJudgeStep({ prompt: 'Judge second step.' });
    const third = createConversationAutomationSkillStep({ skillName: 'subagent-code-review' });

    const movedDown = moveConversationAutomationStep({
      version: 1,
      conversationId: 'conv-123',
      updatedAt: '2026-03-18T12:00:00.000Z',
      paused: true,
      steps: [first, second, third],
    }, first.id, 'down', '2026-03-18T12:05:00.000Z');

    expect(movedDown.steps.map((step) => step.id)).toEqual([second.id, first.id, third.id]);
    expect(movedDown.updatedAt).toBe('2026-03-18T12:05:00.000Z');
  });
});

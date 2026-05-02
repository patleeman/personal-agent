import { describe, expect, it } from 'vitest';

import {
  buildReferencedMemoryDocsContext,
  buildReferencedSkillsContext,
  buildReferencedTasksContext,
  extractMentionIds,
  pickPromptReferencesInOrder,
  type PromptReferenceMemoryDoc,
  type PromptReferenceSkill,
  type PromptReferenceTask,
  resolvePromptReferences,
} from './promptReferences.js';

const TASKS: PromptReferenceTask[] = [
  {
    id: 'daily-review',
    filePath: '/repo/profiles/datadog/agent/tasks/daily-review.task.md',
    prompt: "Review today's items.",
    enabled: true,
    running: false,
    cron: '0 9 * * *',
    at: '2026-04-01T09:00:00Z',
    model: 'claude-sonnet-4-6',
    lastStatus: 'success',
  },
  {
    id: 'memory-maintenance',
    filePath: '/repo/profiles/datadog/agent/tasks/memory-maintenance.task.md',
    prompt: 'Maintain durable memory.',
    enabled: false,
    running: true,
  },
];

const MEMORY_DOCS: PromptReferenceMemoryDoc[] = [
  {
    id: 'project-state-model',
    title: 'Project State Model',
    summary: 'How projects are represented in durable artifacts.',
    description: 'Use this note when the user asks how durable project state is modeled or migrated.',
    path: '/state/sync/notes/project-state-model/INDEX.md',
    updated: '2026-03-11',
  },
];

const SKILLS: PromptReferenceSkill[] = [
  {
    name: 'backfill-tests',
    source: 'durable node',
    description: 'Backfill tests for existing code.',
    path: '/vault/_skills/backfill-tests/SKILL.md',
  },
];

describe('promptReferences', () => {
  it('extracts unique mention ids in encounter order, including vault-style paths', () => {
    expect(extractMentionIds('Check @daily-review and @notes/project-state-model/INDEX.md then @daily-review again')).toEqual([
      'daily-review',
      'notes/project-state-model/INDEX.md',
    ]);
  });

  it('resolves project, task, and note node mentions independently', () => {
    expect(
      resolvePromptReferences({
        text: 'Use @desktop-ui with @memory-maintenance and @project-state-model.',
        availableProjectIds: ['desktop-ui', 'artifact-model'],
        tasks: TASKS,
        memoryDocs: MEMORY_DOCS,
        skills: [],
      }),
    ).toEqual({
      projectIds: ['desktop-ui'],
      taskIds: ['memory-maintenance'],
      memoryDocIds: ['project-state-model'],
      skillNames: [],
    });
  });

  it('ignores email-style @ tokens and resolves skill mentions independently', () => {
    expect(
      resolvePromptReferences({
        text: 'Contact foo@bar.com, then use @backfill-tests with @backfill-tests again.',
        availableProjectIds: [],
        tasks: TASKS,
        memoryDocs: MEMORY_DOCS,
        skills: SKILLS,
      }),
    ).toEqual({
      projectIds: [],
      taskIds: [],
      memoryDocIds: [],
      skillNames: ['backfill-tests'],
    });
  });

  it('preserves mention order when selecting referenced items', () => {
    expect(pickPromptReferencesInOrder(['memory-maintenance', 'daily-review'], TASKS).map((task) => task.id)).toEqual([
      'memory-maintenance',
      'daily-review',
    ]);
  });

  it('builds scheduled task context with file paths and status', () => {
    const context = buildReferencedTasksContext(TASKS, '/repo');
    expect(context).toContain('Referenced scheduled tasks:');
    expect(context).toContain('@daily-review');
    expect(context).toContain('profiles/datadog/agent/tasks/daily-review.task.md');
    expect(context).toContain('cron: 0 9 * * *');
    expect(context).toContain('at: 2026-04-01T09:00:00Z');
    expect(context).toContain('status: enabled, last status success');
    expect(context).toContain("prompt: Review today's items.");
    expect(context).toContain('status: disabled, running');
  });

  it('builds knowledge doc context with title, summary, and description', () => {
    const context = buildReferencedMemoryDocsContext(MEMORY_DOCS, '/repo');
    expect(context).toContain('Referenced note nodes:');
    expect(context).toContain('@project-state-model: Project State Model');
    expect(context).toContain('summary: How projects are represented in durable artifacts.');
    expect(context).toContain('description: Use this note when the user asks how durable project state is modeled or migrated.');
  });

  it('builds skill context using absolute paths outside the repo root', () => {
    const skillContext = buildReferencedSkillsContext(SKILLS, '/repo');
    expect(skillContext).toContain('Referenced skills:');
    expect(skillContext).toContain('@backfill-tests');
    expect(skillContext).toContain('path: /vault/_skills/backfill-tests/SKILL.md');
    expect(skillContext).toContain('source: durable node');
    expect(skillContext).toContain('description: Backfill tests for existing code.');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildReferencedMemoryDocsContext,
  buildReferencedTasksContext,
  extractMentionIds,
  pickPromptReferencesInOrder,
  resolvePromptReferences,
  type PromptReferenceMemoryDoc,
  type PromptReferenceTask,
} from './promptReferences.js';

const TASKS: PromptReferenceTask[] = [
  {
    id: 'daily-review',
    filePath: '/repo/profiles/datadog/agent/tasks/daily-review.task.md',
    prompt: 'Review today\'s items.',
    enabled: true,
    running: false,
    cron: '0 9 * * *',
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

describe('promptReferences', () => {
  it('extracts unique mention ids in encounter order, including vault-style paths', () => {
    expect(extractMentionIds('Check @daily-review and @_profiles/datadog/AGENTS.md then @daily-review again')).toEqual([
      'daily-review',
      '_profiles/datadog/AGENTS.md',
    ]);
  });

  it('resolves project, task, and note node mentions independently', () => {
    expect(resolvePromptReferences({
      text: 'Use @web-ui with @memory-maintenance and @project-state-model.',
      availableProjectIds: ['web-ui', 'artifact-model'],
      tasks: TASKS,
      memoryDocs: MEMORY_DOCS,
      skills: [],
      profiles: [],
    })).toEqual({
      projectIds: ['web-ui'],
      taskIds: ['memory-maintenance'],
      memoryDocIds: ['project-state-model'],
      skillNames: [],
      profileIds: [],
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
    expect(context).toContain('status: enabled, last status success');
    expect(context).toContain('prompt: Review today\'s items.');
    expect(context).toContain('status: disabled, running');
  });

  it('builds knowledge doc context with title, summary, and description', () => {
    const context = buildReferencedMemoryDocsContext(MEMORY_DOCS, '/repo');
    expect(context).toContain('Referenced note nodes:');
    expect(context).toContain('@project-state-model: Project State Model');
    expect(context).toContain('summary: How projects are represented in durable artifacts.');
    expect(context).toContain('description: Use this note when the user asks how durable project state is modeled or migrated.');
  });

});

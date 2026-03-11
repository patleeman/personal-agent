import { describe, expect, it } from 'vitest';
import {
  buildCapabilityCards,
  buildIdentitySummary,
  buildKnowledgeSections,
  buildMemoryPageSummary,
  formatUsageLabel,
  humanizeSkillName,
} from './memoryOverview';
import type { MemoryData } from './types';

const MEMORY_DATA: MemoryData = {
  profile: 'datadog',
  agentsMd: [
    {
      source: 'shared',
      path: '/repo/profiles/shared/agent/AGENTS.md',
      exists: true,
      content: `# Shared\n\n## Role\n- You are a coding assistant.\n\n## Operating Policy\n- Prefer simple implementations.\n- Ask before destructive changes.\n`,
    },
    {
      source: 'datadog',
      path: '/repo/profiles/datadog/agent/AGENTS.md',
      exists: true,
      content: `# Datadog Profile\n\n## Role\n- You are a coding agent and assistant for Datadog-focused work.\n\n## Operating Policy\n- Prefer internal tools over the public web when possible.\n- Use ~/agent-workspace only for scratch or test work.\n- Keep the main thread unblocked during long-running work.\n\n## Durable User Context\n- Work email: patrick@example.com\n`,
    },
  ],
  skills: [
    {
      source: 'shared',
      name: 'workflow-create-pr',
      description: 'Create a PR from the current branch.',
      path: '/repo/profiles/shared/agent/skills/workflow-create-pr/SKILL.md',
      recentSessionCount: 1,
      lastUsedAt: '2026-03-11T12:00:00.000Z',
      usedInLastSession: true,
    },
    {
      source: 'shared',
      name: 'tool-agent-browser',
      description: 'Drive websites and Electron apps.',
      path: '/repo/profiles/shared/agent/skills/tool-agent-browser/SKILL.md',
      recentSessionCount: 2,
      lastUsedAt: '2026-03-10T12:00:00.000Z',
      usedInLastSession: false,
    },
    {
      source: 'datadog',
      name: 'dd-oncall',
      description: 'Find who is on-call and inspect pages.',
      path: '/repo/profiles/datadog/agent/skills/dd-oncall/SKILL.md',
      recentSessionCount: 0,
      lastUsedAt: null,
      usedInLastSession: false,
    },
  ],
  memoryDocs: [
    {
      id: 'sql-heuristics',
      title: 'Structured SQL Heuristics',
      summary: 'Learned heuristics for composing structured SQL queries.',
      tags: ['sql', 'heuristic'],
      type: 'pattern',
      path: '/repo/profiles/datadog/agent/memory/sql-heuristics.md',
      recentSessionCount: 1,
      lastUsedAt: '2026-03-11T09:00:00.000Z',
      usedInLastSession: false,
    },
    {
      id: 'atlas-guide',
      title: 'Atlas Temporal Integration Notes',
      summary: 'Reference notes for Atlas integration work.',
      tags: ['atlas', 'reference'],
      type: 'reference',
      path: '/repo/profiles/datadog/agent/memory/atlas-guide.md',
      recentSessionCount: 0,
      lastUsedAt: null,
      usedInLastSession: false,
    },
  ],
};

describe('memory overview helpers', () => {
  it('extracts role, rules, and boundaries for identity', () => {
    const identity = buildIdentitySummary(MEMORY_DATA);

    expect(identity.role).toBe('A coding agent and assistant for Datadog-focused work');
    expect(identity.ruleCount).toBeGreaterThanOrEqual(4);
    expect(identity.behaviorRules).toContain('Prefer internal tools over the public web when possible.');
    expect(identity.boundaries).toContain('Use ~/agent-workspace only for scratch or test work.');
    expect(identity.primaryItem?.source).toBe('datadog');
  });

  it('humanizes skill names for capability cards', () => {
    expect(humanizeSkillName('workflow-create-pr')).toBe('Create PR');
    expect(humanizeSkillName('best-practices-react')).toBe('React Best Practices');
    expect(humanizeSkillName('dd-oncall')).toBe('On-call');
  });

  it('builds capability cards with soft metadata and recent-use labels', () => {
    const capabilities = buildCapabilityCards(MEMORY_DATA);

    expect(capabilities[0]?.title).toBe('Create PR');
    expect(capabilities[0]?.usageLabel).toBe('Triggered in last session');
    expect(capabilities[1]?.usageLabel).toBe('Used 2 times this week');
    expect(capabilities[2]).toMatchObject({
      title: 'On-call',
      sourceLabel: 'Custom',
      usageLabel: 'Not used recently',
    });
  });

  it('organizes knowledge by meaning instead of file structure', () => {
    const knowledge = buildKnowledgeSections(MEMORY_DATA);

    expect(knowledge.recent).toHaveLength(1);
    expect(knowledge.patterns.map((item) => item.title)).toContain('Structured SQL Heuristics');
    expect(knowledge.references.map((item) => item.title)).toContain('Atlas Temporal Integration Notes');
  });

  it('summarizes the three memory layers', () => {
    const summary = buildMemoryPageSummary(MEMORY_DATA);

    expect(summary).toMatchObject({
      role: 'A coding agent and assistant for Datadog-focused work',
      capabilityCount: 3,
      recentlyUsedCapabilities: 2,
      knowledgeCount: 2,
      recentlyUsedKnowledge: 1,
    });
  });

  it('formats human-readable usage affordances', () => {
    expect(formatUsageLabel(0, null, false, 'Not used recently')).toBe('Not used recently');
    expect(formatUsageLabel(1, '2026-03-11T09:00:00.000Z', false, 'Not used recently')).toContain('Used');
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildConversationAutomationFilterHelp,
  buildLegacyJudgeFilter,
  evaluateConversationAutomationFilter,
  normalizeConversationAutomationFilter,
  parseConversationAutomationFilter,
  validateConversationAutomationFilter,
} from './conversationAutomationFilter.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('conversationAutomationFilter', () => {
  it('parses nested boolean expressions', () => {
    const parsed = parseConversationAutomationFilter('(event:turn_end AND repo:personal-agent) OR prompt:"Did the agent finish?"');
    expect(parsed).toEqual({
      type: 'group',
      operator: 'OR',
      children: [
        {
          type: 'group',
          operator: 'AND',
          children: [
            { type: 'term', field: 'event', value: 'turn_end' },
            { type: 'term', field: 'repo', value: 'personal-agent' },
          ],
        },
        { type: 'term', field: 'prompt', value: 'Did the agent finish?' },
      ],
    });
  });

  it('accepts judge as a legacy alias for prompt', () => {
    const parsed = parseConversationAutomationFilter('judge:"Did the agent finish?"');
    expect(parsed).toEqual({ type: 'term', field: 'prompt', value: 'Did the agent finish?' });
  });

  it('wraps legacy prompts as prompt filters', () => {
    expect(normalizeConversationAutomationFilter('Pass when approved.')).toBe('prompt:"Pass when approved."');
    expect(buildLegacyJudgeFilter('Use "quotes" safely')).toBe('prompt:"Use \\"quotes\\" safely"');
  });

  it('validates tool names and events', () => {
    expect(() => validateConversationAutomationFilter('tool:edit', {
      toolNames: new Set(['edit']),
      events: new Set(['manual', 'turn_end']),
    })).not.toThrow();
    expect(() => validateConversationAutomationFilter('event:turn_end', {
      toolNames: new Set(['edit']),
      events: new Set(['manual', 'turn_end']),
    })).not.toThrow();
    expect(() => validateConversationAutomationFilter('repo:personal-agent', {
      toolNames: new Set(['edit']),
      events: new Set(['manual', 'turn_end']),
    })).not.toThrow();
    expect(() => validateConversationAutomationFilter('tool:missing', {
      toolNames: new Set(['edit']),
      events: new Set(['manual', 'turn_end']),
    })).toThrow('Unknown tool: missing.');
    expect(() => validateConversationAutomationFilter('event:missing', {
      toolNames: new Set(['edit']),
      events: new Set(['manual', 'turn_end']),
    })).toThrow('Unknown event: missing.');
  });

  it('evaluates repo filters against the conversation cwd git repo', async () => {
    const repoDir = createTempDir('pa-conversation-automation-filter-repo-');
    const repoName = repoDir.split('/').filter(Boolean).pop() ?? '';
    runGit(['init'], repoDir);

    const passResult = await evaluateConversationAutomationFilter(`repo:${repoName}`, {
      cwd: repoDir,
      messages: [],
      toolNames: new Set(),
      modelRegistry: {
        getAvailable: () => [],
        getApiKey: vi.fn(),
      },
      settingsFile: '',
      trigger: 'turn_end',
    });

    const failResult = await evaluateConversationAutomationFilter('repo:missing-repo', {
      cwd: repoDir,
      messages: [],
      toolNames: new Set(),
      modelRegistry: {
        getAvailable: () => [],
        getApiKey: vi.fn(),
      },
      settingsFile: '',
      trigger: 'turn_end',
    });

    expect(passResult.pass).toBe(true);
    expect(failResult.pass).toBe(false);
  });

  it('builds help metadata with examples and values', () => {
    const help = buildConversationAutomationFilterHelp([
      { name: 'write', description: 'Create or overwrite files.' },
      { name: 'edit', description: 'Edit a file precisely.' },
      { name: 'web_search', description: 'Search the web.' },
    ]);
    expect(help.fields.find((field) => field.key === 'event')?.values).toEqual(['manual', 'turn_end']);
    expect(help.fields.find((field) => field.key === 'tool')?.values).toEqual(['edit', 'web_search', 'write']);
    expect(help.availableTools).toEqual([
      { name: 'edit', description: 'Edit a file precisely.' },
      { name: 'web_search', description: 'Search the web.' },
      { name: 'write', description: 'Create or overwrite files.' },
    ]);
    expect(help.examples[0]).toContain('event:turn_end');
    expect(help.fields.find((field) => field.key === 'repo')?.valueHint).toContain('git repo name');
    expect(help.examples[1]).toContain('repo:personal-agent');
    expect(help.examples[1]).toContain('tool:web_search');
    expect(help.examples[2]).toContain('tool:edit');
    expect(help.examples[2]).toContain('prompt:"Did the assistant already complete the feature?"');
  });
});

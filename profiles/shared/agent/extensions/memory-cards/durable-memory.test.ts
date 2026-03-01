import { describe, expect, it } from 'vitest';
import {
  applyDurableMemoryChanges,
  buildDurableMemoryBlock,
  createDefaultDurableMemoryContent,
  sanitizeProfileName,
} from './durable-memory';

describe('durable-memory helpers', () => {
  it('creates default memory document with required sections', () => {
    const content = createDefaultDurableMemoryContent();

    expect(content).toContain('# Durable Memory');
    expect(content).toContain('## User');
    expect(content).toContain('## Preferences');
    expect(content).toContain('## Environment');
    expect(content).toContain('## Constraints');
    expect(content).toContain('## Do Not Store');
    expect(content).toContain('Secrets, credentials, API keys, tokens');
  });

  it('applies upsert/remove/replace changes idempotently', () => {
    const existing = createDefaultDurableMemoryContent();

    const firstUpdate = applyDurableMemoryChanges({
      existingContent: existing,
      changes: [
        {
          op: 'upsert',
          section: 'User',
          value: 'Name: Patrick',
        },
        {
          op: 'upsert',
          section: 'Preferences',
          value: 'Prefers concise responses',
        },
        {
          op: 'replace',
          section: 'Preferences',
          from: 'Prefers concise responses',
          to: 'Concise by default unless more detail is requested',
        },
        {
          op: 'remove',
          section: 'User',
          value: 'Name: Patrick',
        },
      ],
    });

    expect(firstUpdate.changed).toBe(true);
    expect(firstUpdate.content).toContain('Concise by default unless more detail is requested');
    expect(firstUpdate.content).not.toContain('Name: Patrick');

    const secondUpdate = applyDurableMemoryChanges({
      existingContent: firstUpdate.content,
      changes: [
        {
          op: 'upsert',
          section: 'Preferences',
          value: 'Concise by default unless more detail is requested',
        },
      ],
    });

    expect(secondUpdate.changed).toBe(false);
  });

  it('builds a durable memory block and truncates for token cap', () => {
    const content = `# Durable Memory\n\n## User\n- Name: Patrick\n\n## Preferences\n- Prefers concise responses\n- Uses TypeScript\n\n## Environment\n- Timezone: America/New_York`;

    const block = buildDurableMemoryBlock({
      profile: 'shared',
      cwd: '/tmp/project',
      memoryFilePath: '/tmp/project/profiles/shared/agent/MEMORY.md',
      memoryFileContent: content,
      maxTokens: 15,
    });

    expect(block).toContain('DURABLE_MEMORY');
    expect(block).toContain('profile=shared');
    expect(block).toContain('If the user gives newer conflicting facts');
    expect(block).toContain('truncated');
  });

  it('validates profile names for path safety', () => {
    expect(sanitizeProfileName('shared')).toBe('shared');
    expect(sanitizeProfileName('datadog-prod')).toBe('datadog-prod');
    expect(sanitizeProfileName('../shared')).toBeUndefined();
    expect(sanitizeProfileName('')).toBeUndefined();
  });
});

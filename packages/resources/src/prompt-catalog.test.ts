import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composePromptCatalogDirectory,
  composePromptCatalogEntries,
  getPromptCatalogRoot,
  listPromptCatalogEntries,
  readPromptCatalogEntry,
  renderPromptCatalogTemplate,
  requirePromptCatalogEntry,
} from './prompt-catalog.js';

const tempDirs: string[] = [];

function createTempRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('prompt catalog helpers', () => {
  it('reads and trims a prompt catalog entry from the provided repo root', () => {
    const repo = createTempRepo('pa-prompt-catalog-');
    mkdirSync(join(repo, 'prompt-catalog', 'utilities'), { recursive: true });
    writeFileSync(join(repo, 'prompt-catalog', 'utilities', 'title.md'), '  test prompt\n');

    expect(getPromptCatalogRoot(repo)).toBe(join(repo, 'prompt-catalog'));
    expect(readPromptCatalogEntry('utilities/title.md', { repoRoot: repo })).toBe('test prompt');
    expect(requirePromptCatalogEntry('utilities/title.md', { repoRoot: repo })).toBe('test prompt');
  });

  it('renders template placeholders and collapses extra blank lines', () => {
    const rendered = renderPromptCatalogTemplate([
      'Header',
      '{{section_one}}',
      '{{section_two}}',
      'Footer',
    ].join('\n'), {
      section_one: 'First block',
      section_two: '',
    });

    expect(rendered).toBe(['Header', 'First block', '', 'Footer'].join('\n'));
  });

  it('composes multiple entries in order', () => {
    const repo = createTempRepo('pa-prompt-catalog-');
    mkdirSync(join(repo, 'prompt-catalog', 'runtime'), { recursive: true });
    writeFileSync(join(repo, 'prompt-catalog', 'runtime', 'base.md'), 'Base block\n');
    writeFileSync(join(repo, 'prompt-catalog', 'runtime', 'extra.md'), 'Extra block\n');

    expect(composePromptCatalogEntries(['runtime/base.md', 'runtime/extra.md'], { repoRoot: repo })).toBe([
      'Base block',
      '',
      'Extra block',
    ].join('\n'));
  });

  it('lists and composes directory entries in sorted order', () => {
    const repo = createTempRepo('pa-prompt-catalog-');
    mkdirSync(join(repo, 'prompt-catalog', 'system'), { recursive: true });
    writeFileSync(join(repo, 'prompt-catalog', 'system', '20-task.md'), 'Task block\n');
    writeFileSync(join(repo, 'prompt-catalog', 'system', '10-tools.md'), 'Tools block\n');

    expect(listPromptCatalogEntries('system', { repoRoot: repo })).toEqual([
      'system/10-tools.md',
      'system/20-task.md',
    ]);
    expect(composePromptCatalogDirectory('system', { repoRoot: repo })).toBe([
      'Tools block',
      '',
      'Task block',
    ].join('\n'));
  });

  it('returns undefined for missing optional entries and throws for required ones', () => {
    const repo = createTempRepo('pa-prompt-catalog-');
    mkdirSync(join(repo, 'prompt-catalog'), { recursive: true });

    expect(readPromptCatalogEntry('missing.md', { repoRoot: repo })).toBeUndefined();
    expect(() => requirePromptCatalogEntry('missing.md', { repoRoot: repo })).toThrow('Prompt catalog entry not found');
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getPromptCatalogRoot,
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
      '{{ section_one }}',
      '{{ section_two }}',
      'Footer',
    ].join('\n'), {
      section_one: 'First block',
      section_two: '',
    });

    expect(rendered).toBe(['Header', 'First block', '', 'Footer'].join('\n'));
  });

  it('renders nunjucks conditional logic', () => {
    const rendered = renderPromptCatalogTemplate([
      'Header',
      '{% if include_footer %}Footer{% endif %}',
    ].join('\n'), {
      include_footer: true,
    });

    expect(rendered).toBe('Header\nFooter');
  });

  it('returns undefined for missing optional entries and throws for required ones', () => {
    const repo = createTempRepo('pa-prompt-catalog-');
    mkdirSync(join(repo, 'prompt-catalog'), { recursive: true });

    expect(readPromptCatalogEntry('missing.md', { repoRoot: repo })).toBeUndefined();
    expect(() => requirePromptCatalogEntry('missing.md', { repoRoot: repo })).toThrow('Prompt catalog entry not found');
  });
});

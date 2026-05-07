import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';

import { getDurableAgentFilePath, getDurableSkillsDir, getProfilesRoot } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRecentReadUsage,
  buildStructuredNoteMarkdown,
  clearMemoryBrowserCaches,
  createMemoryDoc,
  createSkillDoc,
  ensureMemoryDocsDir,
  extractNoteSummaryFromBody,
  findMemoryDocById,
  generateCreatedNoteId,
  isEditableMemoryFilePath,
  listMemoryDocs,
  listSkillsForProfile,
  normalizeCreatedNoteDescription,
  normalizeCreatedNoteSummary,
  normalizeCreatedNoteTitle,
  normalizeMemoryPath,
  normalizeNoteBody,
  warmMemoryBrowserCaches,
} from './memoryDocs.js';

const originalEnv = process.env;
const originalCwd = process.cwd();
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function notePath(stateRoot: string, noteId: string): string {
  return join(stateRoot, 'sync', 'notes', `${noteId}.md`);
}

function skillPath(skillId: string, fileName = 'SKILL.md'): string {
  return join(getDurableSkillsDir(dirname(getProfilesRoot())), skillId, fileName);
}

beforeEach(() => {
  const stateRoot = createTempDir('pa-web-memory-docs-');
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
    PERSONAL_AGENT_VAULT_ROOT: join(stateRoot, 'sync'),
    PERSONAL_AGENT_PROFILES_ROOT: join(stateRoot, 'sync', 'profiles'),
  };
  clearMemoryBrowserCaches();
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('web memory docs', () => {
  it('lists note nodes from sync/notes packages', () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    writeFile(
      notePath(stateRoot, 'memory-index'),
      `---
id: memory-index
kind: note
title: Memory Index
summary: Top-level note hub.
description: Durable routing note.
status: active
updatedAt: 2026-03-31
metadata:
  type: reference
  area: notes
  role: structure
links:
  related:
    - unified-node-design
---

# Memory Index

Top-level note hub.
`,
    );

    const docs = listMemoryDocs({ includeSearchText: true });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: 'memory-index',
      title: 'Memory Index',
      summary: 'Top-level note hub.',
      description: 'Durable routing note.',
      path: notePath(stateRoot, 'memory-index'),
      type: 'reference',
      area: 'notes',
      role: 'structure',
      status: 'active',
      related: ['unified-node-design'],
      referenceCount: 0,
    });
    expect(docs[0]?.searchText).toContain('top-level note hub');
    expect(docs[0]?.searchText).toContain('unified-node-design');
  });

  it('normalizes helper inputs and allows durable memory roots', () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const profilesRoot = getProfilesRoot();

    mkdirSync(join(profilesRoot, 'assistant'), { recursive: true });

    expect(normalizeMemoryPath('  /tmp/demo/../note.md  ')).toBe(normalize('/tmp/demo/../note.md'));
    expect(normalizeMemoryPath(null)).toBe('');
    expect(ensureMemoryDocsDir()).toBe(join(stateRoot, 'sync', 'notes'));
    expect(isEditableMemoryFilePath(notePath(stateRoot, 'memory-index'), 'assistant')).toBe(true);
    expect(isEditableMemoryFilePath(join(profilesRoot, 'assistant', 'profile.md'), 'assistant')).toBe(false);
    expect(isEditableMemoryFilePath(join(profilesRoot, 'assistant', 'agent', 'AGENTS.md'), 'assistant')).toBe(false);
    expect(isEditableMemoryFilePath(getDurableAgentFilePath(join(stateRoot, 'sync')), 'assistant')).toBe(true);
    expect(isEditableMemoryFilePath(skillPath('browser-helper'), 'assistant')).toBe(true);
    expect(isEditableMemoryFilePath(join(stateRoot, 'outside.md'), 'assistant')).toBe(false);
    expect(isEditableMemoryFilePath('', 'assistant')).toBe(false);
    expect(buildRecentReadUsage(['/tmp/memory-index.md'])).toEqual(new Map());
    expect(() => warmMemoryBrowserCaches('assistant')).not.toThrow();
  });

  it('lists skills for a profile and creates new durable skill docs', () => {
    const repoRoot = createTempDir('pa-web-memory-docs-repo-');
    process.chdir(repoRoot);
    mkdirSync(join(getProfilesRoot(), 'assistant'), { recursive: true });

    writeFile(
      skillPath('alpha-skill'),
      `---
name: alpha-skill
description: Alpha summary.
profiles:
  - assistant
---

# Alpha Skill

Use the alpha helper.
`,
    );
    writeFile(
      skillPath('fallback-skill'),
      `---
name: fallback-skill
description: Fallback description.
---

# Fallback Skill

Use the fallback helper.
`,
    );
    writeFile(
      skillPath('other-only'),
      `---
id: other-only
summary: Hidden from assistant.
profiles:
  - other
---

# Other Only
`,
    );

    const skills = listSkillsForProfile('assistant');
    expect(skills).toEqual([
      {
        name: 'alpha-skill',
        source: 'global',
        description: 'Alpha summary.',
        path: skillPath('alpha-skill'),
      },
      {
        name: 'fallback-skill',
        source: 'global',
        description: 'Fallback description.',
        path: skillPath('fallback-skill'),
      },
      {
        name: 'other-only',
        source: 'global',
        description: 'Hidden from assistant.',
        path: skillPath('other-only'),
      },
    ]);

    const created = createSkillDoc({
      name: 'project-helper',
      title: 'Project Helper',
      description: 'Builds reusable project workflows.',
      body: '# Project Helper\n\nUse this skill for project work.',
      profile: 'assistant',
    });
    expect(created).toMatchObject({
      name: 'project-helper',
      source: 'project',
      description: 'Builds reusable project workflows.',
    });
    expect(existsSync(created.path)).toBe(true);
    expect(readFileSync(created.path, 'utf-8')).toContain('# Project Helper');
  });

  it('finds docs, generates note ids, and builds structured markdown', () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    writeFile(
      notePath(stateRoot, 'existing-note'),
      `---
id: existing-note
kind: note
title: Existing Note
summary: Existing summary.
description: Existing description.
status: archived
tags:
  - custom:keep
  - type:old
---

# Existing Note

Old body.
`,
    );

    expect(findMemoryDocById('existing-note')).toMatchObject({
      id: 'existing-note',
      title: 'Existing Note',
    });
    expect(findMemoryDocById('missing-note')).toBeNull();
    expect(generateCreatedNoteId('Existing Note')).toBe('existing-note-2');
    expect(normalizeCreatedNoteTitle('  Multi   word title  ')).toBe('Multi word title');
    expect(normalizeCreatedNoteSummary('  Durable   summary  ')).toBe('Durable summary');
    expect(normalizeCreatedNoteDescription('  Helpful   description  ')).toBe('Helpful description');
    expect(normalizeNoteBody('  line one\r\n\r\nline two  ')).toBe('line one\n\nline two');
    expect(extractNoteSummaryFromBody('# Heading\n\n![diagram](./diagram.png)\n\nFirst summary sentence.\n\nSecond paragraph.')).toBe(
      'First summary sentence.',
    );

    const markdown = buildStructuredNoteMarkdown(readFileSync(notePath(stateRoot, 'existing-note'), 'utf-8'), {
      noteId: 'existing-note',
      title: '  Updated Note  ',
      summary: ' ',
      descriptionProvided: false,
      body: 'Paragraph one.\r\n\r\nParagraph two.',
    });
    expect(markdown).toContain('title: Updated Note');
    expect(markdown).toContain('summary: Paragraph one.');
    expect(markdown).toContain('description: Existing description.');
    expect(markdown).toContain('- custom:keep');
    expect(markdown).toContain('- status:archived');
    expect(markdown).toContain('- type:note');
    expect(markdown).toContain('# Updated Note');

    const markdownWithoutDescription = buildStructuredNoteMarkdown(
      '---\nid: blank-note\nstatus: active\ndescription: Remove me\n---\n\n# Blank',
      {
        noteId: 'blank-note',
        title: 'Blank Note',
        summary: 'Provided summary.',
        description: ' ',
        descriptionProvided: true,
        body: 'Provided body.',
      },
    );
    expect(markdownWithoutDescription).toContain('summary: Provided summary.');
    expect(markdownWithoutDescription).not.toContain('description: Remove me');
  });

  it('creates note nodes in sync/notes packages', () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;

    const created = createMemoryDoc({
      id: 'quick-note',
      title: 'Quick Note',
      summary: 'Captured thought.',
      description: 'Scratch note.',
      status: 'active',
      type: 'reference',
      area: 'notes',
      role: 'structure',
      parent: 'memory-index',
      related: ['desktop', 'unified-node-design'],
      updated: '2026-04-01T00:00:00.000Z',
    });

    expect(created).toMatchObject({
      filePath: notePath(stateRoot, 'quick-note'),
      title: 'Quick Note',
      summary: 'Captured thought.',
      description: 'Scratch note.',
      status: 'active',
      type: 'note',
      area: 'notes',
      role: 'structure',
      parent: 'memory-index',
      related: ['desktop', 'unified-node-design'],
      updated: '2026-04-01T00:00:00.000Z',
    });

    const content = readFileSync(notePath(stateRoot, 'quick-note'), 'utf-8');
    expect(content).toContain('id: quick-note');
    expect(content).toContain('title: Quick Note');
    expect(content).toContain('summary: Captured thought.');
    expect(content).toContain('# Quick Note');
    expect(listMemoryDocs().find((doc) => doc.id === 'quick-note')).toMatchObject({
      id: 'quick-note',
      type: 'reference',
      area: 'notes',
      role: 'structure',
      parent: 'memory-index',
      related: ['desktop', 'unified-node-design'],
    });
  });
});

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMemoryDocs } from '@personal-agent/core';
import { saveCuratedDistilledConversationMemory, type DistilledConversationMemoryDraft } from './conversationMemoryCuration.js';

const tempDirs: string[] = [];

function createTempProfilesRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const profilesRoot = join(root, 'sync', 'profiles');
  mkdirSync(profilesRoot, { recursive: true });
  tempDirs.push(root);
  return profilesRoot;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function memoryPath(profilesRoot: string, memoryName: string): string {
  return join(profilesRoot, '..', 'notes', memoryName, 'INDEX.md');
}

function referencePath(profilesRoot: string, memoryName: string, referenceName: string): string {
  return join(profilesRoot, '..', 'notes', memoryName, 'references', `${referenceName}.md`);
}

function memoryDir(profilesRoot: string): string {
  return join(profilesRoot, '..', 'notes');
}

function buildDraft(overrides: Partial<DistilledConversationMemoryDraft> = {}): DistilledConversationMemoryDraft {
  return {
    title: 'Memory browser and right rail polish',
    summary: 'Keep the memory surface aligned with the right-rail-first web UI layout.',
    body: `# Memory browser and right rail polish

Keep the memory surface aligned with the right-rail-first web UI layout.

At this checkpoint, the user intent was: tighten the memory browser around hubs, browsing, and a resizable right rail.
`,
    userIntent: 'tighten the memory browser around hubs, browsing, and a resizable right rail.',
    learnedPoints: ['The right rail should stay visible and resizable.', 'Memory management should reuse the page-shell/list/right-rail pattern.'],
    carryForwardPoints: ['Keep the surface inbox-first and conversation-first.', 'Avoid nested bordered containers.'],
    ...overrides,
  };
}

describe('conversation memory curation', () => {
  it('updates the strongest matching reference inside an existing hub package', () => {
    const profilesRoot = createTempProfilesRoot('pa-conversation-memory-match-');
    writeFile(
      memoryPath(profilesRoot, 'personal-agent'),
      `---
id: personal-agent
kind: note
title: Personal-agent knowledge hub
summary: Hub doc.
status: active
updatedAt: 2026-03-18
metadata:
  type: project
  area: personal-agent
  role: structure
---

# Personal-agent knowledge hub
`,
    );
    writeFile(
      referencePath(profilesRoot, 'personal-agent', 'web-ui'),
      `---
name: web-ui
description: Durable UX preferences for the web app.
metadata:
  title: Personal-agent web UI preferences
  updated: 2026-03-18
---

# Personal-agent web UI preferences

- Keep the right rail visible and resizable.
- Memory management should reuse the page-shell/list/right-rail pattern.
`,
    );
    writeFile(
      referencePath(profilesRoot, 'personal-agent', 'state-model'),
      `# Personal-agent project state model

- Keep planning state durable.
- Respect project boundaries.
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);

    const result = saveCuratedDistilledConversationMemory({
      memoryDir: memoryDir(profilesRoot),
      existingDocs: loaded.docs,
      draft: buildDraft(),
      updated: '2026-03-18',
      distilledAt: '2026-03-18T12:00:00.000Z',
      area: 'personal-agent',
      sourceConversationTitle: 'Memory browser polish',
      sourceCwd: '/Users/patrick/workingdir/personal-agent',
      sourceProfile: 'assistant',
      relatedProjectIds: ['personal-agent'],
      anchorPreview: 'Polish the memory browser and right rail',
    });

    expect(result.disposition).toBe('updated-existing');
    expect(result.memory.id).toBe('personal-agent');
    expect(result.reference.relativePath).toBe('references/web-ui.md');

    const webUiContent = readFileSync(referencePath(profilesRoot, 'personal-agent', 'web-ui'), 'utf-8');
    expect(webUiContent).toContain('## Distilled updates');
    expect(webUiContent).toContain('Memory browser and right rail polish');
    expect(webUiContent).toContain('page-shell/list/right-rail pattern');

    const stateModelContent = readFileSync(referencePath(profilesRoot, 'personal-agent', 'state-model'), 'utf-8');
    expect(stateModelContent).not.toContain('Memory browser and right rail polish');
  });

  it('creates a new reference inside the matching hub when no reference match is strong enough', () => {
    const profilesRoot = createTempProfilesRoot('pa-conversation-memory-create-ref-');
    writeFile(
      memoryPath(profilesRoot, 'personal-agent'),
      `---
id: personal-agent
kind: note
title: Personal-agent knowledge hub
summary: Hub doc.
status: active
updatedAt: 2026-03-18
metadata:
  type: project
  area: personal-agent
  role: structure
---

# Personal-agent knowledge hub
`,
    );
    writeFile(
      referencePath(profilesRoot, 'personal-agent', 'deployment-notes'),
      `# Deployment notes

Track deployment timings and release checks.
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);

    const result = saveCuratedDistilledConversationMemory({
      memoryDir: memoryDir(profilesRoot),
      existingDocs: loaded.docs,
      draft: buildDraft({
        title: 'General personal-agent follow-up',
        summary: 'Loose follow-up that should stay in the package until curated further.',
        body: '# General personal-agent follow-up\n\nLoose follow-up that should stay in the package until curated further.\n',
        userIntent: 'capture a broad follow-up inside the package without picking an existing reference.',
        learnedPoints: ['There are a few follow-ups to sort out later.'],
        carryForwardPoints: ['Curate this into a more specific reference later.'],
      }),
      updated: '2026-03-18',
      distilledAt: '2026-03-18T12:00:00.000Z',
      area: 'personal-agent',
      sourceConversationTitle: 'General follow-up',
      sourceCwd: '/Users/patrick/workingdir/personal-agent',
      sourceProfile: 'assistant',
      relatedProjectIds: ['personal-agent'],
      anchorPreview: 'General personal-agent follow-up',
    });

    expect(result.disposition).toBe('created-reference');
    expect(result.memory.id).toBe('personal-agent');
    expect(result.reference.relativePath).toMatch(/^references\/general-personal-agent-follow-up/);

    const createdContent = readFileSync(result.reference.path, 'utf-8');
    expect(createdContent).toContain('name: general-personal-agent-follow-up');
    expect(createdContent).toContain('description: Loose follow-up that should stay in the package until curated further.');
    expect(createdContent).toContain('origin: conversation');
  });

  it('creates a new hub package before writing a reference when no matching hub exists', () => {
    const profilesRoot = createTempProfilesRoot('pa-conversation-memory-new-hub-');

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.docs).toHaveLength(0);

    const result = saveCuratedDistilledConversationMemory({
      memoryDir: memoryDir(profilesRoot),
      existingDocs: loaded.docs,
      draft: buildDraft({
        title: 'Runpod provisioning notes',
        summary: 'Capture a new Runpod memory area.',
      }),
      updated: '2026-03-19',
      distilledAt: '2026-03-19T12:00:00.000Z',
      area: 'runpod',
      sourceConversationTitle: 'Runpod provisioning',
      sourceCwd: '/tmp/runpod',
      sourceProfile: 'assistant',
      relatedProjectIds: ['runpod'],
      anchorPreview: 'Runpod provisioning notes',
    });

    expect(result.disposition).toBe('created-reference');
    expect(result.memory.id).toBe('runpod');
    expect(readFileSync(memoryPath(profilesRoot, 'runpod'), 'utf-8')).toContain('role: structure');
    expect(result.reference.relativePath).toBe('references/runpod-provisioning-notes.md');
  });
});

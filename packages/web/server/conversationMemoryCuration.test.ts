import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMemoryDocs } from '@personal-agent/core';
import { mergeCaptureMemoryIntoCanonical, saveCuratedDistilledConversationMemory, type DistilledConversationMemoryDraft } from './conversationMemoryCuration.js';

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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function memoryPath(profilesRoot: string, fileName: string): string {
  return join(profilesRoot, '_memory', fileName);
}

function buildDraft(overrides: Partial<DistilledConversationMemoryDraft> = {}): DistilledConversationMemoryDraft {
  return {
    title: 'Memory browser and right rail polish',
    summary: 'Keep the memory surface aligned with the right-rail-first web UI layout.',
    body: `# Memory browser and right rail polish

Keep the memory surface aligned with the right-rail-first web UI layout.

At this checkpoint, the user intent was: tighten the memory browser around hubs, browsing, and a resizable right rail.
`,
    tags: ['conversation', 'checkpoint', 'personal-agent', 'web-ui'],
    userIntent: 'tighten the memory browser around hubs, browsing, and a resizable right rail.',
    learnedPoints: ['The right rail should stay visible and resizable.', 'Memory management should reuse the page-shell/list/right-rail pattern.'],
    carryForwardPoints: ['Keep the surface inbox-first and conversation-first.', 'Avoid nested bordered containers.'],
    ...overrides,
  };
}

describe('conversation memory curation', () => {
  it('updates the single canonical doc for a scoped area instead of creating a capture', () => {
    const profilesRoot = createTempDir('pa-conversation-memory-single-');
    writeFile(
      memoryPath(profilesRoot, 'runpod.md'),
      `---
id: runpod
title: "Runpod"
summary: "Canonical runpod operating notes."
type: "reference"
status: "active"
area: runpod
role: "canonical"
tags:
  - "runpod"
  - "gpu"
updated: 2026-03-18
---

# Runpod

Canonical runpod notes.
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);

    const result = saveCuratedDistilledConversationMemory({
      memoryDir: join(profilesRoot, '_memory'),
      existingDocs: loaded.docs,
      draft: buildDraft({
        title: 'Runpod cleanup and provisioning follow-ups',
        summary: 'Track Runpod cleanup and provisioning follow-ups.',
        body: '# Runpod cleanup and provisioning follow-ups\n\nTrack Runpod cleanup and provisioning follow-ups.\n',
        tags: ['conversation', 'checkpoint', 'runpod', 'gpu'],
        userIntent: 'finish the runpod provisioning cleanup work.',
        learnedPoints: ['The cleanup flow should remove stale pods automatically.'],
        carryForwardPoints: ['Keep provisioning fast and short-lived.'],
      }),
      updated: '2026-03-18',
      distilledAt: '2026-03-18T12:00:00.000Z',
      area: 'runpod',
      sourceConversationTitle: 'Runpod cleanup',
      sourceCwd: '/tmp/runpod',
      sourceProfile: 'assistant',
      relatedProjectIds: ['runpod'],
      anchorPreview: 'Runpod cleanup follow-ups',
    });

    expect(result.disposition).toBe('updated-existing');
    expect(result.memory.id).toBe('runpod');
    expect(readdirSync(join(profilesRoot, '_memory'))).toEqual(['runpod.md']);

    const updatedContent = readFileSync(memoryPath(profilesRoot, 'runpod.md'), 'utf-8');
    expect(updatedContent).toContain('## Distilled updates');
    expect(updatedContent).toContain('### 2026-03-18 — Runpod cleanup and provisioning follow-ups');
    expect(updatedContent).toContain('finish the runpod provisioning cleanup work');
  });

  it('updates the strongest matching canonical doc when an area has multiple canonicals', () => {
    const profilesRoot = createTempDir('pa-conversation-memory-match-');
    writeFile(
      memoryPath(profilesRoot, 'personal-agent.md'),
      `---
id: personal-agent
title: "personal-agent knowledge hub"
summary: "Hub doc."
type: "project"
status: "active"
area: personal-agent
role: "hub"
related:
  - "personal-agent-web-ui-preferences"
  - "personal-agent-project-state-model"
tags:
  - "personal-agent"
updated: 2026-03-18
---

# personal-agent knowledge hub
`,
    );
    writeFile(
      memoryPath(profilesRoot, 'personal-agent-web-ui-preferences.md'),
      `---
id: personal-agent-web-ui-preferences
title: "Personal-agent web UI preferences"
summary: "Durable UX preferences for the web app."
type: "project"
status: "active"
area: personal-agent
role: "canonical"
parent: personal-agent
tags:
  - "personal-agent"
  - "web-ui"
  - "ux"
updated: 2026-03-18
---

# Personal-agent web UI preferences

- Keep the right rail visible and resizable.
- Memory management should reuse the page-shell/list/right-rail pattern.
`,
    );
    writeFile(
      memoryPath(profilesRoot, 'personal-agent-project-state-model.md'),
      `---
id: personal-agent-project-state-model
title: "Personal-agent project state model"
summary: "Project boundaries and state model."
type: "project"
status: "active"
area: personal-agent
role: "canonical"
parent: personal-agent
tags:
  - "personal-agent"
  - "projects"
  - "state"
updated: 2026-03-18
---

# Personal-agent project state model

- Keep planning state durable.
- Respect project boundaries.
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);

    const result = saveCuratedDistilledConversationMemory({
      memoryDir: join(profilesRoot, '_memory'),
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
    expect(result.memory.id).toBe('personal-agent-web-ui-preferences');

    const webUiContent = readFileSync(memoryPath(profilesRoot, 'personal-agent-web-ui-preferences.md'), 'utf-8');
    expect(webUiContent).toContain('## Distilled updates');
    expect(webUiContent).toContain('Memory browser and right rail polish');
    expect(webUiContent).toContain('page-shell/list/right-rail pattern');

    const stateModelContent = readFileSync(memoryPath(profilesRoot, 'personal-agent-project-state-model.md'), 'utf-8');
    expect(stateModelContent).not.toContain('Memory browser and right rail polish');
  });

  it('creates a capture attached to the matching hub when no canonical match is strong enough', () => {
    const profilesRoot = createTempDir('pa-conversation-memory-capture-');
    writeFile(
      memoryPath(profilesRoot, 'personal-agent.md'),
      `---
id: personal-agent
title: "personal-agent knowledge hub"
summary: "Hub doc."
type: "project"
status: "active"
area: personal-agent
role: "hub"
tags:
  - "personal-agent"
updated: 2026-03-18
---

# personal-agent knowledge hub
`,
    );
    writeFile(
      memoryPath(profilesRoot, 'personal-agent-web-ui-preferences.md'),
      `---
id: personal-agent-web-ui-preferences
title: "Personal-agent web UI preferences"
summary: "Durable UX preferences for the web app."
type: "project"
status: "active"
area: personal-agent
role: "canonical"
parent: personal-agent
tags:
  - "personal-agent"
  - "web-ui"
updated: 2026-03-18
---

# Personal-agent web UI preferences
`,
    );
    writeFile(
      memoryPath(profilesRoot, 'personal-agent-project-state-model.md'),
      `---
id: personal-agent-project-state-model
title: "Personal-agent project state model"
summary: "Project boundaries and state model."
type: "project"
status: "active"
area: personal-agent
role: "canonical"
parent: personal-agent
tags:
  - "personal-agent"
  - "projects"
updated: 2026-03-18
---

# Personal-agent project state model
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);

    const result = saveCuratedDistilledConversationMemory({
      memoryDir: join(profilesRoot, '_memory'),
      existingDocs: loaded.docs,
      draft: buildDraft({
        title: 'General personal-agent follow-up',
        summary: 'Loose follow-up that should stay a capture until curated.',
        body: '# General personal-agent follow-up\n\nLoose follow-up that should stay a capture until curated.\n',
        tags: ['conversation', 'checkpoint', 'personal-agent'],
        userIntent: 'capture a broad follow-up without picking a single canonical target.',
        learnedPoints: ['There are a few follow-ups to sort out later.'],
        carryForwardPoints: ['Curate this into a specific canonical doc later.'],
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

    expect(result.disposition).toBe('created-capture');
    expect(result.memory.role).toBe('capture');
    expect(result.memory.parent).toBe('personal-agent');
    expect(result.memory.id).toMatch(/^conv-general-personal-agent-follow-up-20260318/);

    const createdContent = readFileSync(result.memory.path, 'utf-8');
    expect(createdContent).toContain('role: capture');
    expect(createdContent).toContain('parent: personal-agent');
  });

  it('merges a capture doc into a canonical doc and deletes the capture file', () => {
    const profilesRoot = createTempDir('pa-conversation-memory-merge-');
    writeFile(
      memoryPath(profilesRoot, 'personal-agent-web-ui-preferences.md'),
      `---
id: personal-agent-web-ui-preferences
title: "Personal-agent web UI preferences"
summary: "Durable UX preferences for the web app."
type: "project"
status: "active"
area: personal-agent
role: "canonical"
parent: personal-agent
tags:
  - "personal-agent"
  - "web-ui"
updated: 2026-03-18
---

# Personal-agent web UI preferences

- Keep the right rail visible and resizable.
`,
    );
    writeFile(
      memoryPath(profilesRoot, 'conv-memory-browser-20260318.md'),
      `---
id: conv-memory-browser-20260318
title: "Memory browser polish capture"
summary: "Capture doc waiting to merge into a canonical memory."
type: "conversation-checkpoint"
status: "active"
area: personal-agent
role: "capture"
parent: personal-agent
related:
  - "personal-agent-web-ui-preferences"
tags:
  - "conversation"
  - "checkpoint"
  - "personal-agent"
  - "web-ui"
updated: 2026-03-18
origin: "conversation"
origin_title: "Memory browser polish"
source_cwd: "/Users/patrick/workingdir/personal-agent"
---

# Memory browser polish capture

Capture doc waiting to merge into a canonical memory.

At this checkpoint, the user intent was: tighten the memory browser around hubs and the right rail.

What the agent had learned by this point:
- Memory management should reuse the page-shell/list/right-rail pattern.

Key carry-forward points:
- Keep the right rail visible and resizable.
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);

    const captureDoc = loaded.docs.find((doc) => doc.id === 'conv-memory-browser-20260318');
    const canonicalDoc = loaded.docs.find((doc) => doc.id === 'personal-agent-web-ui-preferences');
    expect(captureDoc).toBeTruthy();
    expect(canonicalDoc).toBeTruthy();

    const result = mergeCaptureMemoryIntoCanonical({
      captureDoc: captureDoc!,
      targetDoc: canonicalDoc!,
      updated: '2026-03-19',
    });

    expect(result.memory.id).toBe('personal-agent-web-ui-preferences');
    expect(result.mergedMemoryId).toBe('conv-memory-browser-20260318');
    expect(readdirSync(join(profilesRoot, '_memory')).sort()).toEqual(['personal-agent-web-ui-preferences.md']);

    const canonicalContent = readFileSync(memoryPath(profilesRoot, 'personal-agent-web-ui-preferences.md'), 'utf-8');
    expect(canonicalContent).toContain('## Distilled updates');
    expect(canonicalContent).toContain('### 2026-03-19 — Memory browser polish capture');
    expect(canonicalContent).toContain('tighten the memory browser around hubs and the right rail');
    expect(canonicalContent).toContain('conversation "Memory browser polish"');
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryDoc, filterMemoryDocs, lintMemoryDocs, loadMemoryDocs, loadMemoryPackageReferences } from './memory-store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const vaultRoot = join(root, 'sync');
  mkdirSync(vaultRoot, { recursive: true });
  tempDirs.push(root);
  return vaultRoot;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function memoryPath(vaultRoot: string, memoryId: string): string {
  return join(vaultRoot, 'notes', memoryId, 'INDEX.md');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('memory store organization metadata', () => {
  it('parses note nodes from sync/notes and tracks package-local references', () => {
    const vaultRoot = createTempDir('personal-agent-memory-store-');

    writeFile(
      memoryPath(vaultRoot, 'personal-agent'),
      `---
id: personal-agent
kind: note
title: Personal-agent
summary: Hub doc.
description: Tell the agent to use this note for durable personal-agent architecture guidance.
status: active
links:
  related:
    - runpod
updatedAt: 2026-03-18
tags:
  - area:personal-agent
  - role:structure
  - noteType:project
  - status:active
  - type:note
---
# Personal-agent

Hub doc.
`,
    );

    writeFile(
      join(vaultRoot, 'notes', 'personal-agent', 'references', 'desktop-ui.md'),
      `---
name: desktop-ui
description: Durable UI notes.
metadata:
  title: Desktop UI preferences
  updated: 2026-03-18
---
# Desktop UI preferences

Keep the right rail visible and resizable.
`,
    );

    writeFile(
      join(vaultRoot, 'notes', 'personal-agent', 'references', 'state-model.md'),
      `# Project state model

Keep planning state durable.
`,
    );

    const loaded = loadMemoryDocs({ vaultRoot });
    expect(loaded.parseErrors).toHaveLength(0);
    expect(loaded.docs.map((doc) => doc.id)).toEqual(['personal-agent']);

    const hub = loaded.docs[0];
    expect(hub).toMatchObject({
      area: 'personal-agent',
      role: 'structure',
      related: ['runpod'],
      title: 'Personal-agent',
      summary: 'Hub doc.',
      description: 'Tell the agent to use this note for durable personal-agent architecture guidance.',
    });
    expect(hub?.referencePaths).toHaveLength(2);

    const references = loadMemoryPackageReferences(join(vaultRoot, 'notes', 'personal-agent'));
    expect(references.map((reference) => reference.title)).toEqual(['desktop-ui', 'Project state model']);
    expect(references[0]).toMatchObject({
      relativePath: 'references/desktop-ui.md',
      summary: 'Durable UI notes.',
    });

    const filtered = filterMemoryDocs(loaded.docs, {
      area: 'personal-agent',
      text: 'personal-agent',
    });
    expect(filtered.map((doc) => doc.id)).toEqual(['personal-agent']);
  });

  it('creates note nodes in sync/notes', () => {
    const vaultRoot = createTempDir('personal-agent-memory-create-');

    const created = createMemoryDoc(
      {
        id: 'memory-index',
        title: 'Memory index',
        summary: 'Top-level memory hub.',
        description: 'Tell the agent to use this as the top-level routing note for shared memory.',
        type: 'index',
        status: 'active',
        area: 'notes',
        role: 'hub',
        related: ['personal-agent'],
      },
      { vaultRoot },
    );

    expect(created).toMatchObject({
      id: 'memory-index',
      area: 'notes',
      role: 'structure',
      overwritten: false,
    });

    const fileContent = readFileSync(created.filePath, 'utf-8');
    expect(created.filePath).toBe(join(vaultRoot, 'notes', 'memory-index.md'));
    expect(fileContent).toContain('id: memory-index');
    expect(fileContent).toContain('type:note');
    expect(fileContent).toContain('summary: Top-level memory hub.');
    expect(fileContent).toContain('description: Tell the agent to use this as the top-level routing note for shared memory.');
    expect(fileContent).toContain('title: Memory index');
    expect(fileContent).toContain('area:notes');
    expect(fileContent).toContain('structure');
    expect(fileContent).toContain('links:');
    expect(fileContent).toContain('related:');
    expect(fileContent).toContain('- personal-agent');
  });

  it('ignores project child markdown when listing top-level notes', () => {
    const vaultRoot = createTempDir('personal-agent-memory-scope-');

    writeFile(
      join(vaultRoot, 'notes', 'top-level.md'),
      `---
id: top-level
title: Top-level note
summary: Canonical note.
status: active
updatedAt: 2026-03-31
tags:
  - noteType:note
  - status:active
  - type:note
---
# Top-level note
`,
    );

    writeFile(
      join(vaultRoot, 'projects', 'ship-it', 'project.md'),
      `---
id: ship-it
kind: project
title: Ship It
summary: Ship the feature.
status: active
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T01:00:00.000Z
---
# Ship It
`,
    );

    writeFile(
      join(vaultRoot, 'projects', 'ship-it', 'notes', 'scratch.md'),
      `---
id: ship-it-scratch
title: Scratch note
summary: Project-local scratch file.
status: active
updatedAt: 2026-03-31
tags:
  - noteType:note
  - status:active
  - type:note
---
# Scratch note
`,
    );

    const loaded = loadMemoryDocs({ vaultRoot });
    expect(loaded.docs.map((doc) => doc.id)).toEqual(['top-level']);
  });

  it('ignores legacy runtime notes outside the vault on load', () => {
    const vaultRoot = createTempDir('personal-agent-memory-runtime-');
    const runtimeNotePath = join(vaultRoot, '..', 'pi-agent-runtime', 'notes', 'desktop.md');

    writeFile(
      runtimeNotePath,
      `---
id: desktop
title: Desktop Notes
summary: Desktop box facts.
type: note
status: active
updatedAt: 2026-03-31
---
# Desktop Notes
`,
    );

    const loaded = loadMemoryDocs({ vaultRoot });
    expect(loaded.docs.map((doc) => doc.id)).not.toContain('desktop');
    expect(existsSync(runtimeNotePath)).toBe(true);
    expect(existsSync(join(vaultRoot, 'notes', 'desktop.md'))).toBe(false);
  });

  it('reports broken related references during lint', () => {
    const vaultRoot = createTempDir('personal-agent-memory-lint-');

    writeFile(
      memoryPath(vaultRoot, 'runpod'),
      `---
id: runpod
kind: note
title: Runpod
summary: Runpod hub.
status: active
links:
  related:
    - missing-hub
    - runpod
updatedAt: 2026-03-18
tags:
  - noteType:note
  - status:active
  - type:note
---
# Runpod

Broken related references.
`,
    );

    const result = lintMemoryDocs({ vaultRoot });
    expect(result.parseErrors).toEqual([]);
    expect(result.duplicateIds).toHaveLength(0);
    expect(result.referenceErrors).toEqual([
      expect.objectContaining({
        id: 'runpod',
        field: 'related',
        targetId: 'missing-hub',
      }),
      expect.objectContaining({
        id: 'runpod',
        field: 'related',
        targetId: 'runpod',
      }),
    ]);
  });
});

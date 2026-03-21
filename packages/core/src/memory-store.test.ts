import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryDoc,
  filterMemoryDocs,
  lintMemoryDocs,
  loadMemoryDocs,
  loadMemoryPackageReferences,
} from './memory-store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
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

function memoryPath(profilesRoot: string, memoryId: string): string {
  return join(profilesRoot, '..', 'memory', memoryId, 'MEMORY.md');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('memory store organization metadata', () => {
  it('parses skill-style memory packages and tracks package-local references', () => {
    const profilesRoot = createTempDir('personal-agent-memory-store-');

    writeFile(
      memoryPath(profilesRoot, 'personal-agent'),
      `---
name: personal-agent
description: Hub doc.
metadata:
  title: Personal-agent
  type: project
  status: active
  area: personal-agent
  role: hub
  related:
    - runpod
  tags:
    - personal-agent
  updated: 2026-03-18
---
# Personal-agent

Hub doc.
`,
    );

    writeFile(
      join(profilesRoot, '..', 'memory', 'personal-agent', 'references', 'web-ui.md'),
      `---
name: web-ui
description: Durable UI notes.
metadata:
  title: Web UI preferences
  tags:
    - personal-agent
    - web-ui
  updated: 2026-03-18
---
# Web UI preferences

Keep the right rail visible and resizable.
`,
    );

    writeFile(
      join(profilesRoot, '..', 'memory', 'personal-agent', 'references', 'state-model.md'),
      `# Project state model

Keep planning state durable.
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);
    expect(loaded.docs.map((doc) => doc.id)).toEqual(['personal-agent']);

    const hub = loaded.docs[0];
    expect(hub).toMatchObject({
      area: 'personal-agent',
      role: 'hub',
      related: ['runpod'],
      title: 'Personal-agent',
      summary: 'Hub doc.',
    });
    expect(hub?.referencePaths).toHaveLength(2);

    const references = loadMemoryPackageReferences(join(profilesRoot, '..', 'memory', 'personal-agent'));
    expect(references.map((reference) => reference.title)).toEqual(['Web UI preferences', 'Project state model']);
    expect(references[0]).toMatchObject({
      relativePath: 'references/web-ui.md',
      summary: 'Durable UI notes.',
    });

    const filtered = filterMemoryDocs(loaded.docs, {
      area: 'personal-agent',
      text: 'web-ui',
    });
    expect(filtered.map((doc) => doc.id)).toEqual(['personal-agent']);
  });

  it('creates memory packages with skill-style frontmatter', () => {
    const profilesRoot = createTempDir('personal-agent-memory-create-');

    const created = createMemoryDoc({
      id: 'memory-index',
      title: 'Memory index',
      summary: 'Top-level memory hub.',
      type: 'index',
      status: 'active',
      area: 'memory',
      role: 'hub',
      related: ['personal-agent'],
      tags: ['memory', 'index'],
    }, { profilesRoot });

    expect(created).toMatchObject({
      id: 'memory-index',
      area: 'memory',
      role: 'hub',
      related: ['personal-agent'],
      overwritten: false,
    });

    const fileContent = readFileSync(created.filePath, 'utf-8');
    expect(created.filePath).toBe(memoryPath(profilesRoot, 'memory-index'));
    expect(fileContent).toContain('name: memory-index');
    expect(fileContent).toContain('description: Top-level memory hub.');
    expect(fileContent).toContain('metadata:');
    expect(fileContent).toContain('title: Memory index');
    expect(fileContent).toContain('area: memory');
    expect(fileContent).toContain('role: hub');
    expect(fileContent).toContain('related:');
    expect(fileContent).toContain('- personal-agent');
  });

  it('reports broken related references during lint and rejects non-hub top-level packages', () => {
    const profilesRoot = createTempDir('personal-agent-memory-lint-');

    writeFile(
      memoryPath(profilesRoot, 'runpod'),
      `---
name: runpod
description: Runpod hub.
metadata:
  type: note
  status: active
  related:
    - missing-hub
    - runpod
  tags:
    - test
  updated: 2026-03-18
---
# Runpod

Broken related references.
`,
    );

    writeFile(
      memoryPath(profilesRoot, 'legacy-canonical'),
      `---
name: legacy-canonical
description: Invalid top-level canonical package.
metadata:
  role: canonical
  updated: 2026-03-18
---
# Invalid

Should fail.
`,
    );

    const result = lintMemoryDocs({ profilesRoot });
    expect(result.parseErrors).toEqual([
      expect.objectContaining({
        filePath: memoryPath(profilesRoot, 'legacy-canonical'),
      }),
    ]);
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

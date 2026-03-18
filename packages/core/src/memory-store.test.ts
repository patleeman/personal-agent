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
} from './memory-store.js';

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

describe('memory store organization metadata', () => {
  it('parses area, role, parent, and related fields and filters on them', () => {
    const profilesRoot = createTempDir('personal-agent-memory-store-');

    writeFile(
      join(profilesRoot, '_memory', 'personal-agent.md'),
      `---
id: personal-agent
title: Personal-agent
summary: Hub doc.
type: project
status: active
area: personal-agent
role: hub
related:
  - personal-agent-web-ui-preferences
tags: [personal-agent]
updated: 2026-03-18
---
# Personal-agent

Hub doc.
`,
    );

    writeFile(
      join(profilesRoot, '_memory', 'personal-agent-web-ui-preferences.md'),
      `---
id: personal-agent-web-ui-preferences
title: Web UI preferences
summary: Canonical UI notes.
type: project
status: active
area: personal-agent
role: canonical
parent: personal-agent
related:
  - personal-agent
tags: [personal-agent, web-ui]
updated: 2026-03-18
---
# Web UI preferences

Canonical UI notes.
`,
    );

    writeFile(
      join(profilesRoot, '_memory', 'conv-sidebar-polish-20260318.md'),
      `---
id: conv-sidebar-polish-20260318
title: Sidebar polish capture
summary: Capture doc.
type: conversation-checkpoint
status: active
area: personal-agent
role: capture
parent: personal-agent
related:
  - personal-agent-web-ui-preferences
tags: [personal-agent, web-ui]
updated: 2026-03-18
---
# Sidebar polish capture

Capture doc.
`,
    );

    const loaded = loadMemoryDocs({ profilesRoot });
    expect(loaded.parseErrors).toHaveLength(0);

    const hub = loaded.docs.find((doc) => doc.id === 'personal-agent');
    expect(hub).toMatchObject({
      area: 'personal-agent',
      role: 'hub',
      related: ['personal-agent-web-ui-preferences'],
    });

    const filtered = filterMemoryDocs(loaded.docs, {
      area: 'personal-agent',
      role: 'canonical',
      parent: 'personal-agent',
      text: 'web-ui',
    });

    expect(filtered.map((doc) => doc.id)).toEqual(['personal-agent-web-ui-preferences']);
  });

  it('creates templates with organization metadata', () => {
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
    expect(fileContent).toContain('area: memory');
    expect(fileContent).toContain('role: "hub"');
    expect(fileContent).toContain('related:');
    expect(fileContent).toContain('  - "personal-agent"');
  });

  it('reports broken parent and related references during lint', () => {
    const profilesRoot = createTempDir('personal-agent-memory-lint-');

    writeFile(
      join(profilesRoot, '_memory', 'orphan.md'),
      `---
id: orphan
title: Orphan
summary: Broken references.
type: note
status: active
parent: missing-parent
related:
  - orphan
tags: [test]
updated: 2026-03-18
---
# Orphan

Broken references.
`,
    );

    const result = lintMemoryDocs({ profilesRoot });
    expect(result.parseErrors).toHaveLength(0);
    expect(result.duplicateIds).toHaveLength(0);
    expect(result.referenceErrors).toEqual([
      expect.objectContaining({
        id: 'orphan',
        field: 'parent',
        targetId: 'missing-parent',
      }),
      expect.objectContaining({
        id: 'orphan',
        field: 'related',
        targetId: 'orphan',
      }),
    ]);
  });
});

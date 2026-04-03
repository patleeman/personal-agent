import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createUnifiedNode,
  deleteUnifiedNode,
  findUnifiedNodes,
  lintUnifiedNodes,
  listUnifiedSkillNodeDirs,
  loadUnifiedNodes,
  migrateLegacyNodes,
  tagUnifiedNode,
  updateUnifiedNode,
} from './nodes.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-nodes-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(dir, 'sync', '_profiles');
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('unified nodes', () => {
  it('creates, updates, tags, and deletes a node', () => {
    const stateRoot = createTempStateRoot();

    const created = createUnifiedNode({
      id: 'sample-node',
      title: 'Sample Node',
      summary: 'Sample node summary.',
      description: 'Agent guidance.',
      tags: ['type:note', 'profile:assistant', 'area:test'],
      parent: 'parent-node',
      related: ['sibling-node'],
      relationships: [{ type: 'depends-on', targetId: 'sibling-node' }],
    }, { profilesRoot: join(stateRoot, 'sync', 'profiles') });

    expect(created.node.kinds).toEqual(['note']);
    expect(created.node.links.parent).toBe('parent-node');
    expect(created.node.links.relationships).toEqual([{ type: 'depends-on', targetId: 'sibling-node' }]);
    expect(created.node.tags).toContain('parent:parent-node');
    expect(created.node.tags).toContain('status:active');

    const updated = updateUnifiedNode({
      id: 'sample-node',
      title: 'Renamed Node',
      addTags: ['team:platform'],
      removeTags: ['area:test'],
      body: '# Renamed Node\n\nUpdated body.',
    }, { profilesRoot: join(stateRoot, 'sync', 'profiles') });

    expect(updated.title).toBe('Renamed Node');
    expect(updated.tags).toContain('team:platform');
    expect(updated.tags).not.toContain('area:test');

    const retagged = tagUnifiedNode({
      id: 'sample-node',
      add: ['lang:typescript'],
      remove: ['team:platform'],
    }, { profilesRoot: join(stateRoot, 'sync', 'profiles') });

    expect(retagged.tags).toContain('lang:typescript');
    expect(retagged.tags).not.toContain('team:platform');

    const loaded = loadUnifiedNodes({ profilesRoot: join(stateRoot, 'sync', 'profiles') });
    expect(loaded.nodes).toHaveLength(1);
    expect(findUnifiedNodes(loaded.nodes, 'type:note AND profile:assistant')).toHaveLength(1);
    expect(findUnifiedNodes(loaded.nodes, 'parent:parent-node')).toHaveLength(1);
    expect(findUnifiedNodes(loaded.nodes, 'depends-on AND sibling-node')).toHaveLength(1);

    expect(deleteUnifiedNode('sample-node', { profilesRoot: join(stateRoot, 'sync', 'profiles') })).toEqual({ ok: true, id: 'sample-node' });
    expect(loadUnifiedNodes({ profilesRoot: join(stateRoot, 'sync', 'profiles') }).nodes).toHaveLength(0);
  });

  it('loads notes, skills, and projects from the canonical vault layout', () => {
    const stateRoot = createTempStateRoot();
    const profilesRoot = join(stateRoot, 'sync', '_profiles');

    writeFile(join(stateRoot, 'sync', 'notes', 'desktop.md'), `---
id: desktop
kind: note
title: Desktop Notes
summary: Ubuntu workstation details.
status: active
metadata:
  type: reference
  area: compute
links:
  parent: infrastructure
---

# Desktop

Ubuntu workstation details.
`);

    writeFile(join(stateRoot, 'sync', '_skills', 'agent-browser', 'SKILL.md'), `---
name: agent-browser
description: Automate browsers.
profiles:
  - assistant
---

# agent-browser

Use the browser automation helper.
`);

    writeFile(join(stateRoot, 'sync', 'projects', 'ship-it', 'project.md'), `---
id: ship-it
kind: project
title: Ship It
summary: Ship the feature.
status: active
ownerProfile: assistant
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T01:00:00.000Z
---

# Ship It

Ship the feature.
`);
    writeFile(join(stateRoot, 'sync', 'projects', 'ship-it', 'state.yaml'), `id: ship-it
ownerProfile: assistant
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T01:00:00.000Z
title: Ship It
description: Ship the feature.
summary: Ship the feature.
requirements:
  goal: Launch the feature
  acceptanceCriteria:
    - It ships
status: active
blockers: []
currentFocus: Finish implementation
recentProgress:
  - Scoped the work
planSummary: Two phases
completionSummary: null
plan:
  milestones:
    - id: phase-1
      title: Phase 1
      status: pending
      summary: Build it
  tasks:
    - id: build-it
      title: Build it
      status: pending
`);
    writeFile(join(stateRoot, 'sync', 'projects', 'ship-it', 'notes', 'scratch.md'), `---
id: ship-it-scratch
kind: note
title: Scratch
summary: Project-local scratch note.
status: active
---

# Scratch
`);

    const migration = migrateLegacyNodes({ profilesRoot });
    expect(migration.created).toEqual([]);
    expect(migration.updated).toEqual([]);
    expect(migration.conflicts).toEqual([]);

    const loaded = loadUnifiedNodes({ profilesRoot });
    expect(loaded.nodes.map((node) => node.id)).toEqual(['agent-browser', 'desktop', 'ship-it']);
    expect(findUnifiedNodes(loaded.nodes, 'type:skill AND profile:assistant').map((node) => node.id)).toEqual(['agent-browser']);
    expect(findUnifiedNodes(loaded.nodes, 'parent:infrastructure').map((node) => node.id)).toEqual(['desktop']);
    expect(findUnifiedNodes(loaded.nodes, 'type:project AND cwd:*').map((node) => node.id)).toEqual([]);

    const projectNode = loaded.nodes.find((node) => node.id === 'ship-it');
    expect(projectNode?.body).toContain('# Ship It');
    expect(projectNode?.body).toContain('Ship the feature.');

    const skillDirs = listUnifiedSkillNodeDirs('assistant', { profilesRoot });
    expect(skillDirs).toEqual([join(stateRoot, 'sync', '_skills', 'agent-browser')]);
  });

  it('reports duplicate ids across notes and projects and lints references', () => {
    const stateRoot = createTempStateRoot();
    const profilesRoot = join(stateRoot, 'sync', '_profiles');

    writeFile(join(stateRoot, 'sync', 'notes', 'shared-topic.md'), `---
id: shared-topic
kind: note
title: Shared Topic
summary: Shared note summary.
status: active
links:
  related:
    - missing-node
---

# Shared Topic

Note body.
`);

    writeFile(join(stateRoot, 'sync', 'projects', 'shared-topic', 'project.md'), `---
id: shared-topic
kind: project
title: Shared Topic
summary: Shared project summary.
status: active
ownerProfile: assistant
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T01:00:00.000Z
---

# Shared Topic

Project body.
`);
    writeFile(join(stateRoot, 'sync', 'projects', 'shared-topic', 'state.yaml'), `id: shared-topic
ownerProfile: assistant
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T01:00:00.000Z
title: Shared Topic
description: Shared project summary.
summary: Shared project summary.
requirements:
  goal: Ship it
  acceptanceCriteria: []
status: active
blockers: []
recentProgress: []
plan:
  milestones: []
  tasks: []
`);

    const migration = migrateLegacyNodes({ profilesRoot });
    expect(migration.created).toEqual([]);
    expect(migration.updated).toEqual([]);
    expect(migration.conflicts).toEqual([]);

    const loaded = loadUnifiedNodes({ profilesRoot });
    expect(loaded.nodes).toHaveLength(2);
    expect(loaded.nodes.map((node) => node.id)).toEqual(['shared-topic', 'shared-topic']);

    const lint = lintUnifiedNodes({ profilesRoot });
    expect(lint.duplicateIds).toEqual([
      expect.objectContaining({ id: 'shared-topic' }),
    ]);
    expect(lint.referenceErrors).toEqual([
      expect.objectContaining({ id: 'shared-topic', field: 'related', targetId: 'missing-node' }),
    ]);
  });

  it('parses typed relationships from frontmatter objects', () => {
    const stateRoot = createTempStateRoot();
    const profilesRoot = join(stateRoot, 'sync', '_profiles');

    writeFile(join(stateRoot, 'sync', 'notes', 'graph-node.md'), `---
id: graph-node
title: Graph Node
summary: Node with explicit relationships.
status: active
tags:
  - type:note
links:
  relationships:
    - type: depends-on
      target: upstream-node
    - type: implements
      target: downstream-node
---

# Graph Node

Tracks graph relationships.
`);

    const loaded = loadUnifiedNodes({ profilesRoot });
    expect(loaded.nodes[0]?.links.relationships).toEqual([
      { type: 'depends-on', targetId: 'upstream-node' },
      { type: 'implements', targetId: 'downstream-node' },
    ]);
    expect(loaded.nodes[0]?.links.related).toEqual(['upstream-node', 'downstream-node']);
  });
});

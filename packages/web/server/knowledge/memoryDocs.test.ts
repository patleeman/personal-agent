import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearMemoryBrowserCaches,
  createMemoryDoc,
  listMemoryDocs,
} from './memoryDocs.js';

const originalEnv = process.env;
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

beforeEach(() => {
  const stateRoot = createTempDir('pa-web-memory-docs-');
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
    PERSONAL_AGENT_PROFILES_ROOT: join(stateRoot, 'sync', 'profiles'),
  };
  clearMemoryBrowserCaches();
});

afterEach(async () => {
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

  it('creates note nodes in sync/notes packages', () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;

    const created = createMemoryDoc({
      id: 'quick-note',
      title: 'Quick Note',
      summary: 'Captured thought.',
      description: 'Scratch note.',
      status: 'active',
    });

    expect(created.filePath).toBe(notePath(stateRoot, 'quick-note'));
    const content = readFileSync(notePath(stateRoot, 'quick-note'), 'utf-8');
    expect(content).toContain('id: quick-note');
    expect(content).toContain('title: Quick Note');
    expect(content).toContain('summary: Captured thought.');
    expect(content).toContain('# Quick Note');
  });
});

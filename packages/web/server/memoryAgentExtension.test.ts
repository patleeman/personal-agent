import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryAgentExtension } from './memoryAgentExtension.js';

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

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-web-memory-state-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function registerMemoryTool() {
  let registeredTool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> }
    | undefined;

  createMemoryAgentExtension()({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Memory tool was not registered.');
  }

  return registeredTool;
}

function createToolContext() {
  return {
    cwd: '/tmp/workspace',
    hasUI: false,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => '',
    modelRegistry: {},
    model: undefined,
    sessionManager: {
      getSessionId: () => 'conv-123',
    },
    ui: {},
  };
}

function memoryPath(memoryName: string): string {
  return join(process.env.PERSONAL_AGENT_STATE_ROOT as string, 'profiles', '_memory', memoryName, 'MEMORY.md');
}

describe('memory agent extension', () => {
  it('lists, finds, and shows memory packages', async () => {
    const memoryTool = registerMemoryTool();

    writeFile(
      memoryPath('runpod'),
      `---
name: runpod
description: Provisioning notes for short-lived GPU pods.
metadata:
  title: Runpod Notes
  type: project
  status: active
  tags:
    - gpu
    - infra
  updated: 2026-03-08
---
# Runpod

Runpod operational notes.
`,
    );
    writeFile(
      memoryPath('desktop'),
      `---
name: desktop
description: Local Ubuntu GPU workstation details.
metadata:
  title: Desktop Machine Notes
  type: reference
  status: archived
  tags:
    - gpu
    - desktop
  updated: 2026-03-09
---
# Desktop

Desktop operational notes.
`,
    );

    const listResult = await memoryTool.execute('tool-1', { action: 'list' }, undefined, undefined, createToolContext());
    expect(listResult.isError).not.toBe(true);
    expect(listResult.content[0]?.text).toContain('@runpod');
    expect(listResult.content[0]?.text).toContain('@desktop');

    const findResult = await memoryTool.execute('tool-2', {
      action: 'find',
      tags: ['gpu'],
      type: 'reference',
      status: 'archived',
      text: 'ubuntu',
    }, undefined, undefined, createToolContext());
    expect(findResult.isError).not.toBe(true);
    expect(findResult.content[0]?.text).toContain('@desktop');
    expect(findResult.content[0]?.text).not.toContain('@runpod');

    const showResult = await memoryTool.execute('tool-3', {
      action: 'show',
      memoryId: 'runpod',
    }, undefined, undefined, createToolContext());
    expect(showResult.isError).not.toBe(true);
    expect(showResult.content[0]?.text).toContain('Memory package @runpod');
    expect(showResult.content[0]?.text).toContain('Runpod operational notes.');
  });

  it('creates new memory packages and requires force to overwrite', async () => {
    const memoryTool = registerMemoryTool();

    const created = await memoryTool.execute('tool-1', {
      action: 'new',
      memoryId: 'quick-note',
      title: 'Quick Note',
      summary: 'Tracks one-off details.',
      tags: ['notes', 'personal'],
      type: 'note',
      status: 'active',
    }, undefined, undefined, createToolContext());

    expect(created.isError).not.toBe(true);
    expect(created.content[0]?.text).toContain('Created memory package @quick-note');
    expect(readFileSync(memoryPath('quick-note'), 'utf-8')).toContain('name: quick-note');
    expect(readFileSync(memoryPath('quick-note'), 'utf-8')).toContain('description: Tracks one-off details.');

    const duplicate = await memoryTool.execute('tool-2', {
      action: 'new',
      memoryId: 'quick-note',
      title: 'Updated Note',
      summary: 'Updated summary.',
      tags: ['notes'],
    }, undefined, undefined, createToolContext());

    expect(duplicate.isError).toBe(true);
    expect(duplicate.content[0]?.text).toContain('Memory package already exists');

    const updated = await memoryTool.execute('tool-3', {
      action: 'new',
      memoryId: 'quick-note',
      title: 'Updated Note',
      summary: 'Updated summary.',
      tags: ['notes'],
      force: true,
    }, undefined, undefined, createToolContext());

    expect(updated.isError).not.toBe(true);
    expect(updated.content[0]?.text).toContain('Updated memory package @quick-note');
    expect(readFileSync(memoryPath('quick-note'), 'utf-8')).toContain('title: Updated Note');
  });

  it('reports lint issues without treating lint as a tool failure', async () => {
    const memoryTool = registerMemoryTool();

    writeFile(
      memoryPath('runpod'),
      `---
name: runpod
description: Provisioning notes for short-lived GPU pods.
metadata:
  title: Runpod Notes
  type: project
  status: active
  tags:
    - gpu
    - infra
  updated: 2026-03-08
---
# Runpod

Runpod operational notes.
`,
    );
    writeFile(
      memoryPath('orphan'),
      `---
name: orphan
description: Broken parent reference.
metadata:
  title: Orphan
  type: note
  status: active
  parent: missing-parent
  tags:
    - test
  updated: 2026-03-08
---
# Orphan

Broken parent reference.
`,
    );
    writeFile(memoryPath('invalid'), '# Missing frontmatter\n');

    const lintResult = await memoryTool.execute('tool-1', { action: 'lint' }, undefined, undefined, createToolContext());
    expect(lintResult.isError).not.toBe(true);
    expect(lintResult.content[0]?.text).toContain('Parse errors:');
    expect(lintResult.content[0]?.text).not.toContain('Duplicate ids:');
    expect(lintResult.content[0]?.text).toContain('orphan');
    expect(lintResult.details).toMatchObject({ hasIssues: true, duplicateCount: 0, parseErrorCount: 2 });
  });
});

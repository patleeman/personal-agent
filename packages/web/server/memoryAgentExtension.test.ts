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

function memoryPath(fileName: string): string {
  return join(process.env.PERSONAL_AGENT_STATE_ROOT as string, 'profiles', '_memory', fileName);
}

describe('memory agent extension', () => {
  it('lists, finds, and shows memory docs', async () => {
    const memoryTool = registerMemoryTool();

    writeFile(
      memoryPath('runpod.md'),
      `---
id: runpod
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
type: project
status: active
tags: [gpu, infra]
updated: 2026-03-08
---
Runpod operational notes.
`,
    );
    writeFile(
      memoryPath('desktop.md'),
      `---
id: desktop
title: Desktop Machine Notes
summary: Local Ubuntu GPU workstation details.
type: reference
status: archived
tags: [gpu, desktop]
updated: 2026-03-09
---
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
    expect(showResult.content[0]?.text).toContain('Memory doc @runpod');
    expect(showResult.content[0]?.text).toContain('Runpod operational notes.');
  });

  it('creates new memory docs and requires force to overwrite', async () => {
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
    expect(created.content[0]?.text).toContain('Created memory @quick-note');
    expect(readFileSync(memoryPath('quick-note.md'), 'utf-8')).toContain('title: "Quick Note"');

    const duplicate = await memoryTool.execute('tool-2', {
      action: 'new',
      memoryId: 'quick-note',
      title: 'Updated Note',
      summary: 'Updated summary.',
      tags: ['notes'],
    }, undefined, undefined, createToolContext());

    expect(duplicate.isError).toBe(true);
    expect(duplicate.content[0]?.text).toContain('Memory doc already exists');

    const updated = await memoryTool.execute('tool-3', {
      action: 'new',
      memoryId: 'quick-note',
      title: 'Updated Note',
      summary: 'Updated summary.',
      tags: ['notes'],
      force: true,
    }, undefined, undefined, createToolContext());

    expect(updated.isError).not.toBe(true);
    expect(updated.content[0]?.text).toContain('Updated memory @quick-note');
    expect(readFileSync(memoryPath('quick-note.md'), 'utf-8')).toContain('title: "Updated Note"');
  });

  it('reports lint issues without treating lint as a tool failure', async () => {
    const memoryTool = registerMemoryTool();

    writeFile(
      memoryPath('runpod.md'),
      `---
id: runpod
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
type: project
status: active
tags: [gpu, infra]
updated: 2026-03-08
---
Runpod operational notes.
`,
    );
    writeFile(
      memoryPath('duplicate.md'),
      `---
id: runpod
title: Duplicate id
summary: Duplicate id test.
type: note
status: active
tags: [test]
updated: 2026-03-08
---
Duplicate memory doc.
`,
    );
    writeFile(memoryPath('invalid.md'), '# Missing frontmatter\n');

    const lintResult = await memoryTool.execute('tool-1', { action: 'lint' }, undefined, undefined, createToolContext());
    expect(lintResult.isError).not.toBe(true);
    expect(lintResult.content[0]?.text).toContain('Parse errors:');
    expect(lintResult.content[0]?.text).toContain('Duplicate ids:');
    expect(lintResult.content[0]?.text).toContain('runpod');
    expect(lintResult.details).toMatchObject({ hasIssues: true, duplicateCount: 1, parseErrorCount: 1 });
  });
});

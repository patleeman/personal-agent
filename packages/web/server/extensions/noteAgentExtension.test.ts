import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNoteAgentExtension } from './noteAgentExtension.js';

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
  const stateRoot = createTempDir('pa-web-note-state-');
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
    PERSONAL_AGENT_PROFILES_ROOT: join(stateRoot, 'sync', 'profiles'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function registerNoteTool() {
  let registeredTool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> }
    | undefined;

  createNoteAgentExtension()({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Note tool was not registered.');
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

function notePath(noteId: string): string {
  return join(process.env.PERSONAL_AGENT_STATE_ROOT as string, 'sync', 'nodes', noteId, 'INDEX.md');
}

describe('note agent extension', () => {
  it('lists, finds, and shows note nodes', async () => {
    const noteTool = registerNoteTool();

    writeFile(
      notePath('runpod'),
      `---
id: runpod
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
status: active
updatedAt: 2026-03-08
tags:
  - noteType:project
  - status:active
  - type:note
---
# Runpod

Runpod operational notes.
`,
    );
    writeFile(
      notePath('desktop'),
      `---
id: desktop
title: Desktop Machine Notes
summary: Local Ubuntu GPU workstation details.
status: archived
updatedAt: 2026-03-09
tags:
  - noteType:reference
  - status:archived
  - type:note
---
# Desktop

Desktop operational notes.
`,
    );

    const listResult = await noteTool.execute('tool-1', { action: 'list' }, undefined, undefined, createToolContext());
    expect(listResult.isError).not.toBe(true);
    expect(listResult.content[0]?.text).toContain('@runpod');
    expect(listResult.content[0]?.text).toContain('@desktop');

    const findResult = await noteTool.execute('tool-2', {
      action: 'find',
      tags: ['gpu'],
      type: 'reference',
      status: 'archived',
      text: 'ubuntu',
    }, undefined, undefined, createToolContext());
    expect(findResult.isError).not.toBe(true);
    expect(findResult.content[0]?.text).toContain('@desktop');
    expect(findResult.content[0]?.text).not.toContain('@runpod');

    const showResult = await noteTool.execute('tool-3', {
      action: 'show',
      noteId: 'runpod',
    }, undefined, undefined, createToolContext());
    expect(showResult.isError).not.toBe(true);
    expect(showResult.content[0]?.text).toContain('Note page @runpod');
    expect(showResult.content[0]?.text).toContain('Runpod operational notes.');
  });

  it('creates new note nodes and requires force to overwrite', async () => {
    const noteTool = registerNoteTool();

    const created = await noteTool.execute('tool-1', {
      action: 'new',
      noteId: 'quick-note',
      title: 'Quick Note',
      summary: 'Tracks one-off details.',
      tags: ['notes', 'personal'],
      type: 'note',
      status: 'active',
    }, undefined, undefined, createToolContext());

    expect(created.isError).not.toBe(true);
    expect(created.content[0]?.text).toContain('Created note page @quick-note');
    expect(readFileSync(notePath('quick-note'), 'utf-8')).toContain('id: quick-note');
    expect(readFileSync(notePath('quick-note'), 'utf-8')).toContain('summary: Tracks one-off details.');

    const duplicate = await noteTool.execute('tool-2', {
      action: 'new',
      noteId: 'quick-note',
      title: 'Updated Note',
      summary: 'Updated summary.',
      tags: ['notes'],
    }, undefined, undefined, createToolContext());

    expect(duplicate.isError).toBe(true);
    expect(duplicate.content[0]?.text).toContain('already exists');

    const updated = await noteTool.execute('tool-3', {
      action: 'new',
      noteId: 'quick-note',
      title: 'Updated Note',
      summary: 'Updated summary.',
      tags: ['notes'],
      force: true,
    }, undefined, undefined, createToolContext());

    expect(updated.isError).not.toBe(true);
    expect(updated.content[0]?.text).toContain('Updated note page @quick-note');
    expect(readFileSync(notePath('quick-note'), 'utf-8')).toContain('title: Updated Note');
  });

  it('reports lint issues without treating lint as a tool failure', async () => {
    const noteTool = registerNoteTool();

    writeFile(
      notePath('runpod'),
      `---
id: runpod
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
status: active
updatedAt: 2026-03-08
tags:
  - noteType:project
  - status:active
  - type:note
---
# Runpod

Runpod operational notes.
`,
    );
    writeFile(
      notePath('orphan'),
      `---
id: orphan
title: Orphan
summary: Broken parent reference.
status: active
updatedAt: 2026-03-08
tags:
  - noteType:note
  - status:active
  - type:note
links:
  parent: missing-parent
---
# Orphan

Broken parent reference.
`,
    );
    writeFile(notePath('invalid'), '# Missing frontmatter\n');

    const lintResult = await noteTool.execute('tool-1', { action: 'lint' }, undefined, undefined, createToolContext());
    expect(lintResult.isError).not.toBe(true);
    expect(lintResult.content[0]?.text).toContain('Parse errors:');
    expect(lintResult.content[0]?.text).not.toContain('Duplicate ids:');
    expect(lintResult.content[0]?.text).toContain('orphan');
    expect(lintResult.details).toMatchObject({ hasIssues: true, duplicateCount: 0, parseErrorCount: 1 });
  });
});

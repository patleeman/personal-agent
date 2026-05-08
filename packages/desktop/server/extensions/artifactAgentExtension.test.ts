import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getConversationArtifact, listConversationArtifacts } from '@personal-agent/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createArtifactAgentExtension } from './artifactAgentExtension.js';

const tempDirs: string[] = [];

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-artifact-tool-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function registerArtifactTool(repoRoot: string, stateRoot: string) {
  let registeredTool:
    | {
        execute: (
          ...args: unknown[]
        ) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
        promptGuidelines?: string[];
      }
    | undefined;

  createArtifactAgentExtension({
    stateRoot,
    repoRoot,
    getCurrentProfile: () => 'datadog',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as {
        execute: (
          ...args: unknown[]
        ) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
        promptGuidelines?: string[];
      };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Artifact tool was not registered.');
  }

  return registeredTool;
}

function createToolContext(conversationId = 'conv-123') {
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
      getSessionId: () => conversationId,
    },
    ui: {},
  };
}

describe('artifact agent extension', () => {
  it('advertises the Artifacts extension skill and white-paper reference for html artifacts', () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    const artifactTool = registerArtifactTool(repoRoot, stateRoot);
    const guidelines = artifactTool.promptGuidelines?.join('\n') ?? '';

    expect(guidelines).toContain('Artifacts extension skill');
    expect(guidelines).toContain('extensions/system-artifacts/skills/artifacts/SKILL.md');
    expect(guidelines).toContain('extensions/system-artifacts/skills/artifacts/references/white-paper.md');
    expect(guidelines).toContain('single-column reading layout');
  });

  it('saves and updates conversation artifacts', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    const artifactTool = registerArtifactTool(repoRoot, stateRoot);
    const ctx = createToolContext();

    const created = await artifactTool.execute(
      'tool-1',
      {
        action: 'save',
        kind: 'html',
        title: 'Counter demo',
        content: '<button>Count</button>',
      },
      undefined,
      undefined,
      ctx,
    );

    expect(created.content[0]?.text).toContain('Saved artifact counter-demo');
    expect(created.details).toMatchObject({
      action: 'save',
      conversationId: 'conv-123',
      artifactId: 'counter-demo',
      kind: 'html',
      revision: 1,
      openRequested: true,
    });

    const updated = await artifactTool.execute(
      'tool-2',
      {
        action: 'save',
        artifactId: 'counter-demo',
        kind: 'html',
        title: 'Counter demo v2',
        content: '<button>Count twice</button>',
        open: false,
      },
      undefined,
      undefined,
      ctx,
    );

    expect(updated.content[0]?.text).toContain('Updated artifact counter-demo');
    expect(updated.details).toMatchObject({
      artifactId: 'counter-demo',
      revision: 2,
      openRequested: false,
    });

    expect(
      getConversationArtifact({
        stateRoot,
        profile: 'datadog',
        conversationId: 'conv-123',
        artifactId: 'counter-demo',
      }),
    ).toMatchObject({
      title: 'Counter demo v2',
      revision: 2,
      content: '<button>Count twice</button>',
    });
  });

  it('lists, reads, and deletes artifacts', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    const artifactTool = registerArtifactTool(repoRoot, stateRoot);
    const ctx = createToolContext();

    await artifactTool.execute(
      'tool-1',
      {
        action: 'save',
        artifactId: 'diagram',
        kind: 'mermaid',
        title: 'Retry diagram',
        content: 'flowchart TD\nA-->B',
      },
      undefined,
      undefined,
      ctx,
    );

    const list = await artifactTool.execute('tool-2', { action: 'list' }, undefined, undefined, ctx);
    expect(list.content[0]?.text).toContain('diagram [mermaid] Retry diagram');

    const get = await artifactTool.execute('tool-3', { action: 'get', artifactId: 'diagram' }, undefined, undefined, ctx);
    expect(get.content[0]?.text).toContain('Artifact diagram');
    expect(get.content[0]?.text).toContain('flowchart TD');

    const deleted = await artifactTool.execute('tool-4', { action: 'delete', artifactId: 'diagram' }, undefined, undefined, ctx);
    expect(deleted.content[0]?.text).toContain('Deleted artifact diagram.');
    expect(listConversationArtifacts({ stateRoot, profile: 'datadog', conversationId: 'conv-123' })).toEqual([]);
  });

  it('preserves full latex documents as raw artifact source', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    const artifactTool = registerArtifactTool(repoRoot, stateRoot);
    const ctx = createToolContext();
    const latexDocument = String.raw`\documentclass{article}
\begin{document}
\section{Overview}
Hello world.
\end{document}`;

    await artifactTool.execute(
      'tool-1',
      {
        action: 'save',
        artifactId: 'report',
        kind: 'latex',
        title: 'Walkthrough report',
        content: latexDocument,
      },
      undefined,
      undefined,
      ctx,
    );

    expect(
      getConversationArtifact({
        stateRoot,
        profile: 'datadog',
        conversationId: 'conv-123',
        artifactId: 'report',
      }),
    ).toMatchObject({
      kind: 'latex',
      title: 'Walkthrough report',
      content: latexDocument,
    });
  });
});

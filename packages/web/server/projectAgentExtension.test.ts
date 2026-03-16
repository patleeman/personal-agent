import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectScaffold, getConversationProjectLink } from '@personal-agent/core';
import { createProjectAgentExtension } from './projectAgentExtension.js';

const tempDirs: string[] = [];

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-project-tool-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.PERSONAL_AGENT_STATE_ROOT;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function registerProjectTool(repoRoot: string, stateRoot: string) {
  let registeredTool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }> }
    | undefined;

  createProjectAgentExtension({
    repoRoot,
    stateRoot,
    getCurrentProfile: () => 'datadog',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }> };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Project tool was not registered.');
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

describe('project agent extension', () => {
  it('references and unreferences a project in the current conversation', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const projectTool = registerProjectTool(repoRoot, stateRoot);

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Artifact model',
      description: 'Build the artifact model.',
    });

    const referenceResult = await projectTool.execute(
      'tool-1',
      {
        action: 'reference',
        projectId: 'artifact-model',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(referenceResult.isError).not.toBe(true);
    expect(referenceResult.content[0]?.text).toContain('Referenced @artifact-model');

    let link = getConversationProjectLink({ stateRoot, profile: 'datadog', conversationId: 'conv-123' });
    expect(link?.relatedProjectIds).toEqual(['artifact-model']);

    const unreferenceResult = await projectTool.execute(
      'tool-2',
      {
        action: 'unreference',
        projectId: 'artifact-model',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(unreferenceResult.isError).not.toBe(true);
    expect(unreferenceResult.content[0]?.text).toContain('Stopped referencing @artifact-model');

    link = getConversationProjectLink({ stateRoot, profile: 'datadog', conversationId: 'conv-123' });
    expect(link?.relatedProjectIds ?? []).toEqual([]);
  });

  it('creates, lists, gets, and updates projects', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    const projectTool = registerProjectTool(repoRoot, stateRoot);

    const created = await projectTool.execute(
      'tool-1',
      {
        action: 'create',
        title: 'Artifact model',
        description: 'Build the artifact model.',
        summary: 'Initial scaffold',
        status: 'in_progress',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(created.isError).not.toBe(true);
    expect(created.content[0]?.text).toContain('Created project @artifact-model');

    const listed = await projectTool.execute(
      'tool-2',
      { action: 'list' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(listed.content[0]?.text).toContain('@artifact-model');

    const fetched = await projectTool.execute(
      'tool-3',
      { action: 'get', projectId: 'artifact-model' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(fetched.content[0]?.text).toContain('Project @artifact-model');
    expect(fetched.content[0]?.text).toContain('summary: Initial scaffold');

    const updated = await projectTool.execute(
      'tool-4',
      {
        action: 'update',
        projectId: 'artifact-model',
        summary: 'Schema settled',
        currentFocus: 'Implement structured tools.',
      },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(updated.isError).not.toBe(true);

    const fetchedAfterUpdate = await projectTool.execute(
      'tool-5',
      { action: 'get', projectId: 'artifact-model' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(fetchedAfterUpdate.content[0]?.text).toContain('summary: Schema settled');
    expect(fetchedAfterUpdate.content[0]?.text).toContain('currentFocus: Implement structured tools.');

    const archived = await projectTool.execute(
      'tool-6',
      { action: 'archive', projectId: 'artifact-model' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(archived.isError).not.toBe(true);
    expect(archived.content[0]?.text).toContain('Archived project @artifact-model');

    const fetchedArchived = await projectTool.execute(
      'tool-7',
      { action: 'get', projectId: 'artifact-model' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(fetchedArchived.content[0]?.text).toContain('archivedAt:');

    const restored = await projectTool.execute(
      'tool-8',
      { action: 'unarchive', projectId: 'artifact-model' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(restored.isError).not.toBe(true);
    expect(restored.content[0]?.text).toContain('Restored project @artifact-model');
  });

  it('returns an error when referencing a missing project', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    const projectTool = registerProjectTool(repoRoot, stateRoot);

    const result = await projectTool.execute(
      'tool-1',
      {
        action: 'reference',
        projectId: 'missing-project',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Project not found: missing-project');
  });
});

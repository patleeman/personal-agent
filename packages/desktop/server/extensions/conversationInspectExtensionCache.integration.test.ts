import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadExtensionAgentFactory, reloadExtensionBackend } from './extensionBackend.js';

type RegisteredTool = {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content?: Array<{ text?: string }>; details?: Record<string, unknown> }>;
};

const previousRepoRoot = process.env.PERSONAL_AGENT_REPO_ROOT;
const previousStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeWorker(path: string, source: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, source);
}

function restoreEnv(name: 'PERSONAL_AGENT_REPO_ROOT' | 'PERSONAL_AGENT_STATE_ROOT', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv('PERSONAL_AGENT_REPO_ROOT', previousRepoRoot);
  restoreEnv('PERSONAL_AGENT_STATE_ROOT', previousStateRoot);

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('conversation inspect extension cache integration', () => {
  it('loads the cached extension backend but spawns the bundled repo worker, not an extension-cache sibling', async () => {
    const stateRoot = makeTempRoot('pa-conversation-inspect-cache-state-');
    const workerRepoRoot = makeTempRoot('pa-conversation-inspect-worker-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_REPO_ROOT = process.cwd();

    const reload = await reloadExtensionBackend('system-conversation-tools');
    expect(reload.rebuilt).toBe(true);
    const factory = await loadExtensionAgentFactory('system-conversation-tools', 'createConversationToolsAgentExtension');

    const brokenCachedWorkerPath = join(stateRoot, 'extension-cache/conversations/conversationInspectWorker.js');
    writeWorker(
      brokenCachedWorkerPath,
      `import { parentPort } from 'node:worker_threads'; parentPort?.postMessage({ id: 1, ok: false, error: 'used cached worker' });`,
    );

    const bundledWorkerPath = join(workerRepoRoot, 'packages/desktop/server/dist/conversations/conversationInspectWorker.js');
    writeWorker(
      bundledWorkerPath,
      `import { parentPort } from 'node:worker_threads'; parentPort?.on('message', (request) => parentPort.postMessage({ id: request.id, ok: true, action: request.action, result: { source: 'repo-worker' }, text: 'repo worker text' }));`,
    );
    process.env.PERSONAL_AGENT_REPO_ROOT = workerRepoRoot;

    const tools: RegisteredTool[] = [];
    factory({
      registerTool: (tool: RegisteredTool) => {
        tools.push(tool);
      },
    } as never);

    const tool = tools.find((candidate) => candidate.name === 'conversation_inspect');
    expect(tool, 'conversation_inspect tool was not registered').toBeTruthy();

    const result = await tool!.execute('tool-call-1', { action: 'list', scope: 'live' }, undefined, undefined, {
      sessionManager: { getSessionId: () => 'current-conversation' },
    });

    expect(result.content?.[0]?.text).toBe('repo worker text');
    expect(result.details).toMatchObject({ source: 'repo-worker' });
  }, 30000);
});

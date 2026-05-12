import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveConversationInspectWorkerUrlFrom } from './conversationInspectWorkerClient.js';

const previousRepoRoot = process.env.PERSONAL_AGENT_REPO_ROOT;
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pa-conversation-inspect-worker-'));
  tempRoots.push(root);
  return root;
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
}

afterEach(() => {
  if (previousRepoRoot === undefined) {
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
  } else {
    process.env.PERSONAL_AGENT_REPO_ROOT = previousRepoRoot;
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveConversationInspectWorkerUrlFrom', () => {
  it('uses the relative worker next to the server bundle outside extension cache', () => {
    const root = makeTempRoot();
    const clientPath = join(root, 'server/dist/app/localApi.js');
    const relativeWorkerPath = join(root, 'server/dist/conversations/conversationInspectWorker.js');
    touch(clientPath);
    touch(relativeWorkerPath);

    const workerUrl = resolveConversationInspectWorkerUrlFrom(pathToFileURL(clientPath).href);

    expect(workerUrl.href).toBe(pathToFileURL(relativeWorkerPath).href);
  });

  it('skips the extension-cache sibling worker and uses the bundled repo worker', () => {
    const cacheRoot = makeTempRoot();
    const repoRoot = makeTempRoot();
    const clientPath = join(cacheRoot, 'extension-cache/conversations/backend.mjs');
    const cachedWorkerPath = join(cacheRoot, 'extension-cache/conversations/conversationInspectWorker.js');
    const bundledWorkerPath = join(repoRoot, 'packages/desktop/server/dist/conversations/conversationInspectWorker.js');
    touch(clientPath);
    touch(cachedWorkerPath);
    touch(bundledWorkerPath);
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;

    const workerUrl = resolveConversationInspectWorkerUrlFrom(pathToFileURL(clientPath).href);

    expect(workerUrl.href).toBe(pathToFileURL(bundledWorkerPath).href);
  });
});

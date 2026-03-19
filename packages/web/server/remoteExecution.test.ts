import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import {
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  scanDurableRun,
} from '@personal-agent/daemon';
import { decorateRemoteExecutionRun, importRemoteExecutionRun } from './remoteExecution.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('remote execution runs', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-remote-execution-state-') };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('decorates completed remote runs and imports their summaries back into the local conversation', async () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const runsRoot = resolveDurableRunsRoot(join(stateRoot, 'daemon'));
    const runId = 'run-remote-import-1';
    const runPaths = resolveDurableRunPaths(runsRoot, runId);

    const localSessionDir = createTempDir('pa-local-session-');
    const conversationId = 'conv-remote-import-123';
    const sessionFile = join(localSessionDir, 'conv-remote-import-123.jsonl');
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'session', version: 3, id: conversationId, timestamp: '2026-03-19T15:00:00.000Z', cwd: '/tmp/local-workspace' }),
      JSON.stringify({ type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-03-19T15:00:00.100Z', modelId: 'test-model' }),
      JSON.stringify({
        type: 'message',
        id: 'u1',
        parentId: 'm1',
        timestamp: '2026-03-19T15:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Investigate the regression.' }],
        },
      }),
    ].join('\n') + '\n');
    const bootstrapLeafId = 'u1';
    const bootstrapEntryCount = 2;

    const remoteSessionDir = createTempDir('pa-remote-session-');
    const remoteSessionFile = join(remoteSessionDir, 'remote.jsonl');
    writeFileSync(remoteSessionFile, [
      readFileSync(sessionFile, 'utf-8').trim(),
      JSON.stringify({
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        timestamp: '2026-03-19T15:04:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I found the regression in the remote worker startup path and patched the SSH command builder.' }],
        },
      }),
    ].join('\n') + '\n');

    mkdirSync(runPaths.root, { recursive: true });
    copyFileSync(remoteSessionFile, join(runPaths.root, 'remote-session.jsonl'));
    writeFileSync(join(runPaths.root, 'remote-execution.json'), JSON.stringify({
      version: 1,
      targetId: 'gpu-box',
      targetLabel: 'GPU Box',
      transport: 'ssh',
      sshDestination: 'gpu-box',
      conversationId,
      localCwd: '/tmp/local-workspace',
      remoteCwd: '/srv/agent/workspace',
      prompt: 'Investigate the regression.',
      submittedAt: '2026-03-19T15:00:00.000Z',
      completedAt: '2026-03-19T15:05:00.000Z',
      bootstrapLeafId,
      bootstrapEntryCount,
      remoteSessionPath: '/tmp/remote/session.jsonl',
    }, null, 2));

    saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
      id: runId,
      kind: 'background-run',
      resumePolicy: 'manual',
      createdAt: '2026-03-19T15:00:00.000Z',
      spec: {
        remoteExecution: {
          targetId: 'gpu-box',
        },
      },
      source: {
        type: 'conversation-remote-run',
        id: conversationId,
        filePath: sessionFile,
      },
    }));
    saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
      runId,
      status: 'completed',
      createdAt: '2026-03-19T15:00:00.000Z',
      updatedAt: '2026-03-19T15:05:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-19T15:00:05.000Z',
      completedAt: '2026-03-19T15:05:00.000Z',
    }));
    saveDurableRunCheckpoint(runPaths.checkpointPath, {
      version: 1,
      runId,
      updatedAt: '2026-03-19T15:05:00.000Z',
      step: 'completed',
      payload: {
        remoteExecution: {
          version: 1,
          targetId: 'gpu-box',
          targetLabel: 'GPU Box',
          transport: 'ssh',
          conversationId,
          localCwd: '/tmp/local-workspace',
          remoteCwd: '/srv/agent/workspace',
          prompt: 'Investigate the regression.',
          submittedAt: '2026-03-19T15:00:00.000Z',
        },
      },
    });

    const run = scanDurableRun(runsRoot, runId);
    expect(run).not.toBeUndefined();
    expect(decorateRemoteExecutionRun(run!).remoteExecution).toMatchObject({
      targetId: 'gpu-box',
      targetLabel: 'GPU Box',
      importStatus: 'ready',
      transcriptAvailable: true,
    });

    const result = await importRemoteExecutionRun({
      run: run!,
      sessionFile,
    });

    expect(result.conversationId).toBe(conversationId);
    expect(result.summary).toContain('I found the regression');

    const updatedRun = decorateRemoteExecutionRun(scanDurableRun(runsRoot, runId)!);
    expect(updatedRun.remoteExecution).toMatchObject({
      importStatus: 'imported',
      importSummary: result.summary,
    });

    expect(result.summary).toContain('SSH command builder');
  });
});

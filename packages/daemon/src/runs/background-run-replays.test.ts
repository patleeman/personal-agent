import { mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFollowUpBackgroundRunInput, buildRerunBackgroundRunInput } from './background-run-replays.js';
import { resolveBackgroundRunSessionDir } from './background-run-sessions.js';
import { createDurableRunManifest, createInitialDurableRunStatus, resolveDurableRunPaths, type ScannedDurableRun } from './store.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}${Math.random().toString(16).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tempDirs.push(dir);
  return dir;
}

function createRun(
  runId: string,
  input: {
    kind: 'background-run' | 'raw-shell';
    target: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): ScannedDurableRun {
  const runsRoot = createTempDir('pa-run-replays-runs-');
  const paths = resolveDurableRunPaths(runsRoot, runId);
  return {
    runId,
    paths,
    manifest: createDurableRunManifest({
      id: runId,
      kind: input.kind,
      resumePolicy: 'manual',
      createdAt: '2026-03-25T10:00:00.000Z',
      spec: {
        target: input.target,
        callback: {
          alertLevel: 'passive',
          autoResumeIfOpen: true,
          requireAck: false,
        },
        metadata: {
          taskSlug: 'repair-prod',
          cwd: '/repo',
          resumeParentOnExit: true,
          callbackConversation: {
            conversationId: 'conv-123',
            sessionFile: '/tmp/conv-123.jsonl',
            profile: 'datadog',
            repoRoot: '/repo',
          },
          ...(input.metadata ?? {}),
        },
      },
      source: {
        type: 'tool',
        id: 'conv-123',
        filePath: '/tmp/conv-123.jsonl',
      },
    }),
    status: createInitialDurableRunStatus({
      runId,
      status: 'failed',
      createdAt: '2026-03-25T10:00:00.000Z',
      updatedAt: '2026-03-25T10:05:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-25T10:00:05.000Z',
      completedAt: '2026-03-25T10:05:00.000Z',
      lastError: 'boom',
    }),
    checkpoint: {
      version: 1,
      runId,
      updatedAt: '2026-03-25T10:05:00.000Z',
      step: 'failed',
      payload: {
        target: input.target,
        callback: {
          alertLevel: 'passive',
          autoResumeIfOpen: true,
          requireAck: false,
        },
        metadata: {
          taskSlug: 'repair-prod',
          cwd: '/repo',
          resumeParentOnExit: true,
          callbackConversation: {
            conversationId: 'conv-123',
            sessionFile: '/tmp/conv-123.jsonl',
            profile: 'datadog',
            repoRoot: '/repo',
          },
          ...(input.metadata ?? {}),
        },
      },
    },
    problems: [],
    recoveryAction: 'attention',
  };
}

beforeEach(() => {
  const stateRoot = createTempDir('pa-run-replays-state-');
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('background run replay helpers', () => {
  it('rebuilds a rerun input for shell runs', () => {
    const run = createRun('run-shell-123', {
      kind: 'raw-shell',
      target: {
        type: 'shell',
        command: `${process.execPath} -e "console.log('again')"`,
        cwd: '/repo',
        argv: [process.execPath, '-e', "console.log('again')"],
      },
    });

    expect(buildRerunBackgroundRunInput(run)).toEqual({
      taskSlug: 'repair-prod',
      cwd: '/repo',
      argv: [process.execPath, '-e', "console.log('again')"],
      source: {
        type: 'tool',
        id: 'conv-123',
        filePath: '/tmp/conv-123.jsonl',
      },
      callbackConversation: {
        conversationId: 'conv-123',
        sessionFile: '/tmp/conv-123.jsonl',
        profile: 'datadog',
        repoRoot: '/repo',
      },
      callback: {
        alertLevel: 'passive',
        autoResumeIfOpen: true,
        requireAck: false,
      },
      manifestMetadata: {
        resumeParentOnExit: true,
        callbackConversation: {
          conversationId: 'conv-123',
          sessionFile: '/tmp/conv-123.jsonl',
          profile: 'datadog',
          repoRoot: '/repo',
        },
        rerunOfRunId: 'run-shell-123',
      },
    });
  });

  it('builds a follow-up input that resumes the prior session transcript', () => {
    const run = createRun('run-agent-123', {
      kind: 'background-run',
      target: {
        type: 'agent',
        prompt: 'Initial prompt',
        profile: 'datadog',
        model: 'openai-codex/gpt-5.4',
      },
    });
    const sessionDir = resolveBackgroundRunSessionDir(run.runId);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(sessionDir, 'session.jsonl'), '{"type":"session"}\n', 'utf-8');

    expect(buildFollowUpBackgroundRunInput(run, 'Continue from the failing deploy step.')).toEqual({
      taskSlug: 'repair-prod',
      cwd: '/repo',
      agent: {
        prompt: 'Continue from the failing deploy step.',
        profile: 'datadog',
        model: 'openai-codex/gpt-5.4',
      },
      source: {
        type: 'tool',
        id: 'conv-123',
        filePath: '/tmp/conv-123.jsonl',
      },
      callbackConversation: {
        conversationId: 'conv-123',
        sessionFile: '/tmp/conv-123.jsonl',
        profile: 'datadog',
        repoRoot: '/repo',
      },
      callback: {
        alertLevel: 'passive',
        autoResumeIfOpen: true,
        requireAck: false,
      },
      manifestMetadata: {
        resumeParentOnExit: true,
        callbackConversation: {
          conversationId: 'conv-123',
          sessionFile: '/tmp/conv-123.jsonl',
          profile: 'datadog',
          repoRoot: '/repo',
        },
        followUpOfRunId: 'run-agent-123',
      },
      continueSession: true,
      bootstrapSessionDir: sessionDir,
    });
  });
});

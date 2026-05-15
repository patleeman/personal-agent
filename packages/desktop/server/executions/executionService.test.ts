import type { ScannedDurableRun } from '@personal-agent/daemon';
import { describe, expect, it } from 'vitest';

import { projectExecution } from './executionService.js';

function run(overrides: Partial<ScannedDurableRun>): ScannedDurableRun {
  return {
    runId: 'run-123',
    paths: {
      root: '/runs/run-123',
      manifestPath: '/runs/run-123/manifest.json',
      statusPath: '/runs/run-123/status.json',
      checkpointPath: '/runs/run-123/checkpoint.json',
      eventsPath: '/runs/run-123/events.jsonl',
      outputLogPath: '/runs/run-123/output.log',
      resultPath: '/runs/run-123/result.json',
    },
    manifest: {
      version: 1,
      id: 'run-123',
      kind: 'raw-shell',
      resumePolicy: 'manual',
      createdAt: '2026-05-15T00:00:00.000Z',
      spec: { shellCommand: 'pnpm test', cwd: '/repo' },
      source: { type: 'tool', id: 'conversation-1', filePath: '/sessions/conversation-1.jsonl' },
    },
    status: {
      version: 1,
      runId: 'run-123',
      status: 'running',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:01:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-05-15T00:00:01.000Z',
    },
    problems: [],
    recoveryAction: 'none',
    ...overrides,
  };
}

describe('Execution projection', () => {
  it('projects shell durable runs as primary background command executions', () => {
    expect(projectExecution(run({}))).toMatchObject({
      id: 'run-123',
      kind: 'background-command',
      visibility: 'primary',
      conversationId: 'conversation-1',
      sessionFile: '/sessions/conversation-1.jsonl',
      title: 'pnpm test',
      command: 'pnpm test',
      cwd: '/repo',
      status: 'running',
      capabilities: { canCancel: true, hasLog: true },
    });
  });

  it('projects agent background runs as primary subagent executions', () => {
    expect(
      projectExecution(
        run({
          manifest: {
            version: 1,
            id: 'run-agent',
            kind: 'background-run',
            resumePolicy: 'manual',
            createdAt: '2026-05-15T00:00:00.000Z',
            spec: { agent: { prompt: 'Review the current diff', model: 'gpt-5.5' }, cwd: '/repo' },
            source: { type: 'tool', id: 'conversation-1' },
          },
        }),
      ),
    ).toMatchObject({
      kind: 'subagent',
      visibility: 'primary',
      conversationId: 'conversation-1',
      prompt: 'Review the current diff',
      model: 'gpt-5.5',
    });
  });
});

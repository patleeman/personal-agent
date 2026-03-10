import { mkdtempSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInitialWorkstreamPlan,
  createInitialWorkstreamSummary,
  createWorkstreamActivityEntry,
  resolveWorkstreamPaths,
  writeProfileActivityEntry,
  writeWorkstreamPlan,
  writeWorkstreamSummary,
} from '@personal-agent/core';
import {
  buildContextWidgetLines,
  buildInboxWidgetLines,
  loadInboxShellSnapshot,
} from './index.js';

const tempDirs: string[] = [];

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-inbox-shell-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('inbox shell snapshot', () => {
  it('loads activity and workstream context from profile files', () => {
    const repoRoot = createTempRepo();
    const profile = 'datadog';

    mkdirSync(join(repoRoot, 'profiles', profile, 'agent', 'activity'), { recursive: true });
    const workstreamPaths = resolveWorkstreamPaths({ repoRoot, profile, workstreamId: 'artifact-model' });
    mkdirSync(workstreamPaths.tasksDir, { recursive: true });
    mkdirSync(workstreamPaths.artifactsDir, { recursive: true });

    writeWorkstreamSummary(workstreamPaths.summaryFile, createInitialWorkstreamSummary({
      id: 'artifact-model',
      objective: 'Create the durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T15:00:00.000Z',
    }));

    writeWorkstreamPlan(workstreamPaths.planFile, createInitialWorkstreamPlan({
      id: 'artifact-model',
      objective: 'Create the durable artifact model.',
      updatedAt: '2026-03-10T15:00:00.000Z',
    }));

    writeProfileActivityEntry({
      repoRoot,
      profile,
      entry: createWorkstreamActivityEntry({
        id: 'daily-report',
        createdAt: '2026-03-10T16:00:00.000Z',
        profile,
        kind: 'scheduled-task',
        summary: 'Daily report completed.',
      }),
    });

    const snapshot = loadInboxShellSnapshot(repoRoot, profile);

    expect(snapshot.activityCount).toBe(1);
    expect(snapshot.activities[0]?.summary).toBe('Daily report completed.');
    expect(snapshot.workstreamCount).toBe(1);
    expect(snapshot.latestWorkstream?.id).toBe('artifact-model');
    expect(snapshot.latestWorkstream?.objective).toContain('durable artifact model');
  });

  it('builds concise widget lines', () => {
    const snapshot = {
      profile: 'datadog',
      repoRoot: '/tmp/repo',
      activityCount: 2,
      activities: [
        {
          id: 'daily-report',
          createdAt: '2026-03-10T16:00:00.000Z',
          kind: 'scheduled-task',
          summary: 'Daily report completed.',
          notificationState: 'none',
        },
      ],
      workstreamCount: 1,
      workstreams: [
        {
          id: 'artifact-model',
          updatedAt: '2026-03-10T15:00:00.000Z',
          objective: 'Create the durable artifact model.',
          status: 'Created',
          blockers: 'None',
          completedSteps: 1,
          totalSteps: 3,
          taskRecordCount: 2,
          artifactCount: 4,
        },
      ],
      latestWorkstream: {
        id: 'artifact-model',
        updatedAt: '2026-03-10T15:00:00.000Z',
        objective: 'Create the durable artifact model.',
        status: 'Created',
        blockers: 'None',
        completedSteps: 1,
        totalSteps: 3,
        taskRecordCount: 2,
        artifactCount: 4,
      },
    };

    const inboxLines = buildInboxWidgetLines(snapshot);
    const contextLines = buildContextWidgetLines(snapshot);

    expect(inboxLines[0]).toContain('Inbox 2');
    expect(inboxLines[1]).toContain('Daily report completed.');
    expect(contextLines[0]).toContain('artifact-model');
    expect(contextLines[1]).toContain('plan 1/3');
  });
});

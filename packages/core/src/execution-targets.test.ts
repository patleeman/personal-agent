import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteExecutionTarget,
  getExecutionTarget,
  listExecutionTargets,
  resolveExecutionTargetsFilePath,
  saveExecutionTarget,
} from './execution-targets.js';

const tempDirs: string[] = [];

function createTempConfigRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-core-execution-targets-'));
  tempDirs.push(dir);
  return dir;
}

describe('execution targets', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('stores, normalizes, and lists SSH execution targets', () => {
    const configRoot = createTempConfigRoot();

    const saved = saveExecutionTarget({
      configRoot,
      target: {
        id: 'gpu-box',
        label: '  GPU Box  ',
        description: '  Primary SSH target  ',
        sshDestination: 'gpu-box',
        sshCommand: 'ssh',
        remotePaCommand: '/usr/local/bin/pa',
        profile: 'assistant',
        defaultRemoteCwd: '/srv/agent/workspace/',
        commandPrefix: 'source ~/.zshrc >/dev/null 2>&1',
        cwdMappings: [
          { localPrefix: '/Users/patrick/workingdir/personal-agent/', remotePrefix: '/srv/agent/personal-agent/' },
          { localPrefix: '/Users/patrick/workingdir/personal-agent/', remotePrefix: '/srv/agent/personal-agent/' },
        ],
      },
    });

    expect(resolveExecutionTargetsFilePath(configRoot)).toContain('config.json');
    expect(saved).toMatchObject({
      id: 'gpu-box',
      label: 'GPU Box',
      description: 'Primary SSH target',
      transport: 'ssh',
      sshDestination: 'gpu-box',
      remotePaCommand: '/usr/local/bin/pa',
      profile: 'assistant',
      defaultRemoteCwd: '/srv/agent/workspace',
      commandPrefix: 'source ~/.zshrc >/dev/null 2>&1',
      cwdMappings: [
        {
          localPrefix: '/Users/patrick/workingdir/personal-agent',
          remotePrefix: '/srv/agent/personal-agent',
        },
      ],
    });

    expect(listExecutionTargets({ configRoot })).toEqual([saved]);
    expect(getExecutionTarget({ configRoot, targetId: 'gpu-box' })).toEqual(saved);
  });

  it('updates existing execution targets in place', async () => {
    const configRoot = createTempConfigRoot();

    const first = saveExecutionTarget({
      configRoot,
      target: {
        id: 'gpu-box',
        label: 'GPU Box',
        sshDestination: 'gpu-box',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = saveExecutionTarget({
      configRoot,
      target: {
        id: 'gpu-box',
        label: 'GPU Box 02',
        sshDestination: 'gpu-box.internal',
        defaultRemoteCwd: '/srv/agent/workspace',
      },
    });

    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.updatedAt > first.updatedAt).toBe(true);
    expect(updated).toMatchObject({
      id: 'gpu-box',
      label: 'GPU Box 02',
      sshDestination: 'gpu-box.internal',
      defaultRemoteCwd: '/srv/agent/workspace',
    });
    expect(listExecutionTargets({ configRoot })).toEqual([updated]);
  });

  it('deletes execution targets and removes the backing file when empty', () => {
    const configRoot = createTempConfigRoot();
    saveExecutionTarget({
      configRoot,
      target: {
        id: 'gpu-box',
        label: 'GPU Box',
        sshDestination: 'gpu-box',
      },
    });

    expect(deleteExecutionTarget({ configRoot, targetId: 'gpu-box' })).toBe(true);
    expect(listExecutionTargets({ configRoot })).toEqual([]);
    expect(deleteExecutionTarget({ configRoot, targetId: 'gpu-box' })).toBe(false);
  });
});

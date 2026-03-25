import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  cpSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  symlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  getStateRoot: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock('fs', () => ({
  cpSync: mocks.cpSync,
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  rmSync: mocks.rmSync,
  symlinkSync: mocks.symlinkSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock('@personal-agent/core', () => ({
  getStateRoot: mocks.getStateRoot,
}));

import {
  activateWebUiSlot,
  findBadWebUiRelease,
  getWebUiDeploymentSummary,
  listBadWebUiReleases,
  markWebUiReleaseBad,
  rollbackWebUiDeployment,
  stageWebUiRelease,
} from './web-ui-deploy.js';

const existingPaths = new Set<string>();
const fileContents = new Map<string, string>();
let currentRevision = 'rev-a';

function seedRepoArtifacts(repoRoot: string): void {
  existingPaths.add(resolve(repoRoot, 'packages', 'web', 'dist'));
  existingPaths.add(resolve(repoRoot, 'packages', 'web', 'dist', 'index.html'));
  existingPaths.add(resolve(repoRoot, 'packages', 'web', 'dist-server'));
  existingPaths.add(resolve(repoRoot, 'packages', 'web', 'dist-server', 'index.js'));
  existingPaths.add(resolve(repoRoot, 'node_modules'));
}

beforeEach(() => {
  vi.clearAllMocks();
  existingPaths.clear();
  fileContents.clear();
  currentRevision = 'rev-a';

  seedRepoArtifacts('/repo/personal-agent');

  mocks.getStateRoot.mockReturnValue('/state-root');
  mocks.existsSync.mockImplementation((path: string) => existingPaths.has(String(path)));
  mocks.readFileSync.mockImplementation((path: string) => fileContents.get(String(path)) ?? '');
  mocks.writeFileSync.mockImplementation((path: string, content: string) => {
    const normalizedPath = String(path);
    existingPaths.add(normalizedPath);
    fileContents.set(normalizedPath, String(content));
  });
  mocks.cpSync.mockImplementation((source: string, destination: string) => {
    const normalizedSource = String(source);
    const normalizedDestination = String(destination);
    const snapshot = [...existingPaths];
    existingPaths.add(normalizedDestination);
    for (const entry of snapshot) {
      if (entry === normalizedSource || entry.startsWith(`${normalizedSource}/`)) {
        const copiedPath = entry.replace(normalizedSource, normalizedDestination);
        existingPaths.add(copiedPath);
        const content = fileContents.get(entry);
        if (typeof content === 'string') {
          fileContents.set(copiedPath, content);
        }
      }
    }
  });
  mocks.symlinkSync.mockImplementation((_target: string, path: string) => {
    existingPaths.add(String(path));
  });
  mocks.rmSync.mockImplementation((path: string) => {
    const normalizedPath = String(path);
    for (const entry of [...existingPaths]) {
      if (entry === normalizedPath || entry.startsWith(`${normalizedPath}/`)) {
        existingPaths.delete(entry);
      }
    }
    for (const entry of [...fileContents.keys()]) {
      if (entry === normalizedPath || entry.startsWith(`${normalizedPath}/`)) {
        fileContents.delete(entry);
      }
    }
  });
  mocks.spawnSync.mockImplementation((command: string) => {
    if (command === 'git') {
      return { status: 0, stdout: `${currentRevision}\n`, stderr: '' };
    }

    return { status: 0, stdout: '', stderr: '' };
  });
});

describe('web ui blue/green deployment state', () => {
  it('marks the active release bad and lists it', () => {
    const release = stageWebUiRelease({ repoRoot: '/repo/personal-agent', slot: 'blue' });
    activateWebUiSlot({ slot: 'blue' });

    const marked = markWebUiReleaseBad({ reason: 'basic routes failed' });

    expect(marked).toMatchObject({
      slot: 'blue',
      revision: 'rev-a',
      reason: 'basic routes failed',
      sourceRepoRoot: '/repo/personal-agent',
    });
    expect(findBadWebUiRelease({ release })).toMatchObject({
      revision: 'rev-a',
      slot: 'blue',
    });
    expect(listBadWebUiReleases()).toHaveLength(1);
  });

  it('rolls back to the inactive release and marks the failed release bad', () => {
    stageWebUiRelease({ repoRoot: '/repo/personal-agent', slot: 'blue' });
    activateWebUiSlot({ slot: 'blue' });

    currentRevision = 'rev-b';
    stageWebUiRelease({ repoRoot: '/repo/personal-agent', slot: 'green' });
    activateWebUiSlot({ slot: 'green' });

    const result = rollbackWebUiDeployment({ reason: 'home route failed after cutover' });

    expect(result.rolledBackFrom).toMatchObject({ slot: 'green', revision: 'rev-b' });
    expect(result.restoredRelease).toMatchObject({ slot: 'blue', revision: 'rev-a' });
    expect(result.markedBad).toMatchObject({ revision: 'rev-b', reason: 'home route failed after cutover' });
    expect(getWebUiDeploymentSummary()).toMatchObject({
      activeSlot: 'blue',
      activeRelease: { revision: 'rev-a' },
      inactiveRelease: { revision: 'rev-b' },
    });
  });

  it('refuses to restage a revision that is marked bad', () => {
    stageWebUiRelease({ repoRoot: '/repo/personal-agent', slot: 'blue' });
    activateWebUiSlot({ slot: 'blue' });

    currentRevision = 'rev-b';
    stageWebUiRelease({ repoRoot: '/repo/personal-agent', slot: 'green' });
    activateWebUiSlot({ slot: 'green' });
    markWebUiReleaseBad({ reason: 'routes were broken' });

    expect(() => stageWebUiRelease({ repoRoot: '/repo/personal-agent', slot: 'blue' })).toThrow(
      'Refusing to deploy web UI revision rev-b because it is marked bad',
    );
  });
});

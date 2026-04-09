import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
}));

import {
  ensureActiveWebUiRelease,
  getWebUiDeploymentSummary,
} from './web-ui-deploy.js';

const existingPaths = new Set<string>();
let currentRevision = 'rev-a';

function seedRepoArtifacts(repoRoot: string): void {
  existingPaths.add(resolve(repoRoot, 'packages', 'web', 'dist'));
  existingPaths.add(resolve(repoRoot, 'packages', 'web', 'dist-server'));
  existingPaths.add(resolve(repoRoot, 'packages', 'web', 'dist-server', 'index.js'));
  existingPaths.add(resolve(repoRoot, 'node_modules'));
}

beforeEach(() => {
  vi.clearAllMocks();
  existingPaths.clear();
  currentRevision = 'rev-a';

  seedRepoArtifacts('/repo/personal-agent');

  mocks.existsSync.mockImplementation((path: string) => existingPaths.has(String(path)));
  mocks.spawnSync.mockImplementation((command: string) => {
    if (command === 'git') {
      return { status: 0, stdout: `${currentRevision}\n`, stderr: '' };
    }

    return { status: 0, stdout: '', stderr: '' };
  });
});

describe('web ui release summary', () => {
  it('returns the active release when build artifacts are present', () => {
    expect(getWebUiDeploymentSummary({ repoRoot: '/repo/personal-agent' })).toMatchObject({
      stablePort: 3741,
      activeRelease: {
        sourceRepoRoot: '/repo/personal-agent',
        distDir: '/repo/personal-agent/packages/web/dist',
        serverDir: '/repo/personal-agent/packages/web/dist-server',
        serverEntryFile: '/repo/personal-agent/packages/web/dist-server/index.js',
        revision: 'rev-a',
      },
    });
  });

  it('omits the active release when build artifacts are missing', () => {
    existingPaths.delete('/repo/personal-agent/packages/web/dist-server/index.js');

    expect(getWebUiDeploymentSummary({ repoRoot: '/repo/personal-agent', stablePort: 4810 })).toEqual({
      stablePort: 4810,
      activeRelease: undefined,
    });
  });

  it('throws when the managed service needs build artifacts that are missing', () => {
    existingPaths.delete('/repo/personal-agent/node_modules');

    expect(() => ensureActiveWebUiRelease({ repoRoot: '/repo/personal-agent' })).toThrow(
      'node_modules is missing in /repo/personal-agent. Run `npm install` first.',
    );
  });
});

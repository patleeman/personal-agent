import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDesktopAboutPanelOptions, resolveDesktopAboutVersionsForPaths } from './about.js';

const tempDirs: string[] = [];

function createTempDesktopLayout(): { currentDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pa-desktop-about-'));
  tempDirs.push(root);

  const repoRoot = join(root, 'repo');
  const packageDir = join(repoRoot, 'packages', 'desktop');
  const currentDir = join(packageDir, 'dist');
  const piPackageDir = join(repoRoot, 'node_modules', '@mariozechner', 'pi-coding-agent');

  mkdirSync(currentDir, { recursive: true });
  mkdirSync(piPackageDir, { recursive: true });

  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ version: '0.1.11' }));
  writeFileSync(join(piPackageDir, 'package.json'), JSON.stringify({ version: '0.66.0' }));

  return { currentDir };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveDesktopAboutVersionsForPaths', () => {
  it('reads Personal Agent and Pi versions from the desktop package layout', () => {
    const { currentDir } = createTempDesktopLayout();

    expect(resolveDesktopAboutVersionsForPaths(currentDir)).toEqual({
      applicationVersion: '0.1.11',
      piVersion: '0.66.0',
    });
  });

  it('falls back to Unknown when version metadata is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-desktop-about-missing-'));
    tempDirs.push(root);

    const currentDir = join(root, 'packages', 'desktop', 'dist');
    mkdirSync(currentDir, { recursive: true });

    expect(resolveDesktopAboutVersionsForPaths(currentDir, root)).toEqual({
      applicationVersion: 'Unknown',
      piVersion: 'Unknown',
    });
  });
});

describe('buildDesktopAboutPanelOptions', () => {
  it('uses the app version and Pi version in native about panel metadata', () => {
    expect(buildDesktopAboutPanelOptions({
      applicationName: 'Personal Agent',
      applicationVersion: '0.1.11',
      piVersion: '0.66.0',
    })).toEqual({
      applicationName: 'Personal Agent',
      applicationVersion: '0.1.11',
      credits: 'Pi 0.66.0',
    });
  });
});

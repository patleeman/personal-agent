import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDesktopAboutPageHtml, resolveDesktopAboutVersionsForPaths } from './about.js';

const tempDirs: string[] = [];

function createTempDesktopLayout(): {
  currentDir: string;
  cleanup: () => void;
} {
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

  return {
    currentDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
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

describe('buildDesktopAboutPageHtml', () => {
  it('renders the branded logo and version rows', () => {
    const html = buildDesktopAboutPageHtml({
      applicationName: 'Personal Agent',
      applicationVersion: '0.1.11',
      piVersion: '0.66.0',
      iconDataUrl: 'data:image/png;base64,ZmFrZQ==',
    });

    expect(html).toContain('About Personal Agent');
    expect(html).toContain('alt="Personal Agent logo"');
    expect(html).toContain('Personal Agent</dt>');
    expect(html).toContain('>0.1.11<');
    expect(html).toContain('>Pi<');
    expect(html).toContain('>0.66.0<');
  });

  it('escapes version text before injecting it into the page', () => {
    const html = buildDesktopAboutPageHtml({
      applicationName: 'Personal Agent',
      applicationVersion: '<0.1.11>',
      piVersion: '0.66.0 & dev',
      iconDataUrl: 'data:image/png;base64,ZmFrZQ==',
    });

    expect(html).toContain('&lt;0.1.11&gt;');
    expect(html).toContain('0.66.0 &amp; dev');
    expect(html).not.toContain('<0.1.11>');
  });
});

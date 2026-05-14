import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listExtensionPackagePaths } from './extensionPackagePaths.js';

const originalResourcesPath = process.resourcesPath;

function writeExtension(root: string, id: string) {
  const packageRoot = join(root, id);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, 'extension.json'), JSON.stringify({ schemaVersion: 2, id, name: id }, null, 2));
  return packageRoot;
}

describe('extension package paths', () => {
  afterEach(() => {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
  });

  it('discovers packaged experimental extensions from Electron resources', () => {
    const tempRoot = join(tmpdir(), `pa-extension-paths-${process.pid}-${Date.now()}`);
    const experimentalRoot = join(tempRoot, 'experimental-extensions', 'extensions');
    const packageRoot = writeExtension(experimentalRoot, 'sample-experiment');

    Object.defineProperty(process, 'resourcesPath', {
      value: tempRoot,
      configurable: true,
    });

    try {
      expect(existsSync(packageRoot)).toBe(true);
      expect(listExtensionPackagePaths()).toEqual(
        expect.arrayContaining([expect.objectContaining({ packageRoot, source: 'experimental' })]),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

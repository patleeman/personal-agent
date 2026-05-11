import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isPrebuiltOnlyExtensionRuntime,
  resolvePackagedExtensionBackendLoadTarget,
  resolvePrebuiltSystemExtensionBackend,
  shouldPreferPrebuiltSystemExtensionBackend,
} from './extensionBackendLoadTarget.js';

const TEST_EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../extensions/system-auto-mode');

describe('extension backend packaged load targeting', () => {
  it('only prefers prebuilt bundled backends when running a packaged desktop app', () => {
    expect(shouldPreferPrebuiltSystemExtensionBackend({ resourcesPath: undefined, env: {} })).toBe(false);
    expect(isPrebuiltOnlyExtensionRuntime({ resourcesPath: undefined, env: {} })).toBe(false);
    expect(
      shouldPreferPrebuiltSystemExtensionBackend({
        resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
        env: { PERSONAL_AGENT_DESKTOP_DEV_BUNDLE: '1' },
      }),
    ).toBe(false);
    expect(
      shouldPreferPrebuiltSystemExtensionBackend({
        resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
        env: {},
      }),
    ).toBe(true);
    expect(
      isPrebuiltOnlyExtensionRuntime({
        resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
        env: {},
      }),
    ).toBe(true);
  });

  it('resolves prebuilt dist/backend.mjs for packaged bundled system extensions', () => {
    const target = resolvePrebuiltSystemExtensionBackend(
      { source: 'system', packageRoot: TEST_EXTENSION_ROOT },
      {
        resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
        env: {},
      },
    );

    expect(target).toMatchObject({
      path: resolve(TEST_EXTENSION_ROOT, 'dist/backend.mjs'),
    });
    expect(target?.hash).toMatch(/^prebuilt:/);
  });

  it('resolves packaged prebuilt backends for runtime extensions that already point at built output', () => {
    const target = resolvePackagedExtensionBackendLoadTarget({ source: 'runtime', packageRoot: TEST_EXTENSION_ROOT }, 'dist/backend.mjs', {
      resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
      env: {},
    });

    expect(target).toMatchObject({
      path: resolve(TEST_EXTENSION_ROOT, 'dist/backend.mjs'),
    });
  });

  it('does not bypass source rebuilds for source-backed runtime extensions or dev desktop bundles', () => {
    expect(
      resolvePackagedExtensionBackendLoadTarget({ source: 'runtime', packageRoot: TEST_EXTENSION_ROOT }, 'src/backend.ts', {
        resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
        env: {},
      }),
    ).toBeNull();

    expect(
      resolvePrebuiltSystemExtensionBackend(
        { source: 'runtime', packageRoot: TEST_EXTENSION_ROOT },
        {
          resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
          env: {},
        },
      ),
    ).toBeNull();

    expect(
      resolvePrebuiltSystemExtensionBackend(
        { source: 'system', packageRoot: TEST_EXTENSION_ROOT },
        {
          resourcesPath: '/Applications/Personal Agent.app/Contents/Resources',
          env: { PERSONAL_AGENT_DESKTOP_DEV_BUNDLE: '1' },
        },
      ),
    ).toBeNull();
  });
});

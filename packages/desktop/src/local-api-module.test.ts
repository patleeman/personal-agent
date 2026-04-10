import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/ignored/app.asar'),
  },
}));

import { resolveLocalApiModuleUrl } from './local-api-module.js';

describe('resolveLocalApiModuleUrl', () => {
  it('resolves the dev local API module from the web package build output', () => {
    expect(resolveLocalApiModuleUrl({
      currentDir: '/repo/packages/desktop/dist',
      isPackaged: false,
    })).toBe(pathToFileURL(resolve('/repo/packages/desktop/dist', '..', '..', 'web', 'dist-server', 'app', 'localApi.js')).href);
  });

  it('resolves the packaged local API module from the bundled web package', () => {
    expect(resolveLocalApiModuleUrl({
      isPackaged: true,
      appPath: '/Applications/Personal Agent.app/Contents/Resources/app.asar',
    })).toBe(pathToFileURL(resolve('/Applications/Personal Agent.app/Contents/Resources/app.asar', 'node_modules', '@personal-agent', 'web', 'dist-server', 'app', 'localApi.js')).href);
  });
});

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { importLocalApiModuleWithFallback, resolveLocalApiModuleUrl } from './local-api-module.js';

describe('resolveLocalApiModuleUrl', () => {
  it('resolves the dev local API module from the web package build output', () => {
    expect(resolveLocalApiModuleUrl({
      currentDir: '/repo/packages/desktop/dist',
      isPackaged: false,
    })).toBe(pathToFileURL(resolve('/repo/packages/desktop/dist', '..', '..', 'web', 'dist-server', 'app', 'localApi.js')).href);
  });

  it('resolves the packaged local API module from the bundled web package', () => {
    expect(resolveLocalApiModuleUrl({
      currentDir: '/Applications/Personal Agent.app/Contents/Resources/app.asar/dist',
      isPackaged: true,
      appPath: '/Applications/Personal Agent.app/Contents/Resources/app.asar',
    })).toBe(pathToFileURL(resolve('/Applications/Personal Agent.app/Contents/Resources/app.asar', 'node_modules', '@personal-agent', 'web', 'dist-server', 'app', 'localApi.js')).href);
  });

  it('can auto-resolve the packaged bundle path without importing electron', () => {
    expect(resolveLocalApiModuleUrl({
      currentDir: '/Applications/Personal Agent.app/Contents/Resources/app.asar/dist',
      appPath: '/Applications/Personal Agent.app/Contents/Resources/app.asar',
    })).toBe(pathToFileURL(resolve('/Applications/Personal Agent.app/Contents/Resources/app.asar', 'node_modules', '@personal-agent', 'web', 'dist-server', 'app', 'localApi.js')).href);
  });
});

describe('importLocalApiModuleWithFallback', () => {
  it('falls back to the repo-built module when the primary import fails', async () => {
    const loadModule = vi.fn()
      .mockRejectedValueOnce(new Error('missing primary module'))
      .mockResolvedValueOnce({ marker: 'fallback' });

    await expect(importLocalApiModuleWithFallback({
      primaryUrl: 'file:///primary/localApi.js',
      fallbackUrl: 'file:///fallback/localApi.js',
      loadModule,
    })).resolves.toEqual({ marker: 'fallback' });

    expect(loadModule).toHaveBeenNthCalledWith(1, 'file:///primary/localApi.js');
    expect(loadModule).toHaveBeenNthCalledWith(2, 'file:///fallback/localApi.js');
  });

  it('rethrows the primary error when no distinct fallback is available', async () => {
    const loadModule = vi.fn().mockRejectedValueOnce(new Error('missing primary module'));

    await expect(importLocalApiModuleWithFallback({
      primaryUrl: 'file:///primary/localApi.js',
      fallbackUrl: 'file:///primary/localApi.js',
      loadModule,
    })).rejects.toThrow('missing primary module');

    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(loadModule).toHaveBeenCalledWith('file:///primary/localApi.js');
  });
});

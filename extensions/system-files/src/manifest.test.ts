import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const EXTENSION_JSON_PATH = resolve(PKG_ROOT, 'extension.json');

describe('system-files manifest', () => {
  const manifest = JSON.parse(readFileSync(EXTENSION_JSON_PATH, 'utf-8'));

  it('has the expected identity', () => {
    expect(manifest.id).toBe('system-files');
    expect(manifest.name).toBe('File Explorer');
    expect(manifest.packageType).toBe('system');
    expect(manifest.schemaVersion).toBe(2);
  });

  it('declares a frontend entry', () => {
    expect(manifest.frontend.entry).toBe('dist/frontend.js');
  });

  it('declares file explorer views', () => {
    const views = manifest.contributes.views;
    expect(views.find((v: { id: string }) => v.id === 'workspace-files')).toBeDefined();
    expect(views.find((v: { id: string }) => v.id === 'workspace-file-detail')).toBeDefined();
  });

  it('declares the file palette command binding', () => {
    const commands = manifest.contributes.commands;
    expect(commands.find((c: { id: string }) => c.id === 'open-files-palette')).toBeDefined();
    expect(manifest.contributes.keybindings.find((k: { id: string }) => k.id === 'open-files-palette')).toBeDefined();
  });

  it('declares required permissions', () => {
    expect(manifest.permissions).toContain('workspace:read');
    expect(manifest.permissions).toContain('workspace:write');
  });
});

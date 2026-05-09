import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const EXTENSION_JSON_PATH = resolve(PKG_ROOT, 'extension.json');

describe('system-settings manifest', () => {
  const manifest = JSON.parse(readFileSync(EXTENSION_JSON_PATH, 'utf-8'));

  it('has the expected identity', () => {
    expect(manifest.id).toBe('system-settings');
    expect(manifest.name).toBe('Settings panels');
    expect(manifest.packageType).toBe('system');
    expect(manifest.schemaVersion).toBe(2);
  });

  it('declares a frontend entry', () => {
    expect(manifest.frontend.entry).toBe('dist/frontend.js');
  });

  it('declares the core settings views', () => {
    const views = manifest.contributes.views;
    expect(views.find((v: { id: string }) => v.id === 'settings')).toBeDefined();
    expect(views.find((v: { id: string }) => v.id === 'providers')).toBeDefined();
    expect(views.find((v: { id: string }) => v.id === 'desktop')).toBeDefined();
  });

  it('declares the keyboard shortcut for settings', () => {
    const kb = manifest.contributes.keybindings.find((k: { id: string }) => k.id === 'open-settings');
    expect(kb).toBeDefined();
    expect(kb.keys).toContain('mod+,');
  });

  it('declares required permissions', () => {
    expect(manifest.permissions).toContain('settings:read');
    expect(manifest.permissions).toContain('settings:write');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const EXTENSION_JSON_PATH = resolve(PKG_ROOT, 'extension.json');

describe('system-extension-manager manifest', () => {
  const manifest = JSON.parse(readFileSync(EXTENSION_JSON_PATH, 'utf-8'));

  it('has the expected identity', () => {
    expect(manifest.id).toBe('system-extension-manager');
    expect(manifest.name).toBe('Extension Manager');
    expect(manifest.packageType).toBe('system');
  });

  it('has a valid schema version', () => {
    expect(manifest.schemaVersion).toBe(2);
  });

  it('declares a frontend entry', () => {
    expect(manifest.frontend).toBeDefined();
    expect(manifest.frontend.entry).toBe('dist/frontend.js');
  });

  it('declares the expected view contribution', () => {
    expect(manifest.contributes.views).toBeDefined();
    const pageView = manifest.contributes.views.find((v: { id: string }) => v.id === 'page');
    expect(pageView).toBeDefined();
    expect(pageView.location).toBe('main');
    expect(pageView.route).toBe('/extensions');
    expect(pageView.component).toBe('ExtensionManagerPage');
  });

  it('declares required permissions', () => {
    expect(manifest.permissions).toContain('extensions:read');
    expect(manifest.permissions).toContain('extensions:write');
  });
});

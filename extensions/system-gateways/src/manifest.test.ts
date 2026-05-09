import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const EXTENSION_JSON_PATH = resolve(PKG_ROOT, 'extension.json');

describe('system-gateways manifest', () => {
  const manifest = JSON.parse(readFileSync(EXTENSION_JSON_PATH, 'utf-8'));

  it('has the expected identity', () => {
    expect(manifest.id).toBe('system-gateways');
    expect(manifest.name).toBe('Gateways');
    expect(manifest.packageType).toBe('system');
    expect(manifest.schemaVersion).toBe(2);
  });

  it('declares a frontend entry', () => {
    expect(manifest.frontend.entry).toBe('dist/frontend.js');
  });

  it('declares the page view and nav entry', () => {
    const view = manifest.contributes.views.find((v: { id: string }) => v.id === 'page');
    expect(view).toBeDefined();
    expect(view.component).toBe('GatewaysPage');
    expect(view.route).toBe('/gateways');

    const nav = manifest.contributes.nav.find((n: { id: string }) => n.id === 'nav');
    expect(nav).toBeDefined();
    expect(nav.route).toBe('/gateways');
  });

  it('declares required permissions', () => {
    expect(manifest.permissions).toContain('gateways:read');
    expect(manifest.permissions).toContain('gateways:write');
  });
});

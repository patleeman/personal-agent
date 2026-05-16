import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const EXTENSION_JSON_PATH = resolve(PKG_ROOT, 'extension.json');

describe('system-telemetry manifest', () => {
  const manifest = JSON.parse(readFileSync(EXTENSION_JSON_PATH, 'utf-8'));

  it('has the expected identity', () => {
    expect(manifest.id).toBe('system-telemetry');
    expect(manifest.name).toBe('Telemetry');
    expect(manifest.packageType).toBe('system');
    expect(manifest.schemaVersion).toBe(2);
  });

  it('declares a frontend entry', () => {
    expect(manifest.frontend.entry).toBe('dist/frontend.js');
  });

  it('declares the page view and nav entry', () => {
    const view = manifest.contributes.views.find((v: { id: string }) => v.id === 'page');
    expect(view).toBeDefined();
    expect(view.component).toBe('TelemetryPage');
    expect(view.route).toBe('/telemetry');

    const nav = manifest.contributes.nav.find((n: { id: string }) => n.id === 'telemetry-nav');
    expect(nav).toBeDefined();
    expect(nav.route).toBe('/telemetry');
  });

  it('declares required permissions', () => {
    expect(manifest.permissions).toContain('telemetry:read');
  });
});

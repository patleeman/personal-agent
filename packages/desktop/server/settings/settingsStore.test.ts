import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock extension registry ───────────────────────────────────────────

const mockRegistrations = [
  {
    extensionId: 'ext-a',
    packageType: 'system',
    key: 'app.timeout',
    type: 'number',
    default: 30,
    group: 'App',
    description: 'Timeout',
    order: 1,
    enum: undefined,
    placeholder: undefined,
  },
  {
    extensionId: 'ext-b',
    packageType: 'system',
    key: 'app.featureX',
    type: 'boolean',
    default: false,
    group: 'App',
    description: 'Enable feature',
    order: 2,
    enum: undefined,
    placeholder: undefined,
  },
  {
    extensionId: 'ext-c',
    packageType: 'system',
    key: 'app.mode',
    type: 'string',
    default: 'auto',
    group: 'App',
    description: 'Mode',
    order: 3,
    enum: undefined,
    placeholder: undefined,
  },
];

vi.mock('../extensions/extensionRegistry.js', () => ({
  listExtensionSettingsRegistrations: vi.fn(() => mockRegistrations),
}));

// ── SUT ───────────────────────────────────────────────────────────────

import { createSettingsStore } from './settingsStore.js';

function testStateRoot(): string {
  const dir = join(resolve('/tmp'), `settings-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanStateRoot(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('SettingsStore', () => {
  let stateRoot: string;

  beforeEach(() => {
    stateRoot = testStateRoot();
  });

  afterEach(() => {
    cleanStateRoot(stateRoot);
  });

  describe('read()', () => {
    it('returns defaults when no overrides file exists', () => {
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result).toEqual({
        'app.timeout': 30,
        'app.featureX': false,
        'app.mode': 'auto',
      });
    });

    it('merges overrides on top of defaults', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'app.timeout': 60 }));
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result).toEqual({
        'app.timeout': 60,
        'app.featureX': false,
        'app.mode': 'auto',
      });
    });

    it('passes through unknown overrides not in schema', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'unknown.key': 'value', 'app.featureX': true }));
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result['app.featureX']).toBe(true);
      expect(result['unknown.key']).toBe('value');
    });

    it('handles empty overrides file', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({}));
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result['app.timeout']).toBe(30);
    });

    it('handles corrupted overrides file', () => {
      writeFileSync(join(stateRoot, 'settings.json'), '{bad json');
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result['app.timeout']).toBe(30);
    });
  });

  describe('readOverrides()', () => {
    it('returns only stored values', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'app.timeout': 60 }));
      const store = createSettingsStore(stateRoot);
      expect(store.readOverrides()).toEqual({ 'app.timeout': 60 });
    });

    it('returns empty object when no file exists', () => {
      const store = createSettingsStore(stateRoot);
      expect(store.readOverrides()).toEqual({});
    });
  });

  describe('update()', () => {
    it('persists updates and returns merged result', () => {
      const store = createSettingsStore(stateRoot);
      const result = store.update({ 'app.timeout': 60, 'app.featureX': true });
      expect(result).toEqual({
        'app.timeout': 60,
        'app.featureX': true,
        'app.mode': 'auto',
      });
      const raw = JSON.parse(readFileSync(join(stateRoot, 'settings.json'), 'utf-8')) as Record<string, unknown>;
      expect(raw).toEqual({ 'app.timeout': 60, 'app.featureX': true });
    });

    it('updates existing overrides', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'app.timeout': 30 }));
      const store = createSettingsStore(stateRoot);
      store.update({ 'app.timeout': 120 });
      const raw = JSON.parse(readFileSync(join(stateRoot, 'settings.json'), 'utf-8')) as Record<string, unknown>;
      expect(raw).toEqual({ 'app.timeout': 120 });
    });

    it('type-coerces boolean values', () => {
      const store = createSettingsStore(stateRoot);
      store.update({ 'app.featureX': true });
      const raw = JSON.parse(readFileSync(join(stateRoot, 'settings.json'), 'utf-8')) as Record<string, unknown>;
      expect(raw['app.featureX']).toBe(true);
    });
  });

  describe('readSchema()', () => {
    it('returns all registered settings', () => {
      const store = createSettingsStore(stateRoot);
      const schema = store.readSchema();
      expect(schema).toHaveLength(3);
      expect(schema.map((s) => s.key)).toEqual(['app.timeout', 'app.featureX', 'app.mode']);
    });
  });
});

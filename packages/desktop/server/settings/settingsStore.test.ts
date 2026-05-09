import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock extension registry ───────────────────────────────────────────

const mockRegistrations = [
  {
    extensionId: 'system-knowledge',
    packageType: 'system',
    key: 'knowledge.vaultPath',
    type: 'string',
    default: '',
    group: 'Knowledge',
    description: 'Path to vault',
    order: 1,
    enum: undefined,
    placeholder: undefined,
  },
  {
    extensionId: 'system-knowledge',
    packageType: 'system',
    key: 'knowledge.autoSync',
    type: 'boolean',
    default: true,
    group: 'Knowledge',
    description: 'Auto sync',
    order: 2,
    enum: undefined,
    placeholder: undefined,
  },
  {
    extensionId: 'system-caffinate',
    packageType: 'system',
    key: 'daemon.keepAwake',
    type: 'boolean',
    default: false,
    group: 'Daemon',
    description: 'Keep awake',
    order: 1,
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
        'knowledge.vaultPath': '',
        'knowledge.autoSync': true,
        'daemon.keepAwake': false,
      });
    });

    it('merges overrides on top of defaults', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'knowledge.vaultPath': '/my/vault' }));
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result).toEqual({
        'knowledge.vaultPath': '/my/vault',
        'knowledge.autoSync': true,
        'daemon.keepAwake': false,
      });
    });

    it('passes through unknown overrides not in schema', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'unknown.key': 'value', 'knowledge.autoSync': false }));
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result).toEqual({
        'knowledge.vaultPath': '',
        'knowledge.autoSync': false,
        'daemon.keepAwake': false,
        'unknown.key': 'value',
      });
    });

    it('handles empty overrides file', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({}));
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result['knowledge.autoSync']).toBe(true);
    });

    it('handles corrupted overrides file', () => {
      writeFileSync(join(stateRoot, 'settings.json'), '{bad json');
      const store = createSettingsStore(stateRoot);
      const result = store.read();
      expect(result['knowledge.autoSync']).toBe(true);
    });
  });

  describe('readOverrides()', () => {
    it('returns only stored values', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'knowledge.vaultPath': '/vault' }));
      const store = createSettingsStore(stateRoot);
      expect(store.readOverrides()).toEqual({ 'knowledge.vaultPath': '/vault' });
    });

    it('returns empty object when no file exists', () => {
      const store = createSettingsStore(stateRoot);
      expect(store.readOverrides()).toEqual({});
    });
  });

  describe('update()', () => {
    it('persists updates and returns merged result', () => {
      const store = createSettingsStore(stateRoot);
      const result = store.update({ 'knowledge.vaultPath': '/new/vault', 'daemon.keepAwake': true });
      expect(result).toEqual({
        'knowledge.vaultPath': '/new/vault',
        'knowledge.autoSync': true,
        'daemon.keepAwake': true,
      });
      // Verify persisted
      const raw = JSON.parse(readFileSync(join(stateRoot, 'settings.json'), 'utf-8')) as Record<string, unknown>;
      expect(raw).toEqual({ 'knowledge.vaultPath': '/new/vault', 'daemon.keepAwake': true });
    });

    it('updates existing overrides', () => {
      writeFileSync(join(stateRoot, 'settings.json'), JSON.stringify({ 'knowledge.vaultPath': '/old' }));
      const store = createSettingsStore(stateRoot);
      store.update({ 'knowledge.vaultPath': '/updated' });
      const raw = JSON.parse(readFileSync(join(stateRoot, 'settings.json'), 'utf-8')) as Record<string, unknown>;
      expect(raw).toEqual({ 'knowledge.vaultPath': '/updated' });
    });

    it('type-coerces boolean values', () => {
      const store = createSettingsStore(stateRoot);
      store.update({ 'knowledge.autoSync': false });
      const raw = JSON.parse(readFileSync(join(stateRoot, 'settings.json'), 'utf-8')) as Record<string, unknown>;
      expect(raw['knowledge.autoSync']).toBe(false);
    });
  });

  describe('readSchema()', () => {
    it('returns all registered settings', () => {
      const store = createSettingsStore(stateRoot);
      const schema = store.readSchema();
      expect(schema).toHaveLength(3);
      expect(schema.map((s) => s.key)).toEqual(['knowledge.vaultPath', 'knowledge.autoSync', 'daemon.keepAwake']);
    });
  });
});

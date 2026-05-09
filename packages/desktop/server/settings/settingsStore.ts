import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getStateRoot } from '@personal-agent/core';

import { type ExtensionSettingsRegistration, listExtensionSettingsRegistrations } from '../extensions/extensionRegistry.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SettingsStore {
  /** Returns the merged view: overrides on top of schema defaults. */
  read(): Record<string, unknown>;
  /** Returns only the persisted overrides (no defaults). */
  readOverrides(): Record<string, unknown>;
  /** Updates one or more keys. */
  update(overrides: Record<string, unknown>): Record<string, unknown>;
  /** Returns the active schema: all registered extension settings merged. */
  readSchema(): ExtensionSettingsRegistration[];
}

// ── Helpers ────────────────────────────────────────────────────────────

function getSettingsFilePath(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'settings.json');
}

function readRawOverrides(stateRoot: string): Record<string, unknown> {
  const filePath = getSettingsFilePath(stateRoot);
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore corrupted settings.
  }
  return {};
}

function writeOverrides(overrides: Record<string, unknown>, stateRoot: string): void {
  const dir = join(stateRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(getSettingsFilePath(stateRoot), `${JSON.stringify(overrides, null, 2)}\n`);
}

function mergeDefaults(overrides: Record<string, unknown>, schema: ExtensionSettingsRegistration[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Apply defaults first
  for (const setting of schema) {
    if (setting.default !== undefined) {
      result[setting.key] = setting.default;
    }
  }
  // Override with stored values
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = value;
  }
  return result;
}

// ── Factory ────────────────────────────────────────────────────────────

export function createSettingsStore(stateRoot: string = getStateRoot()): SettingsStore {
  return {
    read(): Record<string, unknown> {
      const overrides = readRawOverrides(stateRoot);
      const schema = listExtensionSettingsRegistrations(stateRoot);
      return mergeDefaults(overrides, schema);
    },

    readOverrides(): Record<string, unknown> {
      return readRawOverrides(stateRoot);
    },

    update(updates: Record<string, unknown>): Record<string, unknown> {
      const overrides = readRawOverrides(stateRoot);
      const schema = listExtensionSettingsRegistrations(stateRoot);
      const schemaByKey = new Map(schema.map((s) => [s.key, s]));

      for (const [key, value] of Object.entries(updates)) {
        const setting = schemaByKey.get(key);
        if (setting && setting.type === 'boolean') {
          overrides[key] = Boolean(value);
        } else if (setting && setting.type === 'number') {
          overrides[key] = typeof value === 'number' ? value : Number(value);
        } else {
          overrides[key] = value;
        }
      }

      writeOverrides(overrides, stateRoot);
      return mergeDefaults(overrides, schema);
    },

    readSchema(): ExtensionSettingsRegistration[] {
      return listExtensionSettingsRegistrations(stateRoot);
    },
  };
}

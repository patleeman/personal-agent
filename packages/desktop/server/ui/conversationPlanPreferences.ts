import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ConversationPlanItemRecord =
  | {
      id: string;
      kind: 'instruction';
      label: string;
      text: string;
    }
  | {
      id: string;
      kind: 'skill';
      label: string;
      skillName: string;
      skillArgs?: string;
    };

export interface ConversationPlanPresetRecord {
  id: string;
  name: string;
  updatedAt: string;
  items: ConversationPlanItemRecord[];
}

export interface ConversationPlanDefaultsState {
  defaultEnabled: boolean;
}

export interface ConversationPlanLibraryState {
  presets: ConversationPlanPresetRecord[];
  defaultPresetIds: string[];
}

export interface ConversationPlanWorkspaceState extends ConversationPlanDefaultsState {
  presetLibrary: ConversationPlanLibraryState;
}

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function writeSettingsObject(settingsFile: string, settings: Record<string, unknown>): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  const match = normalized.match(ISO_TIMESTAMP_PATTERN);
  const parsed = match && hasValidIsoDateParts(match) ? Date.parse(normalized) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second
    && date.getUTCMilliseconds() === millisecond;
}

function normalizeConversationPlanItem(value: unknown, index: number): ConversationPlanItemRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = value.kind === 'skill' ? 'skill' : 'instruction';
  const id = typeof value.id === 'string' && value.id.trim().length > 0
    ? value.id.trim()
    : `item-${index + 1}`;
  const label = typeof value.label === 'string' && value.label.trim().length > 0
    ? value.label.trim()
    : kind === 'skill'
      ? 'Skill'
      : 'Instruction';

  if (kind === 'skill') {
    const skillName = typeof value.skillName === 'string' ? value.skillName.trim() : '';
    if (!skillName) {
      return null;
    }

    const skillArgs = typeof value.skillArgs === 'string' && value.skillArgs.trim().length > 0
      ? value.skillArgs.trim()
      : undefined;

    return {
      id,
      kind,
      label,
      skillName,
      ...(skillArgs ? { skillArgs } : {}),
    };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (!text) {
    return null;
  }

  return {
    id,
    kind,
    label,
    text,
  };
}

export function readConversationPlanDefaults(settingsFile: string): ConversationPlanDefaultsState {
  const settings = readSettingsObject(settingsFile);
  const ui = isRecord(settings.ui) ? settings.ui : {};
  const conversationAutomation = isRecord(ui.conversationAutomation) ? ui.conversationAutomation : {};

  return {
    defaultEnabled: conversationAutomation.defaultEnabled === true,
  };
}

export function writeConversationPlanDefaults(
  input: { defaultEnabled?: boolean },
  settingsFile: string,
): ConversationPlanDefaultsState {
  const settings = readSettingsObject(settingsFile);
  const ui = isRecord(settings.ui) ? { ...settings.ui } : {};
  const conversationAutomation = isRecord(ui.conversationAutomation) ? { ...ui.conversationAutomation } : {};

  if (typeof input.defaultEnabled === 'boolean') {
    conversationAutomation.defaultEnabled = input.defaultEnabled;
  }

  ui.conversationAutomation = conversationAutomation;
  settings.ui = ui;
  writeSettingsObject(settingsFile, settings);
  return readConversationPlanDefaults(settingsFile);
}

export function readConversationPlanLibrary(settingsFile: string): ConversationPlanLibraryState {
  const settings = readSettingsObject(settingsFile);
  const ui = isRecord(settings.ui) ? settings.ui : {};
  const conversationAutomation = isRecord(ui.conversationAutomation) ? ui.conversationAutomation : {};
  const workflowPresets = isRecord(conversationAutomation.workflowPresets) ? conversationAutomation.workflowPresets : {};

  const presets = Array.isArray(workflowPresets.presets)
    ? workflowPresets.presets
        .map((preset, index) => {
          if (!isRecord(preset)) {
            return null;
          }

          const id = typeof preset.id === 'string' && preset.id.trim().length > 0
            ? preset.id.trim()
            : `preset-${index + 1}`;
          const name = typeof preset.name === 'string' && preset.name.trim().length > 0
            ? preset.name.trim()
            : `Preset ${index + 1}`;
          const updatedAt = normalizeTimestamp(preset.updatedAt, new Date(0).toISOString());
          const items = Array.isArray(preset.items)
            ? preset.items
                .map((item, itemIndex) => normalizeConversationPlanItem(item, itemIndex))
                .filter((item): item is ConversationPlanItemRecord => item !== null)
            : [];

          return { id, name, updatedAt, items };
        })
        .filter((preset): preset is ConversationPlanPresetRecord => preset !== null)
    : [];

  const presetIdSet = new Set(presets.map((preset) => preset.id));
  const defaultPresetIds = Array.isArray(workflowPresets.defaultPresetIds)
    ? workflowPresets.defaultPresetIds
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
        .filter((value, index, list) => list.indexOf(value) === index)
        .filter((value) => presetIdSet.has(value))
    : [];

  return { presets, defaultPresetIds };
}

export function writeConversationPlanLibrary(
  input: { presets?: unknown; defaultPresetIds?: unknown },
  settingsFile: string,
): ConversationPlanLibraryState {
  const settings = readSettingsObject(settingsFile);
  const ui = isRecord(settings.ui) ? { ...settings.ui } : {};
  const conversationAutomation = isRecord(ui.conversationAutomation) ? { ...ui.conversationAutomation } : {};
  const workflowPresets = isRecord(conversationAutomation.workflowPresets) ? { ...conversationAutomation.workflowPresets } : {};

  if (input.presets !== undefined) {
    workflowPresets.presets = Array.isArray(input.presets)
      ? input.presets
          .map((preset, index) => {
            if (!isRecord(preset)) {
              return null;
            }

            const id = typeof preset.id === 'string' && preset.id.trim().length > 0
              ? preset.id.trim()
              : `preset-${index + 1}`;
            const name = typeof preset.name === 'string' && preset.name.trim().length > 0
              ? preset.name.trim()
              : `Preset ${index + 1}`;
            const updatedAt = normalizeTimestamp(preset.updatedAt, new Date().toISOString());
            const items = Array.isArray(preset.items)
              ? preset.items
                  .map((item, itemIndex) => normalizeConversationPlanItem(item, itemIndex))
                  .filter((item): item is ConversationPlanItemRecord => item !== null)
              : [];

            return { id, name, updatedAt, items };
          })
          .filter((preset): preset is ConversationPlanPresetRecord => preset !== null)
      : [];
  }

  if (input.defaultPresetIds !== undefined) {
    const presetIdSet = new Set(
      Array.isArray(workflowPresets.presets)
        ? workflowPresets.presets
            .filter((preset): preset is ConversationPlanPresetRecord => (
              isRecord(preset)
              && typeof preset.id === 'string'
              && typeof preset.name === 'string'
              && typeof preset.updatedAt === 'string'
              && Array.isArray(preset.items)
            ))
            .map((preset) => preset.id)
        : [],
    );
    workflowPresets.defaultPresetIds = Array.isArray(input.defaultPresetIds)
      ? input.defaultPresetIds
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map((value) => value.trim())
          .filter((value, index, list) => list.indexOf(value) === index)
          .filter((value) => presetIdSet.has(value))
      : [];
  }

  conversationAutomation.workflowPresets = workflowPresets;
  ui.conversationAutomation = conversationAutomation;
  settings.ui = ui;
  writeSettingsObject(settingsFile, settings);
  return readConversationPlanLibrary(settingsFile);
}

export function readConversationPlansWorkspace(settingsFile: string): ConversationPlanWorkspaceState {
  return {
    ...readConversationPlanDefaults(settingsFile),
    presetLibrary: readConversationPlanLibrary(settingsFile),
  };
}

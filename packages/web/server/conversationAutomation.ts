import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getStateRoot, validateConversationId } from '@personal-agent/core';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ITEM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DOCUMENT_VERSION = 3 as const;
const MAX_REVIEW_ITEMS_PER_APPEND = 10;

export type ConversationAutomationTodoItemStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ConversationAutomationReviewStatus = 'pending' | 'running' | 'completed' | 'failed';

interface ConversationAutomationRuntimeFields {
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultReason?: string;
}

export interface ConversationAutomationTemplateTodoItem {
  id: string;
  label: string;
  skillName: string;
  skillArgs?: string;
}

export interface ConversationAutomationTodoItem extends ConversationAutomationRuntimeFields {
  id: string;
  label: string;
  skillName: string;
  skillArgs?: string;
  status: ConversationAutomationTodoItemStatus;
}

export interface ConversationAutomationReviewState extends ConversationAutomationRuntimeFields {
  status: ConversationAutomationReviewStatus;
  round: number;
}

export interface ConversationAutomationDocument {
  version: 3;
  conversationId: string;
  updatedAt: string;
  enabled: boolean;
  activeItemId?: string;
  items: ConversationAutomationTodoItem[];
  review?: ConversationAutomationReviewState;
}

export interface ConversationAutomationWorkflowPreset {
  id: string;
  name: string;
  updatedAt: string;
  items: ConversationAutomationTemplateTodoItem[];
}

export interface ConversationAutomationWorkflowPresetLibraryState {
  presets: ConversationAutomationWorkflowPreset[];
  defaultPresetIds: string[];
}

export interface ConversationAutomationPreferencesState {
  defaultEnabled: boolean;
}

export interface LoadedConversationAutomationState {
  document: ConversationAutomationDocument;
  inheritedPresetIds: string[];
  presetLibrary: ConversationAutomationWorkflowPresetLibraryState;
}

export interface ResolveConversationAutomationOptions {
  profile: string;
  stateRoot?: string;
}

export interface ResolveConversationAutomationPathOptions extends ResolveConversationAutomationOptions {
  conversationId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = readNonEmptyString(value);
  return normalized || undefined;
}

function normalizeOptionalSingleLineText(value: unknown): string | undefined {
  const normalized = normalizeOptionalText(value)?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(Date.parse(value)).toISOString();
  }

  return fallback;
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}".`);
  }
}

function validateItemId(id: string): void {
  if (!ITEM_ID_PATTERN.test(id)) {
    throw new Error(`Invalid automation id "${id}".`);
  }
}

function getConversationAutomationStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!settingsFile || !existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function readWebUiSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.webUi) ? { ...settings.webUi } : {};
}

function readConversationAutomationSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const webUi = readWebUiSettings(settings);
  return isRecord(webUi.conversationAutomation) ? { ...webUi.conversationAutomation } : {};
}

function writeSettingsObject(settingsFile: string, settings: Record<string, unknown>): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
}

export function resolveProfileConversationAutomationDir(options: ResolveConversationAutomationOptions): string {
  validateProfileName(options.profile);
  return join(
    getConversationAutomationStateRoot(options.stateRoot),
    'pi-agent',
    'state',
    'conversation-automation',
    options.profile,
  );
}

export function resolveConversationAutomationPath(options: ResolveConversationAutomationPathOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationAutomationDir(options), `${options.conversationId}.json`);
}

export function conversationAutomationDocumentExists(options: ResolveConversationAutomationPathOptions): boolean {
  return existsSync(resolveConversationAutomationPath(options));
}

function createAutomationId(prefix: 'item' | 'preset', now = new Date()): string {
  return `${prefix}-${now.toISOString().replace(/[.:TZ-]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createConversationAutomationTodoItemId(now = new Date()): string {
  return createAutomationId('item', now);
}

export function createConversationAutomationWorkflowPresetId(now = new Date()): string {
  return createAutomationId('preset', now);
}

function cloneTemplateItemsForConversation(items: ConversationAutomationTemplateTodoItem[]): ConversationAutomationTemplateTodoItem[] {
  return items.map((item) => ({
    ...item,
    id: createConversationAutomationTodoItemId(),
  }));
}

function normalizeTemplateTodoItem(value: unknown, fallbackNow: string): ConversationAutomationTemplateTodoItem {
  if (!isRecord(value)) {
    throw new Error('Automation item must be an object.');
  }

  const id = readNonEmptyString(value.id) || createConversationAutomationTodoItemId(new Date(fallbackNow));
  validateItemId(id);
  const skillName = readNonEmptyString(value.skillName);
  if (!skillName) {
    throw new Error(`Automation item ${id} is missing skillName.`);
  }

  return {
    id,
    label: normalizeOptionalText(value.label) ?? skillName,
    skillName,
    ...(normalizeOptionalSingleLineText(value.skillArgs) ? { skillArgs: normalizeOptionalSingleLineText(value.skillArgs) } : {}),
  };
}

function flattenLegacyGateItems(gates: unknown, fallbackNow: string): ConversationAutomationTemplateTodoItem[] {
  if (!Array.isArray(gates)) {
    return [];
  }

  return gates.flatMap((gate) => {
    if (!isRecord(gate) || !Array.isArray(gate.skills)) {
      return [];
    }

    return gate.skills.map((skill) => normalizeTemplateTodoItem(skill, fallbackNow));
  });
}

function normalizeRuntimeFields(value: Record<string, unknown>, fallbackNow: string): ConversationAutomationRuntimeFields {
  return {
    createdAt: normalizeIsoTimestamp(value.createdAt, fallbackNow),
    updatedAt: normalizeIsoTimestamp(value.updatedAt, fallbackNow),
    ...(normalizeOptionalText(value.startedAt) ? { startedAt: normalizeIsoTimestamp(value.startedAt, fallbackNow) } : {}),
    ...(normalizeOptionalText(value.completedAt) ? { completedAt: normalizeIsoTimestamp(value.completedAt, fallbackNow) } : {}),
    ...(normalizeOptionalText(value.resultReason) ? { resultReason: normalizeOptionalText(value.resultReason) } : {}),
  };
}

function normalizeTodoItemStatus(value: unknown): ConversationAutomationTodoItemStatus {
  const normalized = readNonEmptyString(value);
  return normalized === 'running' || normalized === 'completed' || normalized === 'failed'
    ? normalized
    : 'pending';
}

function normalizeReviewStatus(value: unknown): ConversationAutomationReviewStatus {
  const normalized = readNonEmptyString(value);
  return normalized === 'running' || normalized === 'completed' || normalized === 'failed'
    ? normalized
    : 'pending';
}

function normalizeRuntimeTodoItem(value: unknown, fallbackNow: string): ConversationAutomationTodoItem {
  const template = normalizeTemplateTodoItem(value, fallbackNow);
  const record = value as Record<string, unknown>;

  return {
    ...template,
    ...normalizeRuntimeFields(record, fallbackNow),
    status: normalizeTodoItemStatus(record.status),
  };
}

function normalizeRuntimeReviewState(value: unknown, fallbackNow: string): ConversationAutomationReviewState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ...normalizeRuntimeFields(value, fallbackNow),
    status: normalizeReviewStatus(value.status),
    round: typeof value.round === 'number' && Number.isFinite(value.round) && value.round > 0 ? Math.floor(value.round) : 1,
  };
}

function flattenLegacyDocumentItems(record: Record<string, unknown>, fallbackNow: string): ConversationAutomationTodoItem[] {
  if (Array.isArray(record.items)) {
    return record.items.map((item) => normalizeRuntimeTodoItem(item, fallbackNow));
  }

  if (Array.isArray(record.gates)) {
    return record.gates.flatMap((gate) => {
      if (!isRecord(gate) || !Array.isArray(gate.skills)) {
        return [];
      }
      return gate.skills.map((skill) => normalizeRuntimeTodoItem(skill, fallbackNow));
    });
  }

  if (Array.isArray(record.steps)) {
    return record.steps.flatMap((step) => {
      if (!isRecord(step) || readNonEmptyString(step.kind) !== 'skill') {
        return [];
      }
      return [normalizeRuntimeTodoItem(step, fallbackNow)];
    });
  }

  return [];
}

function normalizeDocument(value: unknown, fallbackConversationId: string): ConversationAutomationDocument {
  const fallbackNow = new Date().toISOString();
  const record = isRecord(value) ? value : {};
  const conversationId = readNonEmptyString(record.conversationId) || fallbackConversationId;
  validateConversationId(conversationId);

  const items = flattenLegacyDocumentItems(record, fallbackNow);
  const activeItemId = normalizeOptionalText(record.activeItemId) ?? normalizeOptionalText(record.activeSkillId);
  const safeActiveItemId = activeItemId && items.some((item) => item.id === activeItemId)
    ? activeItemId
    : undefined;

  for (const item of items) {
    const itemIsActive = item.id === safeActiveItemId;
    if (!itemIsActive && item.status === 'running') {
      item.status = item.completedAt ? 'failed' : 'pending';
      item.updatedAt = fallbackNow;
      delete item.startedAt;
      delete item.completedAt;
      delete item.resultReason;
    }
  }

  const review = normalizeRuntimeReviewState(record.review, fallbackNow);
  const safeReview = review?.status === 'running' && safeActiveItemId
    ? { ...review, status: 'pending' as const, updatedAt: fallbackNow, startedAt: undefined }
    : review;

  return {
    version: DOCUMENT_VERSION,
    conversationId,
    updatedAt: normalizeIsoTimestamp(record.updatedAt, fallbackNow),
    enabled: record.enabled === true || (!(record as { paused?: boolean }).paused && record.enabled !== false && items.length > 0 && record.version === 1),
    ...(safeActiveItemId ? { activeItemId: safeActiveItemId } : {}),
    items,
    ...(safeReview ? { review: safeReview } : {}),
  };
}

export function createConversationAutomationTodoItem(input: {
  id?: string;
  label?: string;
  skillName: string;
  skillArgs?: string;
  now?: string;
}): ConversationAutomationTodoItem {
  const createdAt = normalizeIsoTimestamp(input.now, new Date().toISOString());
  const skillName = readNonEmptyString(input.skillName);
  if (!skillName) {
    throw new Error('skillName is required.');
  }

  const id = readNonEmptyString(input.id) || createConversationAutomationTodoItemId(new Date(createdAt));
  validateItemId(id);

  return {
    id,
    label: normalizeOptionalText(input.label) ?? skillName,
    skillName,
    ...(normalizeOptionalSingleLineText(input.skillArgs) ? { skillArgs: normalizeOptionalSingleLineText(input.skillArgs) } : {}),
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
  };
}

export function buildConversationAutomationSkillPrompt(item: Pick<ConversationAutomationTemplateTodoItem, 'skillName' | 'skillArgs'>): string {
  const skillName = readNonEmptyString(item.skillName);
  if (!skillName) {
    throw new Error('skillName is required.');
  }

  const skillArgs = normalizeOptionalSingleLineText(item.skillArgs);
  return skillArgs ? `/skill:${skillName} ${skillArgs}` : `/skill:${skillName}`;
}

function normalizeLegacyDefaultWorkflowPreset(settings: Record<string, unknown>): ConversationAutomationWorkflowPresetLibraryState {
  const automationSettings = readConversationAutomationSettings(settings);
  const defaultWorkflow = isRecord(automationSettings.defaultWorkflow)
    ? automationSettings.defaultWorkflow
    : null;

  if (!defaultWorkflow) {
    return {
      presets: [],
      defaultPresetIds: [],
    };
  }

  const fallbackNow = new Date().toISOString();
  const items = Array.isArray(defaultWorkflow.items)
    ? defaultWorkflow.items.map((item) => normalizeTemplateTodoItem(item, fallbackNow))
    : flattenLegacyGateItems(defaultWorkflow.gates, fallbackNow);

  if (items.length === 0) {
    return {
      presets: [],
      defaultPresetIds: [],
    };
  }

  const presetId = 'preset-default';
  return {
    presets: [{
      id: presetId,
      name: 'Default workflow',
      updatedAt: normalizeIsoTimestamp(defaultWorkflow.updatedAt, fallbackNow),
      items,
    }],
    defaultPresetIds: [presetId],
  };
}

function normalizeWorkflowPreset(value: unknown, fallbackNow: string): ConversationAutomationWorkflowPreset {
  if (!isRecord(value)) {
    throw new Error('Automation workflow preset must be an object.');
  }

  const id = readNonEmptyString(value.id) || createConversationAutomationWorkflowPresetId(new Date(fallbackNow));
  validateItemId(id);
  const name = normalizeOptionalText(value.name) ?? 'Workflow preset';
  const items = Array.isArray(value.items)
    ? value.items.map((item) => normalizeTemplateTodoItem(item, fallbackNow))
    : flattenLegacyGateItems(value.gates, fallbackNow);

  return {
    id,
    name,
    updatedAt: normalizeIsoTimestamp(value.updatedAt, fallbackNow),
    items,
  };
}

function normalizeWorkflowPresetLibraryState(settings: Record<string, unknown>): ConversationAutomationWorkflowPresetLibraryState {
  const automationSettings = readConversationAutomationSettings(settings);
  const presetLibrary = isRecord(automationSettings.workflowPresets)
    ? automationSettings.workflowPresets
    : null;

  if (!presetLibrary) {
    return normalizeLegacyDefaultWorkflowPreset(settings);
  }

  const fallbackNow = new Date().toISOString();
  const presets = Array.isArray(presetLibrary.presets)
    ? presetLibrary.presets.map((preset) => normalizeWorkflowPreset(preset, fallbackNow))
    : [];
  const rawDefaultPresetIds = Array.isArray(presetLibrary.defaultPresetIds)
    ? presetLibrary.defaultPresetIds
    : (normalizeOptionalText(presetLibrary.defaultPresetId) ? [normalizeOptionalText(presetLibrary.defaultPresetId)] : []);
  const validDefaultPresetIds = [...new Set(rawDefaultPresetIds
    .map((presetId) => normalizeOptionalText(presetId))
    .filter((presetId): presetId is string => Boolean(presetId && presets.some((preset) => preset.id === presetId))))];

  return {
    presets,
    defaultPresetIds: validDefaultPresetIds,
  };
}

export function readSavedConversationAutomationPreferences(settingsFile: string): ConversationAutomationPreferencesState {
  const automationSettings = readConversationAutomationSettings(readSettingsObject(settingsFile));
  return {
    defaultEnabled: readBoolean(automationSettings.defaultEnabled, false),
  };
}

export function readSavedConversationAutomationWorkflowPresets(settingsFile: string): ConversationAutomationWorkflowPresetLibraryState {
  return normalizeWorkflowPresetLibraryState(readSettingsObject(settingsFile));
}

export function writeSavedConversationAutomationPreferences(
  input: { defaultEnabled?: boolean },
  settingsFile: string,
): ConversationAutomationPreferencesState {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);
  const automationSettings = readConversationAutomationSettings(settings);

  if (input.defaultEnabled !== undefined) {
    if (input.defaultEnabled) {
      automationSettings.defaultEnabled = true;
    } else {
      delete automationSettings.defaultEnabled;
    }
  }

  if (Object.keys(automationSettings).length > 0) {
    webUi.conversationAutomation = automationSettings;
  } else {
    delete webUi.conversationAutomation;
  }

  if (Object.keys(webUi).length > 0) {
    settings.webUi = webUi;
  } else {
    delete settings.webUi;
  }

  writeSettingsObject(settingsFile, settings);
  return readSavedConversationAutomationPreferences(settingsFile);
}

export function writeSavedConversationAutomationWorkflowPresets(
  input: {
    presets: ConversationAutomationWorkflowPreset[];
    defaultPresetIds: string[];
  },
  settingsFile: string,
): ConversationAutomationWorkflowPresetLibraryState {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);
  const automationSettings = readConversationAutomationSettings(settings);
  const now = new Date().toISOString();
  const presets = input.presets.map((preset) => normalizeWorkflowPreset({
    ...preset,
    updatedAt: now,
  }, now));
  const defaultPresetIds = [...new Set((Array.isArray(input.defaultPresetIds) ? input.defaultPresetIds : [])
    .map((presetId) => normalizeOptionalText(presetId))
    .filter((presetId): presetId is string => Boolean(presetId && presets.some((preset) => preset.id === presetId))))];

  delete automationSettings.defaultWorkflow;

  if (presets.length > 0) {
    automationSettings.workflowPresets = {
      presets,
      ...(defaultPresetIds.length > 0 ? { defaultPresetIds } : {}),
    };
  } else {
    delete automationSettings.workflowPresets;
  }

  if (Object.keys(automationSettings).length > 0) {
    webUi.conversationAutomation = automationSettings;
  } else {
    delete webUi.conversationAutomation;
  }

  if (Object.keys(webUi).length > 0) {
    settings.webUi = webUi;
  } else {
    delete settings.webUi;
  }

  writeSettingsObject(settingsFile, settings);
  return normalizeWorkflowPresetLibraryState(settings);
}

function buildDocumentFromTemplate(
  conversationId: string,
  items: ConversationAutomationTemplateTodoItem[],
  now = new Date().toISOString(),
  enabled = false,
): ConversationAutomationDocument {
  return {
    version: DOCUMENT_VERSION,
    conversationId,
    updatedAt: now,
    enabled,
    items: items.map((item) => createConversationAutomationTodoItem({
      ...item,
      now,
    })),
  };
}

export function readConversationAutomationDocument(path: string, conversationId: string): ConversationAutomationDocument {
  return normalizeDocument(JSON.parse(readFileSync(path, 'utf-8')) as unknown, conversationId);
}

export function loadConversationAutomationState(options: ResolveConversationAutomationPathOptions & { settingsFile?: string }): LoadedConversationAutomationState {
  const preferences = options.settingsFile
    ? readSavedConversationAutomationPreferences(options.settingsFile)
    : { defaultEnabled: false } satisfies ConversationAutomationPreferencesState;
  const presetLibrary = options.settingsFile
    ? readSavedConversationAutomationWorkflowPresets(options.settingsFile)
    : { presets: [], defaultPresetIds: [] } satisfies ConversationAutomationWorkflowPresetLibraryState;
  const inheritedPresets = presetLibrary.defaultPresetIds
    .map((presetId) => presetLibrary.presets.find((preset) => preset.id === presetId) ?? null)
    .filter((preset): preset is ConversationAutomationWorkflowPreset => Boolean(preset));
  const path = resolveConversationAutomationPath(options);

  if (!existsSync(path)) {
    return {
      document: inheritedPresets.length > 0
        ? buildDocumentFromTemplate(
          options.conversationId,
          inheritedPresets.flatMap((preset) => cloneTemplateItemsForConversation(preset.items)),
          undefined,
          preferences.defaultEnabled,
        )
        : normalizeDocument(undefined, options.conversationId),
      inheritedPresetIds: inheritedPresets.map((preset) => preset.id),
      presetLibrary,
    };
  }

  return {
    document: readConversationAutomationDocument(path, options.conversationId),
    inheritedPresetIds: [],
    presetLibrary,
  };
}

export function getConversationAutomationState(options: ResolveConversationAutomationPathOptions): ConversationAutomationDocument {
  const path = resolveConversationAutomationPath(options);
  if (!existsSync(path)) {
    return normalizeDocument(undefined, options.conversationId);
  }

  return readConversationAutomationDocument(path, options.conversationId);
}

export function writeConversationAutomationState(options: {
  profile: string;
  stateRoot?: string;
  document: ConversationAutomationDocument;
}): ConversationAutomationDocument {
  const normalized = normalizeDocument(options.document, options.document.conversationId);
  const path = resolveConversationAutomationPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: normalized.conversationId,
  });

  mkdirSync(resolveProfileConversationAutomationDir({ stateRoot: options.stateRoot, profile: options.profile }), { recursive: true });
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n');
  return normalized;
}

export function templateTodoItemFromRuntimeItem(item: ConversationAutomationTodoItem): ConversationAutomationTemplateTodoItem {
  return {
    id: item.id,
    label: item.label,
    skillName: item.skillName,
    ...(item.skillArgs ? { skillArgs: item.skillArgs } : {}),
  };
}

export function replaceConversationAutomationItems(
  document: ConversationAutomationDocument,
  items: ConversationAutomationTemplateTodoItem[],
  now = new Date().toISOString(),
): ConversationAutomationDocument {
  const updatedAt = normalizeIsoTimestamp(now, new Date().toISOString());
  const existingItemMap = new Map(document.items.map((item) => [item.id, item]));

  const nextItems = items.map((inputItem) => {
    const template = normalizeTemplateTodoItem(inputItem, updatedAt);
    const existingItem = existingItemMap.get(template.id);

    return {
      id: template.id,
      label: template.label,
      skillName: template.skillName,
      ...(template.skillArgs ? { skillArgs: template.skillArgs } : {}),
      status: 'pending' as const,
      createdAt: existingItem?.createdAt ?? updatedAt,
      updatedAt,
    } satisfies ConversationAutomationTodoItem;
  });

  return {
    ...document,
    items: nextItems,
    updatedAt,
    activeItemId: undefined,
    review: undefined,
  };
}

export function appendConversationAutomationItems(
  document: ConversationAutomationDocument,
  items: ConversationAutomationTemplateTodoItem[],
  now = new Date().toISOString(),
): ConversationAutomationDocument {
  const updatedAt = normalizeIsoTimestamp(now, new Date().toISOString());
  if (items.length === 0) {
    return {
      ...document,
      updatedAt,
      review: undefined,
    };
  }

  return {
    ...document,
    items: [
      ...document.items,
      ...items.map((item) => createConversationAutomationTodoItem({
        ...normalizeTemplateTodoItem(item, updatedAt),
        now: updatedAt,
      })),
    ],
    updatedAt,
    review: undefined,
  };
}

export function updateConversationAutomationEnabled(
  document: ConversationAutomationDocument,
  enabled: boolean,
  now = new Date().toISOString(),
): ConversationAutomationDocument {
  return {
    ...document,
    enabled,
    updatedAt: normalizeIsoTimestamp(now, new Date().toISOString()),
  };
}

export function resetConversationAutomationFromItem(
  document: ConversationAutomationDocument,
  itemId: string,
  options: { now?: string; enabled?: boolean } = {},
): ConversationAutomationDocument {
  const updatedAt = normalizeIsoTimestamp(options.now, new Date().toISOString());
  const index = document.items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    throw new Error(`Automation item not found: ${itemId}`);
  }

  return {
    ...document,
    items: document.items.map((item, itemIndex) => {
      if (itemIndex < index) {
        return item;
      }

      return {
        ...item,
        status: 'pending' as const,
        updatedAt,
        completedAt: undefined,
        startedAt: undefined,
        resultReason: undefined,
      };
    }),
    updatedAt,
    enabled: options.enabled ?? document.enabled,
    activeItemId: undefined,
    review: undefined,
  };
}

function buildTodoListLine(item: Pick<ConversationAutomationTodoItem, 'label' | 'skillName' | 'skillArgs' | 'status'>): string {
  const status = item.status === 'completed'
    ? '[x]'
    : item.status === 'running'
      ? '[>]'
      : item.status === 'failed'
        ? '[!]'
        : '[ ]';
  const prompt = buildConversationAutomationSkillPrompt(item);
  return `${status} ${item.label} — ${prompt}`;
}

export function buildConversationAutomationReviewPrompt(document: Pick<ConversationAutomationDocument, 'items' | 'review'>): string {
  const lines = document.items.length > 0
    ? document.items.map((item) => `- ${buildTodoListLine(item)}`)
    : ['- (no todo items)'];
  const round = Math.max(1, document.review?.round ?? 1);

  return [
    `Review the automation todo list before stopping. This is review round ${round}.`,
    'If additional automation work is required, include exactly one <automation-todos> block at the end of your response.',
    'Each item inside that block must be a <skill> tag with a required name attribute, an optional args attribute, and label text between the opening and closing tags.',
    'If nothing else is required, reply briefly without an <automation-todos> block.',
    '',
    'Todo list:',
    ...lines,
    '',
    'Example:',
    '<automation-todos>',
    '  <skill name="workflow-checkpoint" args="commit only my files">Checkpoint</skill>',
    '</automation-todos>',
  ].join('\n');
}

export function parseConversationAutomationTodoAppendBlock(text: string): ConversationAutomationTemplateTodoItem[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const blockMatch = normalized.match(/<automation-todos>([\s\S]*?)<\/automation-todos>/i);
  if (!blockMatch) {
    return [];
  }

  const blockBody = blockMatch[1] ?? '';
  const items: ConversationAutomationTemplateTodoItem[] = [];
  const skillPattern = /<skill\s+name="([^"]+)"(?:\s+args="([^"]*)")?\s*>([\s\S]*?)<\/skill>/gi;
  let match: RegExpExecArray | null;

  while ((match = skillPattern.exec(blockBody)) !== null) {
    const skillName = readNonEmptyString(match[1]);
    const label = readNonEmptyString(match[3]);
    if (!skillName) {
      continue;
    }

    items.push({
      id: createConversationAutomationTodoItemId(),
      label: label || skillName,
      skillName,
      ...(normalizeOptionalSingleLineText(match[2]) ? { skillArgs: normalizeOptionalSingleLineText(match[2]) } : {}),
    });

    if (items.length >= MAX_REVIEW_ITEMS_PER_APPEND) {
      break;
    }
  }

  return items;
}

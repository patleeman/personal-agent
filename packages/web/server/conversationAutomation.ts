import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getStateRoot, validateConversationId } from '@personal-agent/core';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ITEM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DOCUMENT_VERSION = 2 as const;
const DEFAULT_WORKFLOW_PROMPT = 'Always pass this migrated automation gate and continue the nested skills.';

export type ConversationAutomationSkillStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ConversationAutomationGateStatus = 'pending' | 'running' | 'completed' | 'failed';

interface ConversationAutomationRuntimeFields {
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultReason?: string;
  resultConfidence?: number;
}

export interface ConversationAutomationTemplateSkillStep {
  id: string;
  label: string;
  skillName: string;
  skillArgs?: string;
}

export interface ConversationAutomationTemplateGate {
  id: string;
  label: string;
  prompt: string;
  skills: ConversationAutomationTemplateSkillStep[];
}

export interface ConversationAutomationSkillStep extends ConversationAutomationRuntimeFields {
  id: string;
  label: string;
  skillName: string;
  skillArgs?: string;
  status: ConversationAutomationSkillStepStatus;
}

export interface ConversationAutomationGate extends ConversationAutomationRuntimeFields {
  id: string;
  label: string;
  prompt: string;
  status: ConversationAutomationGateStatus;
  skills: ConversationAutomationSkillStep[];
}

export interface ConversationAutomationDocument {
  version: 2;
  conversationId: string;
  updatedAt: string;
  enabled: boolean;
  activeGateId?: string;
  activeSkillId?: string;
  gates: ConversationAutomationGate[];
}

export interface ConversationAutomationWorkflowPreset {
  id: string;
  name: string;
  updatedAt: string;
  gates: ConversationAutomationTemplateGate[];
}

export interface ConversationAutomationWorkflowPresetLibraryState {
  presets: ConversationAutomationWorkflowPreset[];
  defaultPresetId: string | null;
}

export interface LoadedConversationAutomationState {
  document: ConversationAutomationDocument;
  inheritedPresetId: string | null;
  presetLibrary: ConversationAutomationWorkflowPresetLibraryState;
}

export interface ResolveConversationAutomationOptions {
  profile: string;
  stateRoot?: string;
}

export interface ResolveConversationAutomationPathOptions extends ResolveConversationAutomationOptions {
  conversationId: string;
}

interface LegacyConversationAutomationBaseStep extends ConversationAutomationRuntimeFields {
  id: string;
  kind: 'skill' | 'judge';
  label: string;
  status: ConversationAutomationSkillStepStatus;
}

interface LegacyConversationAutomationSkillStep extends LegacyConversationAutomationBaseStep {
  kind: 'skill';
  skillName: string;
  skillArgs?: string;
}

interface LegacyConversationAutomationJudgeStep extends LegacyConversationAutomationBaseStep {
  kind: 'judge';
  prompt: string;
}

type LegacyConversationAutomationStep = LegacyConversationAutomationSkillStep | LegacyConversationAutomationJudgeStep;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
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

function normalizeConfidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
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

function createAutomationId(prefix: 'gate' | 'skill' | 'preset', now = new Date()): string {
  return `${prefix}-${now.toISOString().replace(/[.:TZ-]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createConversationAutomationGateId(now = new Date()): string {
  return createAutomationId('gate', now);
}

export function createConversationAutomationSkillStepId(now = new Date()): string {
  return createAutomationId('skill', now);
}

export function createConversationAutomationWorkflowPresetId(now = new Date()): string {
  return createAutomationId('preset', now);
}

function normalizeTemplateSkillStep(value: unknown, fallbackNow: string): ConversationAutomationTemplateSkillStep {
  if (!isRecord(value)) {
    throw new Error('Automation skill must be an object.');
  }

  const id = readNonEmptyString(value.id) || createConversationAutomationSkillStepId(new Date(fallbackNow));
  validateItemId(id);
  const skillName = readNonEmptyString(value.skillName);
  if (!skillName) {
    throw new Error(`Automation skill ${id} is missing skillName.`);
  }

  return {
    id,
    label: normalizeOptionalText(value.label) ?? skillName,
    skillName,
    ...(normalizeOptionalSingleLineText(value.skillArgs) ? { skillArgs: normalizeOptionalSingleLineText(value.skillArgs) } : {}),
  };
}

function normalizeTemplateGate(value: unknown, fallbackNow: string): ConversationAutomationTemplateGate {
  if (!isRecord(value)) {
    throw new Error('Automation gate must be an object.');
  }

  const id = readNonEmptyString(value.id) || createConversationAutomationGateId(new Date(fallbackNow));
  validateItemId(id);
  const prompt = readNonEmptyString(value.prompt);
  if (!prompt) {
    throw new Error(`Automation gate ${id} is missing prompt.`);
  }

  const skills = Array.isArray(value.skills)
    ? value.skills.map((skill) => normalizeTemplateSkillStep(skill, fallbackNow))
    : [];

  return {
    id,
    label: normalizeOptionalText(value.label) ?? 'Judge gate',
    prompt,
    skills,
  };
}

function normalizeRuntimeFields(value: Record<string, unknown>, fallbackNow: string): ConversationAutomationRuntimeFields {
  return {
    createdAt: normalizeIsoTimestamp(value.createdAt, fallbackNow),
    updatedAt: normalizeIsoTimestamp(value.updatedAt, fallbackNow),
    ...(normalizeOptionalText(value.startedAt) ? { startedAt: normalizeIsoTimestamp(value.startedAt, fallbackNow) } : {}),
    ...(normalizeOptionalText(value.completedAt) ? { completedAt: normalizeIsoTimestamp(value.completedAt, fallbackNow) } : {}),
    ...(normalizeOptionalText(value.resultReason) ? { resultReason: normalizeOptionalText(value.resultReason) } : {}),
    ...(normalizeConfidence(value.resultConfidence) !== undefined ? { resultConfidence: normalizeConfidence(value.resultConfidence) } : {}),
  };
}

function normalizeSkillStatus(value: unknown): ConversationAutomationSkillStepStatus {
  const normalized = readNonEmptyString(value);
  return normalized === 'running' || normalized === 'completed' || normalized === 'failed'
    ? normalized
    : 'pending';
}

function normalizeGateStatus(value: unknown): ConversationAutomationGateStatus {
  const normalized = readNonEmptyString(value);
  return normalized === 'running' || normalized === 'completed' || normalized === 'failed'
    ? normalized
    : 'pending';
}

function normalizeRuntimeSkillStep(value: unknown, fallbackNow: string): ConversationAutomationSkillStep {
  const template = normalizeTemplateSkillStep(value, fallbackNow);
  const record = value as Record<string, unknown>;

  return {
    ...template,
    ...normalizeRuntimeFields(record, fallbackNow),
    status: normalizeSkillStatus(record.status),
  };
}

function normalizeRuntimeGate(value: unknown, fallbackNow: string): ConversationAutomationGate {
  const template = normalizeTemplateGate(value, fallbackNow);
  const record = value as Record<string, unknown>;

  return {
    ...template,
    skills: Array.isArray(record.skills)
      ? record.skills.map((skill) => normalizeRuntimeSkillStep(skill, fallbackNow))
      : [],
    ...normalizeRuntimeFields(record, fallbackNow),
    status: normalizeGateStatus(record.status),
  };
}

function normalizeLegacyBaseStep(
  value: Record<string, unknown>,
  kind: 'skill' | 'judge',
  fallbackNow: string,
): LegacyConversationAutomationBaseStep {
  const id = readNonEmptyString(value.id);
  validateItemId(id);
  const label = readNonEmptyString(value.label);
  if (!label) {
    throw new Error(`Automation step ${id} is missing a label.`);
  }

  return {
    id,
    kind,
    label,
    status: normalizeSkillStatus(value.status),
    ...normalizeRuntimeFields(value, fallbackNow),
  };
}

function normalizeLegacyStep(value: unknown, fallbackNow: string): LegacyConversationAutomationStep {
  if (!isRecord(value)) {
    throw new Error('Legacy automation step must be an object.');
  }

  const kind = readNonEmptyString(value.kind);
  if (kind === 'skill') {
    const base = normalizeLegacyBaseStep(value, 'skill', fallbackNow);
    const skillName = readNonEmptyString(value.skillName);
    if (!skillName) {
      throw new Error(`Automation step ${base.id} is missing skillName.`);
    }

    return {
      ...base,
      kind: 'skill',
      skillName,
      ...(normalizeOptionalSingleLineText(value.skillArgs) ? { skillArgs: normalizeOptionalSingleLineText(value.skillArgs) } : {}),
    };
  }

  if (kind === 'judge') {
    const base = normalizeLegacyBaseStep(value, 'judge', fallbackNow);
    const prompt = readNonEmptyString(value.prompt);
    if (!prompt) {
      throw new Error(`Automation step ${base.id} is missing prompt.`);
    }

    return {
      ...base,
      kind: 'judge',
      prompt,
    };
  }

  throw new Error(`Unsupported automation step kind: ${String(value.kind)}`);
}

function clearGateRuntime(gate: ConversationAutomationGate): void {
  delete gate.startedAt;
  delete gate.completedAt;
  delete gate.resultReason;
  delete gate.resultConfidence;
}

function clearSkillRuntime(skill: ConversationAutomationSkillStep): void {
  delete skill.startedAt;
  delete skill.completedAt;
  delete skill.resultReason;
  delete skill.resultConfidence;
}

function resetGateForPending(gate: ConversationAutomationGate, updatedAt: string): ConversationAutomationGate {
  const nextGate: ConversationAutomationGate = {
    ...gate,
    updatedAt,
    status: 'pending',
    skills: gate.skills.map((skill) => ({
      ...skill,
      updatedAt,
      status: 'pending',
    })),
  };
  clearGateRuntime(nextGate);
  for (const skill of nextGate.skills) {
    clearSkillRuntime(skill);
  }
  return nextGate;
}

function createSyntheticLegacyGate(now: string): ConversationAutomationGate {
  return {
    id: createConversationAutomationGateId(new Date(now)),
    label: 'Migrated gate',
    prompt: DEFAULT_WORKFLOW_PROMPT,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    skills: [],
  };
}

function migrateLegacyDocument(record: Record<string, unknown>, fallbackConversationId: string, fallbackNow: string): ConversationAutomationDocument {
  const conversationId = readNonEmptyString(record.conversationId) || fallbackConversationId;
  validateConversationId(conversationId);

  const activeStepId = normalizeOptionalText(record.activeStepId);
  const steps = Array.isArray(record.steps)
    ? record.steps.map((step) => normalizeLegacyStep(step, fallbackNow))
    : [];

  const gates: ConversationAutomationGate[] = [];
  let currentGate: ConversationAutomationGate | null = null;
  let activeGateId: string | undefined;
  let activeSkillId: string | undefined;

  for (const step of steps) {
    if (step.kind === 'judge') {
      currentGate = {
        id: step.id,
        label: step.label,
        prompt: step.prompt,
        status: step.status === 'completed' ? 'completed' : step.status,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        ...(step.startedAt ? { startedAt: step.startedAt } : {}),
        ...(step.completedAt ? { completedAt: step.completedAt } : {}),
        ...(step.resultReason ? { resultReason: step.resultReason } : {}),
        ...(typeof step.resultConfidence === 'number' ? { resultConfidence: step.resultConfidence } : {}),
        skills: [],
      };
      if (activeStepId === step.id) {
        activeGateId = step.id;
      }
      gates.push(currentGate);
      continue;
    }

    if (!currentGate) {
      currentGate = createSyntheticLegacyGate(step.createdAt);
      gates.push(currentGate);
    }

    currentGate.skills.push({
      id: step.id,
      label: step.label,
      skillName: step.skillName,
      ...(step.skillArgs ? { skillArgs: step.skillArgs } : {}),
      status: step.status,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
      ...(step.startedAt ? { startedAt: step.startedAt } : {}),
      ...(step.completedAt ? { completedAt: step.completedAt } : {}),
      ...(step.resultReason ? { resultReason: step.resultReason } : {}),
      ...(typeof step.resultConfidence === 'number' ? { resultConfidence: step.resultConfidence } : {}),
    });

    if (activeStepId === step.id) {
      activeGateId = currentGate.id;
      activeSkillId = step.id;
    }
  }

  for (const gate of gates) {
    const hasRunningSkill = gate.skills.some((skill) => skill.status === 'running');
    const hasFailedSkill = gate.skills.some((skill) => skill.status === 'failed');
    const hasPendingSkill = gate.skills.some((skill) => skill.status === 'pending');
    const allCompleted = gate.skills.length > 0 && gate.skills.every((skill) => skill.status === 'completed');

    if (activeGateId === gate.id || hasRunningSkill) {
      gate.status = 'running';
      continue;
    }

    if (hasFailedSkill) {
      gate.status = 'failed';
      continue;
    }

    if (allCompleted) {
      gate.status = 'completed';
      continue;
    }

    if (hasPendingSkill && (gate.status === 'completed' || gate.status === 'running')) {
      gate.status = 'running';
      continue;
    }

    if (hasPendingSkill) {
      gate.status = 'pending';
    }
  }

  return {
    version: DOCUMENT_VERSION,
    conversationId,
    updatedAt: normalizeIsoTimestamp(record.updatedAt, fallbackNow),
    enabled: !(record.paused === true),
    ...(activeGateId ? { activeGateId } : {}),
    ...(activeSkillId ? { activeSkillId } : {}),
    gates,
  };
}

function normalizeDocument(value: unknown, fallbackConversationId: string): ConversationAutomationDocument {
  const fallbackNow = new Date().toISOString();
  const record = isRecord(value) ? value : {};

  if (Array.isArray(record.steps) || record.version === 1) {
    return migrateLegacyDocument(record, fallbackConversationId, fallbackNow);
  }

  const conversationId = readNonEmptyString(record.conversationId) || fallbackConversationId;
  validateConversationId(conversationId);

  const gates = Array.isArray(record.gates)
    ? record.gates.map((gate) => normalizeRuntimeGate(gate, fallbackNow))
    : [];

  const activeGateId = normalizeOptionalText(record.activeGateId);
  const activeSkillId = normalizeOptionalText(record.activeSkillId);
  const normalizedGateIds = new Set(gates.map((gate) => gate.id));
  const safeActiveGateId = activeGateId && normalizedGateIds.has(activeGateId) ? activeGateId : undefined;
  const safeActiveSkillId = safeActiveGateId && activeSkillId
    ? gates.find((gate) => gate.id === safeActiveGateId)?.skills.find((skill) => skill.id === activeSkillId)?.id
    : undefined;

  for (const gate of gates) {
    const gateIsActive = gate.id === safeActiveGateId;
    if (!gateIsActive && gate.status === 'running') {
      gate.status = gate.skills.some((skill) => skill.status === 'completed') ? 'failed' : 'pending';
      gate.updatedAt = fallbackNow;
      clearGateRuntime(gate);
    }

    for (const skill of gate.skills) {
      const skillIsActive = gateIsActive && skill.id === safeActiveSkillId;
      if (!skillIsActive && skill.status === 'running') {
        skill.status = 'pending';
        skill.updatedAt = fallbackNow;
        clearSkillRuntime(skill);
      }
    }
  }

  return {
    version: DOCUMENT_VERSION,
    conversationId,
    updatedAt: normalizeIsoTimestamp(record.updatedAt, fallbackNow),
    enabled: record.enabled === true,
    ...(safeActiveGateId ? { activeGateId: safeActiveGateId } : {}),
    ...(safeActiveSkillId ? { activeSkillId: safeActiveSkillId } : {}),
    gates,
  };
}

export function createConversationAutomationSkillStep(input: {
  id?: string;
  label?: string;
  skillName: string;
  skillArgs?: string;
  now?: string;
}): ConversationAutomationSkillStep {
  const createdAt = normalizeIsoTimestamp(input.now, new Date().toISOString());
  const skillName = readNonEmptyString(input.skillName);
  if (!skillName) {
    throw new Error('skillName is required.');
  }

  const id = readNonEmptyString(input.id) || createConversationAutomationSkillStepId(new Date(createdAt));
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

export function createConversationAutomationGate(input: {
  id?: string;
  label?: string;
  prompt: string;
  skills?: ConversationAutomationTemplateSkillStep[];
  now?: string;
}): ConversationAutomationGate {
  const createdAt = normalizeIsoTimestamp(input.now, new Date().toISOString());
  const prompt = readNonEmptyString(input.prompt);
  if (!prompt) {
    throw new Error('prompt is required.');
  }

  const id = readNonEmptyString(input.id) || createConversationAutomationGateId(new Date(createdAt));
  validateItemId(id);

  return {
    id,
    label: normalizeOptionalText(input.label) ?? 'Judge gate',
    prompt,
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
    skills: (input.skills ?? []).map((skill) => createConversationAutomationSkillStep({
      ...skill,
      now: createdAt,
    })),
  };
}

export function buildConversationAutomationSkillPrompt(step: Pick<ConversationAutomationTemplateSkillStep, 'skillName' | 'skillArgs'>): string {
  const skillName = readNonEmptyString(step.skillName);
  if (!skillName) {
    throw new Error('skillName is required.');
  }

  const skillArgs = normalizeOptionalSingleLineText(step.skillArgs);
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
      defaultPresetId: null,
    };
  }

  const fallbackNow = new Date().toISOString();
  const gates = Array.isArray(defaultWorkflow.gates)
    ? defaultWorkflow.gates.map((gate) => normalizeTemplateGate(gate, fallbackNow))
    : [];

  if (gates.length === 0) {
    return {
      presets: [],
      defaultPresetId: null,
    };
  }

  const presetId = 'preset-default';
  return {
    presets: [{
      id: presetId,
      name: 'Default workflow',
      updatedAt: normalizeIsoTimestamp(defaultWorkflow.updatedAt, fallbackNow),
      gates,
    }],
    defaultPresetId: presetId,
  };
}

function normalizeWorkflowPreset(value: unknown, fallbackNow: string): ConversationAutomationWorkflowPreset {
  if (!isRecord(value)) {
    throw new Error('Automation workflow preset must be an object.');
  }

  const id = readNonEmptyString(value.id) || createConversationAutomationWorkflowPresetId(new Date(fallbackNow));
  validateItemId(id);
  const name = normalizeOptionalText(value.name) ?? 'Workflow preset';
  const gates = Array.isArray(value.gates)
    ? value.gates.map((gate) => normalizeTemplateGate(gate, fallbackNow))
    : [];

  return {
    id,
    name,
    updatedAt: normalizeIsoTimestamp(value.updatedAt, fallbackNow),
    gates,
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
  const defaultPresetId = normalizeOptionalText(presetLibrary.defaultPresetId);
  const validDefaultPresetId = defaultPresetId && presets.some((preset) => preset.id === defaultPresetId)
    ? defaultPresetId
    : null;

  return {
    presets,
    defaultPresetId: validDefaultPresetId,
  };
}

export function readSavedConversationAutomationWorkflowPresets(settingsFile: string): ConversationAutomationWorkflowPresetLibraryState {
  return normalizeWorkflowPresetLibraryState(readSettingsObject(settingsFile));
}

export function writeSavedConversationAutomationWorkflowPresets(
  input: {
    presets: ConversationAutomationWorkflowPreset[];
    defaultPresetId: string | null;
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
  const defaultPresetId = normalizeOptionalText(input.defaultPresetId);

  delete automationSettings.defaultWorkflow;

  if (presets.length > 0) {
    automationSettings.workflowPresets = {
      presets,
      ...(defaultPresetId && presets.some((preset) => preset.id === defaultPresetId)
        ? { defaultPresetId }
        : {}),
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
  gates: ConversationAutomationTemplateGate[],
  now = new Date().toISOString(),
): ConversationAutomationDocument {
  return {
    version: DOCUMENT_VERSION,
    conversationId,
    updatedAt: now,
    enabled: false,
    gates: gates.map((gate) => createConversationAutomationGate({
      ...gate,
      now,
    })),
  };
}

export function readConversationAutomationDocument(path: string, conversationId: string): ConversationAutomationDocument {
  return normalizeDocument(JSON.parse(readFileSync(path, 'utf-8')) as unknown, conversationId);
}

export function loadConversationAutomationState(options: ResolveConversationAutomationPathOptions & { settingsFile?: string }): LoadedConversationAutomationState {
  const presetLibrary = options.settingsFile
    ? readSavedConversationAutomationWorkflowPresets(options.settingsFile)
    : { presets: [], defaultPresetId: null } satisfies ConversationAutomationWorkflowPresetLibraryState;
  const inheritedPreset = presetLibrary.defaultPresetId
    ? presetLibrary.presets.find((preset) => preset.id === presetLibrary.defaultPresetId) ?? null
    : null;
  const path = resolveConversationAutomationPath(options);

  if (!existsSync(path)) {
    return {
      document: inheritedPreset
        ? buildDocumentFromTemplate(options.conversationId, inheritedPreset.gates)
        : normalizeDocument(undefined, options.conversationId),
      inheritedPresetId: inheritedPreset?.id ?? null,
      presetLibrary,
    };
  }

  return {
    document: readConversationAutomationDocument(path, options.conversationId),
    inheritedPresetId: null,
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

export function templateGateFromRuntimeGate(gate: ConversationAutomationGate): ConversationAutomationTemplateGate {
  return {
    id: gate.id,
    label: gate.label,
    prompt: gate.prompt,
    skills: gate.skills.map((skill) => ({
      id: skill.id,
      label: skill.label,
      skillName: skill.skillName,
      ...(skill.skillArgs ? { skillArgs: skill.skillArgs } : {}),
    })),
  };
}

export function replaceConversationAutomationGates(
  document: ConversationAutomationDocument,
  gates: ConversationAutomationTemplateGate[],
  now = new Date().toISOString(),
): ConversationAutomationDocument {
  const updatedAt = normalizeIsoTimestamp(now, new Date().toISOString());
  const existingGateMap = new Map(document.gates.map((gate) => [gate.id, gate]));

  const nextGates = gates.map((inputGate) => {
    const template = normalizeTemplateGate(inputGate, updatedAt);
    const existingGate = existingGateMap.get(template.id);
    const existingSkillMap = new Map(existingGate?.skills.map((skill) => [skill.id, skill]) ?? []);

    return {
      id: template.id,
      label: template.label,
      prompt: template.prompt,
      status: 'pending' as const,
      createdAt: existingGate?.createdAt ?? updatedAt,
      updatedAt,
      skills: template.skills.map((templateSkill) => {
        const existingSkill = existingSkillMap.get(templateSkill.id);
        return {
          id: templateSkill.id,
          label: templateSkill.label,
          skillName: templateSkill.skillName,
          ...(templateSkill.skillArgs ? { skillArgs: templateSkill.skillArgs } : {}),
          status: 'pending' as const,
          createdAt: existingSkill?.createdAt ?? updatedAt,
          updatedAt,
        } satisfies ConversationAutomationSkillStep;
      }),
    } satisfies ConversationAutomationGate;
  });

  return {
    ...document,
    gates: nextGates,
    updatedAt,
    activeGateId: undefined,
    activeSkillId: undefined,
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

export function resetConversationAutomationFromGate(
  document: ConversationAutomationDocument,
  gateId: string,
  options: { now?: string; enabled?: boolean } = {},
): ConversationAutomationDocument {
  const updatedAt = normalizeIsoTimestamp(options.now, new Date().toISOString());
  const index = document.gates.findIndex((gate) => gate.id === gateId);
  if (index < 0) {
    throw new Error(`Automation gate not found: ${gateId}`);
  }

  return {
    ...document,
    gates: document.gates.map((gate, gateIndex) => gateIndex < index ? gate : resetGateForPending(gate, updatedAt)),
    updatedAt,
    enabled: options.enabled ?? document.enabled,
    activeGateId: undefined,
    activeSkillId: undefined,
  };
}

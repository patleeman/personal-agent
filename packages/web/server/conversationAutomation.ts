import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getStateRoot, validateConversationId } from '@personal-agent/core';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const STEP_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DOCUMENT_VERSION = 1 as const;

export type ConversationAutomationStepStatus = 'pending' | 'running' | 'completed' | 'failed';

interface ConversationAutomationBaseStep {
  id: string;
  label: string;
  kind: 'skill' | 'judge';
  status: ConversationAutomationStepStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultReason?: string;
  resultConfidence?: number;
}

export interface ConversationAutomationSkillStep extends ConversationAutomationBaseStep {
  kind: 'skill';
  skillName: string;
  skillArgs?: string;
}

export interface ConversationAutomationJudgeStep extends ConversationAutomationBaseStep {
  kind: 'judge';
  prompt: string;
}

export type ConversationAutomationStep = ConversationAutomationSkillStep | ConversationAutomationJudgeStep;

export interface ConversationAutomationDocument {
  version: 1;
  conversationId: string;
  updatedAt: string;
  paused: boolean;
  activeStepId?: string;
  steps: ConversationAutomationStep[];
}

export interface ResolveConversationAutomationOptions {
  profile: string;
  stateRoot?: string;
}

export interface ResolveConversationAutomationPathOptions extends ResolveConversationAutomationOptions {
  conversationId: string;
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

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}".`);
  }
}

function validateStepId(stepId: string): void {
  if (!STEP_ID_PATTERN.test(stepId)) {
    throw new Error(`Invalid automation step id "${stepId}".`);
  }
}

function getConversationAutomationStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
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

function normalizeBaseStep(
  value: Record<string, unknown>,
  kind: 'skill' | 'judge',
  fallbackNow: string,
): ConversationAutomationBaseStep {
  const id = readNonEmptyString(value.id);
  validateStepId(id);
  const label = readNonEmptyString(value.label);
  if (!label) {
    throw new Error(`Automation step ${id} is missing a label.`);
  }

  const statusRaw = readNonEmptyString(value.status);
  const status: ConversationAutomationStepStatus = statusRaw === 'running'
    || statusRaw === 'completed'
    || statusRaw === 'failed'
    ? statusRaw
    : 'pending';

  const confidenceValue = typeof value.resultConfidence === 'number' && Number.isFinite(value.resultConfidence)
    ? Math.max(0, Math.min(1, value.resultConfidence))
    : undefined;

  return {
    id,
    label,
    kind,
    status,
    createdAt: normalizeIsoTimestamp(value.createdAt, fallbackNow),
    updatedAt: normalizeIsoTimestamp(value.updatedAt, fallbackNow),
    ...(normalizeOptionalText(value.startedAt) ? { startedAt: normalizeIsoTimestamp(value.startedAt, fallbackNow) } : {}),
    ...(normalizeOptionalText(value.completedAt) ? { completedAt: normalizeIsoTimestamp(value.completedAt, fallbackNow) } : {}),
    ...(normalizeOptionalText(value.resultReason) ? { resultReason: normalizeOptionalText(value.resultReason) } : {}),
    ...(confidenceValue !== undefined ? { resultConfidence: confidenceValue } : {}),
  };
}

function normalizeStep(value: unknown, fallbackNow: string): ConversationAutomationStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Automation step must be an object.');
  }

  const record = value as Record<string, unknown>;
  const kind = readNonEmptyString(record.kind);

  if (kind === 'skill') {
    const base = normalizeBaseStep(record, 'skill', fallbackNow);
    const skillName = readNonEmptyString(record.skillName);
    if (!skillName) {
      throw new Error(`Automation step ${base.id} is missing skillName.`);
    }

    return {
      ...base,
      kind: 'skill',
      skillName,
      ...(normalizeOptionalSingleLineText(record.skillArgs) ? { skillArgs: normalizeOptionalSingleLineText(record.skillArgs) } : {}),
    };
  }

  if (kind === 'judge') {
    const base = normalizeBaseStep(record, 'judge', fallbackNow);
    const prompt = readNonEmptyString(record.prompt);
    if (!prompt) {
      throw new Error(`Automation step ${base.id} is missing prompt.`);
    }

    return {
      ...base,
      kind: 'judge',
      prompt,
    };
  }

  throw new Error(`Unsupported automation step kind: ${String(record.kind)}`);
}

function normalizeDocument(value: unknown, fallbackConversationId: string): ConversationAutomationDocument {
  const fallbackNow = new Date().toISOString();
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const conversationId = readNonEmptyString(record.conversationId) || fallbackConversationId;
  validateConversationId(conversationId);

  const steps = Array.isArray(record.steps)
    ? record.steps.map((step) => normalizeStep(step, fallbackNow))
    : [];

  const activeStepId = normalizeOptionalText(record.activeStepId);
  const runningSteps = steps.filter((step) => step.status === 'running');
  const activeRunningStep = activeStepId
    ? steps.find((step) => step.id === activeStepId && step.status === 'running')
    : undefined;

  for (const step of runningSteps) {
    if (activeRunningStep && step.id === activeRunningStep.id) {
      continue;
    }

    step.status = 'pending';
    step.updatedAt = fallbackNow;
    delete step.startedAt;
    delete step.completedAt;
    delete step.resultReason;
    delete step.resultConfidence;
  }

  return {
    version: DOCUMENT_VERSION,
    conversationId,
    updatedAt: normalizeIsoTimestamp(record.updatedAt, fallbackNow),
    paused: typeof record.paused === 'boolean' ? record.paused : true,
    ...(activeRunningStep?.id ? { activeStepId: activeRunningStep.id } : {}),
    steps,
  };
}

export function createConversationAutomationStepId(now = new Date()): string {
  return `auto-${now.toISOString().replace(/[.:TZ-]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createConversationAutomationSkillStep(input: {
  skillName: string;
  label?: string;
  skillArgs?: string;
  now?: string;
}): ConversationAutomationSkillStep {
  const createdAt = normalizeIsoTimestamp(input.now, new Date().toISOString());
  const skillName = readNonEmptyString(input.skillName);
  if (!skillName) {
    throw new Error('skillName is required.');
  }

  return {
    id: createConversationAutomationStepId(new Date(createdAt)),
    kind: 'skill',
    label: normalizeOptionalText(input.label) ?? skillName,
    skillName,
    ...(normalizeOptionalSingleLineText(input.skillArgs) ? { skillArgs: normalizeOptionalSingleLineText(input.skillArgs) } : {}),
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
  };
}

export function createConversationAutomationJudgeStep(input: {
  label?: string;
  prompt: string;
  now?: string;
}): ConversationAutomationJudgeStep {
  const createdAt = normalizeIsoTimestamp(input.now, new Date().toISOString());
  const prompt = readNonEmptyString(input.prompt);
  if (!prompt) {
    throw new Error('prompt is required.');
  }

  return {
    id: createConversationAutomationStepId(new Date(createdAt)),
    kind: 'judge',
    label: normalizeOptionalText(input.label) ?? 'Judge gate',
    prompt,
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
  };
}

export function buildConversationAutomationSkillPrompt(step: Pick<ConversationAutomationSkillStep, 'skillName' | 'skillArgs'>): string {
  const skillName = readNonEmptyString(step.skillName);
  if (!skillName) {
    throw new Error('skillName is required.');
  }

  const skillArgs = normalizeOptionalSingleLineText(step.skillArgs);
  return skillArgs ? `/skill:${skillName} ${skillArgs}` : `/skill:${skillName}`;
}

export function readConversationAutomationDocument(path: string, conversationId: string): ConversationAutomationDocument {
  return normalizeDocument(JSON.parse(readFileSync(path, 'utf-8')) as unknown, conversationId);
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

  if (normalized.steps.length === 0 && normalized.paused && !normalized.activeStepId) {
    rmSync(path, { force: true });
    return normalized;
  }

  mkdirSync(resolveProfileConversationAutomationDir({ stateRoot: options.stateRoot, profile: options.profile }), { recursive: true });
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n');
  return normalized;
}

export function resetConversationAutomationFromStep(
  document: ConversationAutomationDocument,
  stepId: string,
  options: { now?: string; paused?: boolean } = {},
): ConversationAutomationDocument {
  const now = normalizeIsoTimestamp(options.now, new Date().toISOString());
  const index = document.steps.findIndex((step) => step.id === stepId);
  if (index < 0) {
    throw new Error(`Automation step not found: ${stepId}`);
  }

  const nextSteps = document.steps.map((step, currentIndex) => {
    if (currentIndex < index) {
      return step;
    }

    const next = {
      ...step,
      status: 'pending' as const,
      updatedAt: now,
    } as ConversationAutomationStep;
    delete next.startedAt;
    delete next.completedAt;
    delete next.resultReason;
    delete next.resultConfidence;
    return next;
  });

  return {
    ...document,
    steps: nextSteps,
    paused: options.paused ?? document.paused,
    activeStepId: undefined,
    updatedAt: now,
  };
}

export function moveConversationAutomationStep(
  document: ConversationAutomationDocument,
  stepId: string,
  direction: 'up' | 'down',
  now = new Date().toISOString(),
): ConversationAutomationDocument {
  const index = document.steps.findIndex((step) => step.id === stepId);
  if (index < 0) {
    throw new Error(`Automation step not found: ${stepId}`);
  }

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= document.steps.length) {
    return document;
  }

  const nextSteps = [...document.steps];
  const [step] = nextSteps.splice(index, 1);
  nextSteps.splice(targetIndex, 0, step as ConversationAutomationStep);

  return {
    ...document,
    steps: nextSteps,
    updatedAt: normalizeIsoTimestamp(now, new Date().toISOString()),
  };
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  getConversationCheckpoint,
  getStateRoot,
  resolveConversationCheckpointSnapshotFile,
  saveConversationCheckpoint,
  validateConversationId,
} from '@personal-agent/core';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const DOCUMENT_VERSION = 1 as const;

export const CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX = 'Recover page distillation:';
export const LEGACY_CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX = 'Recover memory distillation:';

export type ConversationMemoryMaintenanceTrigger = 'manual' | 'turn_end' | 'auto_compaction_end';
export type ConversationMemoryMaintenanceMode = 'manual' | 'auto';
export type ConversationMemoryMaintenanceStatus = 'pending' | 'running' | 'promoted' | 'no-promotion' | 'failed';

export interface ConversationMemoryMaintenanceState {
  version: 1;
  profile: string;
  conversationId: string;
  updatedAt: string;
  status: ConversationMemoryMaintenanceStatus;
  latestTrigger: ConversationMemoryMaintenanceTrigger;
  latestMode: ConversationMemoryMaintenanceMode;
  latestCheckpointId: string;
  latestAnchorMessageId: string;
  latestAnchorTimestamp: string;
  latestAnchorPreview: string;
  latestSessionFile?: string;
  latestConversationTitle?: string;
  latestCwd?: string;
  relatedProjectIds: string[];
  autoPromotionEligible: boolean;
  lastRunId?: string;
  runningCheckpointId?: string;
  lastCompletedCheckpointId?: string;
  lastEvaluatedAt?: string;
  lastError?: string;
  promotedMemoryId?: string;
  promotedReferencePath?: string;
}

export interface ConversationMemoryCheckpointSnapshot {
  checkpointId: string;
  snapshotContent: string;
  snapshotLineCount: number;
  snapshotMessageCount: number;
  anchor: {
    messageId: string;
    role: string;
    timestamp: string;
    preview: string;
  };
}

export interface PrepareConversationMemoryMaintenanceInput {
  profile: string;
  conversationId: string;
  sessionFile: string;
  conversationTitle?: string;
  cwd?: string;
  relatedProjectIds: string[];
  trigger: ConversationMemoryMaintenanceTrigger;
  mode: ConversationMemoryMaintenanceMode;
  requestedAnchorMessageId?: string;
  stateRoot?: string;
}

export interface PreparedConversationMemoryMaintenance {
  checkpoint: ConversationMemoryCheckpointSnapshot;
  state: ConversationMemoryMaintenanceState;
  shouldStartRun: boolean;
}

export interface ConversationMemoryWorkItem {
  conversationId: string;
  conversationTitle: string;
  runId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

interface ParsedSessionJsonLine {
  raw: string;
  value: Record<string, unknown>;
}

interface SessionJsonMessageLine {
  id: string;
  timestamp: string;
  role: string;
  content: unknown;
}

export function isConversationMemoryDistillRecoveryTitle(title: string | undefined | null): boolean {
  if (typeof title !== 'string') {
    return false;
  }

  const normalized = title.trim();
  return normalized.startsWith(CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX)
    || normalized.startsWith(LEGACY_CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX);
}

export function normalizeConversationMemoryDistillRecoveryTitle(title: string | undefined | null): string | undefined {
  if (typeof title !== 'string') {
    return undefined;
  }

  const normalized = title.trim();
  if (normalized.startsWith(LEGACY_CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX)) {
    return `${CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX} ${normalized.slice(LEGACY_CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX.length).trim()}`.trim();
  }

  return normalized || undefined;
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}".`);
  }
}

function getConversationMemoryMaintenanceStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

export function resolveProfileConversationMemoryMaintenanceDir(options: { profile: string; stateRoot?: string }): string {
  validateProfileName(options.profile);
  return join(
    getConversationMemoryMaintenanceStateRoot(options.stateRoot),
    'pi-agent',
    'state',
    'conversation-memory',
    options.profile,
  );
}

export function resolveConversationMemoryMaintenancePath(options: { profile: string; conversationId: string; stateRoot?: string }): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationMemoryMaintenanceDir(options), `${options.conversationId}.json`);
}

export function resolveConversationMemoryMaintenanceEventsPath(options: { profile: string; stateRoot?: string }): string {
  validateProfileName(options.profile);
  return join(resolveProfileConversationMemoryMaintenanceDir(options), 'events.jsonl');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => readString(item)).filter((item) => item.length > 0))];
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  const normalized = readString(value);
  return normalized && Number.isFinite(Date.parse(normalized))
    ? new Date(Date.parse(normalized)).toISOString()
    : fallback;
}

function parseSessionJsonLines(sessionFile: string): ParsedSessionJsonLine[] {
  const raw = readFileSync(sessionFile, 'utf-8');

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        return [{ raw: line, value } satisfies ParsedSessionJsonLine];
      } catch {
        return [];
      }
    });
}

function parseSessionMessageLine(value: Record<string, unknown>): SessionJsonMessageLine | null {
  if (value.type !== 'message') {
    return null;
  }

  const id = readString(value.id);
  const timestamp = readString(value.timestamp);
  const message = isRecord(value.message) ? value.message : null;
  if (!id || !timestamp || !message) {
    return null;
  }

  const role = readString(message.role);
  if (!role) {
    return null;
  }

  return {
    id,
    timestamp,
    role,
    content: message.content,
  };
}

function normalizeMessageContentBlocks(content: unknown): Array<{ type?: string; text?: string }> {
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type?: string; text?: string } => Boolean(part) && typeof part === 'object')
      .map((part) => ({
        type: typeof part.type === 'string' ? part.type : undefined,
        text: typeof part.text === 'string' ? part.text : undefined,
      }));
  }

  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return [];
}

function buildCheckpointAnchorPreview(content: unknown): string {
  const blocks = normalizeMessageContentBlocks(content);
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 0) {
    return text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text;
  }

  const imageCount = blocks.filter((block) => block.type === 'image').length;
  if (imageCount > 0) {
    return imageCount === 1 ? '(image attachment)' : `(${imageCount} image attachments)`;
  }

  return 'Checkpoint anchor';
}

function resolveAnchorMessageId(messageIds: string[], requestedAnchorMessageId?: string): string | undefined {
  if (messageIds.length === 0) {
    return undefined;
  }

  const idSet = new Set(messageIds);
  if (!requestedAnchorMessageId || requestedAnchorMessageId.trim().length === 0) {
    return messageIds[messageIds.length - 1];
  }

  const initialCandidate = requestedAnchorMessageId.trim();
  if (idSet.has(initialCandidate)) {
    return initialCandidate;
  }

  let candidate = initialCandidate;
  const seen = new Set<string>();
  while (!seen.has(candidate)) {
    seen.add(candidate);
    const trimmedCandidate = candidate.match(/^(.*)-[txcei]\d+$/)?.[1]?.trim();
    if (!trimmedCandidate) {
      break;
    }

    if (idSet.has(trimmedCandidate)) {
      return trimmedCandidate;
    }

    candidate = trimmedCandidate;
  }

  return undefined;
}

export function buildConversationMemoryCheckpointSnapshot(sessionFile: string, requestedAnchorMessageId?: string): ConversationMemoryCheckpointSnapshot {
  const lines = parseSessionJsonLines(sessionFile);
  const messageEntries = lines
    .map((line, lineIndex) => {
      const message = parseSessionMessageLine(line.value);
      if (!message) {
        return null;
      }

      return { lineIndex, message };
    })
    .filter((entry): entry is { lineIndex: number; message: SessionJsonMessageLine } => entry !== null);

  if (messageEntries.length === 0) {
    throw new Error('Cannot distill memory from an empty conversation. Send at least one prompt first.');
  }

  const anchorMessageId = resolveAnchorMessageId(
    messageEntries.map((entry) => entry.message.id),
    requestedAnchorMessageId,
  );
  if (!anchorMessageId) {
    throw new Error('Unable to resolve memory anchor message.');
  }

  const anchorEntry = messageEntries.find((entry) => entry.message.id === anchorMessageId);
  if (!anchorEntry) {
    throw new Error(`Memory anchor message ${anchorMessageId} not found.`);
  }

  const snapshotLines = lines.slice(0, anchorEntry.lineIndex + 1);
  const snapshotMessageCount = snapshotLines
    .map((line) => parseSessionMessageLine(line.value))
    .filter((line): line is SessionJsonMessageLine => line !== null)
    .length;

  return {
    checkpointId: '',
    snapshotContent: `${snapshotLines.map((line) => line.raw).join('\n')}\n`,
    snapshotLineCount: snapshotLines.length,
    snapshotMessageCount,
    anchor: {
      messageId: anchorEntry.message.id,
      role: anchorEntry.message.role,
      timestamp: anchorEntry.message.timestamp,
      preview: buildCheckpointAnchorPreview(anchorEntry.message.content),
    },
  };
}

function buildCheckpointTitle(conversationTitle: string | undefined, anchorPreview: string): string {
  const normalizedTitle = readString(conversationTitle);
  if (normalizedTitle.length > 0) {
    return normalizedTitle;
  }

  const normalizedPreview = anchorPreview.replace(/\s+/g, ' ').trim();
  return normalizedPreview.length > 0 ? normalizedPreview : 'Conversation memory checkpoint';
}

function appendConversationMemoryMaintenanceEvent(
  options: { profile: string; stateRoot?: string },
  event: Record<string, unknown>,
): void {
  const path = resolveConversationMemoryMaintenanceEventsPath(options);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf-8');
}

function writeConversationMemoryMaintenanceState(
  options: { profile: string; conversationId: string; stateRoot?: string },
  state: ConversationMemoryMaintenanceState,
): ConversationMemoryMaintenanceState {
  const path = resolveConversationMemoryMaintenancePath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  return state;
}

export function readConversationMemoryMaintenanceState(options: { profile: string; conversationId: string; stateRoot?: string }): ConversationMemoryMaintenanceState | null {
  const path = resolveConversationMemoryMaintenancePath(options);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const now = new Date().toISOString();
    const conversationId = readString(parsed.conversationId);
    const profile = readString(parsed.profile);
    const latestCheckpointId = readString(parsed.latestCheckpointId);
    const latestAnchorMessageId = readString(parsed.latestAnchorMessageId);
    const latestAnchorTimestamp = normalizeTimestamp(parsed.latestAnchorTimestamp, now);
    const latestAnchorPreview = readString(parsed.latestAnchorPreview);
    const statusValue = readString(parsed.status);
    const status: ConversationMemoryMaintenanceStatus = statusValue === 'running'
      || statusValue === 'promoted'
      || statusValue === 'no-promotion'
      || statusValue === 'failed'
      ? statusValue
      : 'pending';
    const latestTriggerValue = readString(parsed.latestTrigger);
    const latestTrigger: ConversationMemoryMaintenanceTrigger = latestTriggerValue === 'manual'
      || latestTriggerValue === 'auto_compaction_end'
      ? latestTriggerValue
      : 'turn_end';
    const latestModeValue = readString(parsed.latestMode);
    const latestMode: ConversationMemoryMaintenanceMode = latestModeValue === 'manual' ? 'manual' : 'auto';

    if (!conversationId || !profile || !latestCheckpointId || !latestAnchorMessageId || !latestAnchorPreview) {
      return null;
    }

    return {
      version: DOCUMENT_VERSION,
      profile,
      conversationId,
      updatedAt: normalizeTimestamp(parsed.updatedAt, now),
      status,
      latestTrigger,
      latestMode,
      latestCheckpointId,
      latestAnchorMessageId,
      latestAnchorTimestamp,
      latestAnchorPreview,
      ...(readString(parsed.latestSessionFile) ? { latestSessionFile: readString(parsed.latestSessionFile) } : {}),
      ...(readString(parsed.latestConversationTitle) ? { latestConversationTitle: readString(parsed.latestConversationTitle) } : {}),
      ...(readString(parsed.latestCwd) ? { latestCwd: readString(parsed.latestCwd) } : {}),
      relatedProjectIds: readStringArray(parsed.relatedProjectIds),
      autoPromotionEligible: parsed.autoPromotionEligible !== false,
      ...(readString(parsed.lastRunId) ? { lastRunId: readString(parsed.lastRunId) } : {}),
      ...(readString(parsed.runningCheckpointId) ? { runningCheckpointId: readString(parsed.runningCheckpointId) } : {}),
      ...(readString(parsed.lastCompletedCheckpointId) ? { lastCompletedCheckpointId: readString(parsed.lastCompletedCheckpointId) } : {}),
      ...(readString(parsed.lastError) ? { lastError: readString(parsed.lastError) } : {}),
      ...(readString(parsed.promotedMemoryId) ? { promotedMemoryId: readString(parsed.promotedMemoryId) } : {}),
      ...(readString(parsed.promotedReferencePath) ? { promotedReferencePath: readString(parsed.promotedReferencePath) } : {}),
      ...(readString(parsed.lastEvaluatedAt) ? { lastEvaluatedAt: normalizeTimestamp(parsed.lastEvaluatedAt, now) } : {}),
    };
  } catch {
    return null;
  }
}

export function listConversationMemoryMaintenanceStates(options: { profile: string; stateRoot?: string }): ConversationMemoryMaintenanceState[] {
  const dir = resolveProfileConversationMemoryMaintenanceDir(options);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readConversationMemoryMaintenanceState({
      profile: options.profile,
      conversationId: entry.name.slice(0, -'.json'.length),
      stateRoot: options.stateRoot,
    }))
    .filter((entry): entry is ConversationMemoryMaintenanceState => entry !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function prepareConversationMemoryMaintenance(input: PrepareConversationMemoryMaintenanceInput): PreparedConversationMemoryMaintenance {
  validateProfileName(input.profile);
  validateConversationId(input.conversationId);

  const now = new Date().toISOString();
  const snapshot = buildConversationMemoryCheckpointSnapshot(input.sessionFile, input.requestedAnchorMessageId);
  const existing = readConversationMemoryMaintenanceState({
    profile: input.profile,
    conversationId: input.conversationId,
    stateRoot: input.stateRoot,
  });

  if (
    input.mode === 'auto'
    && existing
    && existing.latestAnchorMessageId === snapshot.anchor.messageId
    && existing.latestAnchorTimestamp === snapshot.anchor.timestamp
  ) {
    return {
      checkpoint: {
        ...snapshot,
        checkpointId: existing.latestCheckpointId,
      },
      state: existing,
      shouldStartRun: false,
    };
  }

  const checkpoint = saveConversationCheckpoint({
    stateRoot: input.stateRoot,
    profile: input.profile,
    title: buildCheckpointTitle(input.conversationTitle, snapshot.anchor.preview),
    source: {
      conversationId: input.conversationId,
      ...(readString(input.conversationTitle) ? { conversationTitle: readString(input.conversationTitle) } : {}),
      ...(readString(input.cwd) ? { cwd: readString(input.cwd) } : {}),
      relatedProjectIds: [...input.relatedProjectIds],
    },
    anchor: snapshot.anchor,
    snapshotContent: snapshot.snapshotContent,
    snapshotMessageCount: snapshot.snapshotMessageCount,
    snapshotLineCount: snapshot.snapshotLineCount,
    updatedAt: now,
  });

  const checkpointSnapshot: ConversationMemoryCheckpointSnapshot = {
    ...snapshot,
    checkpointId: checkpoint.id,
  };

  const autoPromotionEligible = input.mode === 'manual' || input.relatedProjectIds.length === 1;
  const status: ConversationMemoryMaintenanceStatus = autoPromotionEligible ? 'pending' : 'no-promotion';
  const state: ConversationMemoryMaintenanceState = {
    version: DOCUMENT_VERSION,
    profile: input.profile,
    conversationId: input.conversationId,
    updatedAt: now,
    status,
    latestTrigger: input.trigger,
    latestMode: input.mode,
    latestCheckpointId: checkpoint.id,
    latestAnchorMessageId: checkpoint.anchor.messageId,
    latestAnchorTimestamp: checkpoint.anchor.timestamp,
    latestAnchorPreview: checkpoint.anchor.preview,
    ...(readString(input.sessionFile) ? { latestSessionFile: readString(input.sessionFile) } : {}),
    ...(readString(input.conversationTitle) ? { latestConversationTitle: readString(input.conversationTitle) } : {}),
    ...(readString(input.cwd) ? { latestCwd: readString(input.cwd) } : {}),
    relatedProjectIds: [...input.relatedProjectIds],
    autoPromotionEligible,
    ...(status === 'no-promotion' ? { lastEvaluatedAt: now } : {}),
  };

  writeConversationMemoryMaintenanceState({
    profile: input.profile,
    conversationId: input.conversationId,
    stateRoot: input.stateRoot,
  }, state);

  appendConversationMemoryMaintenanceEvent({ profile: input.profile, stateRoot: input.stateRoot }, {
    timestamp: now,
    type: 'checkpoint_created',
    profile: input.profile,
    conversationId: input.conversationId,
    checkpointId: checkpoint.id,
    trigger: input.trigger,
    mode: input.mode,
    autoPromotionEligible,
    anchorMessageId: checkpoint.anchor.messageId,
  });

  if (!autoPromotionEligible) {
    appendConversationMemoryMaintenanceEvent({ profile: input.profile, stateRoot: input.stateRoot }, {
      timestamp: now,
      type: 'evaluation_skipped',
      profile: input.profile,
      conversationId: input.conversationId,
      checkpointId: checkpoint.id,
      reason: 'Automatic promotion is limited to manual requests or conversations linked to exactly one project.',
    });
  }

  return {
    checkpoint: checkpointSnapshot,
    state,
    shouldStartRun: autoPromotionEligible,
  };
}

export function markConversationMemoryMaintenanceRunStarted(input: {
  profile: string;
  conversationId: string;
  checkpointId: string;
  runId: string;
  stateRoot?: string;
}): ConversationMemoryMaintenanceState {
  const current = readConversationMemoryMaintenanceState(input);
  const now = new Date().toISOString();
  if (!current) {
    throw new Error(`Conversation memory maintenance state missing for ${input.conversationId}.`);
  }

  const next: ConversationMemoryMaintenanceState = {
    ...current,
    updatedAt: now,
    status: 'running',
    lastRunId: input.runId,
    runningCheckpointId: input.checkpointId,
    lastError: undefined,
  };

  writeConversationMemoryMaintenanceState(input, next);
  appendConversationMemoryMaintenanceEvent({ profile: input.profile, stateRoot: input.stateRoot }, {
    timestamp: now,
    type: 'evaluation_started',
    profile: input.profile,
    conversationId: input.conversationId,
    checkpointId: input.checkpointId,
    runId: input.runId,
  });
  return next;
}

export function markConversationMemoryMaintenanceRunCompleted(input: {
  profile: string;
  conversationId: string;
  checkpointId: string;
  memoryId: string;
  referencePath: string;
  stateRoot?: string;
}): ConversationMemoryMaintenanceState {
  const current = readConversationMemoryMaintenanceState(input);
  const now = new Date().toISOString();
  if (!current) {
    throw new Error(`Conversation memory maintenance state missing for ${input.conversationId}.`);
  }

  const nextStatus: ConversationMemoryMaintenanceStatus = current.latestCheckpointId === input.checkpointId
    ? 'promoted'
    : current.autoPromotionEligible
      ? 'pending'
      : 'no-promotion';

  const next: ConversationMemoryMaintenanceState = {
    ...current,
    updatedAt: now,
    status: nextStatus,
    runningCheckpointId: undefined,
    lastCompletedCheckpointId: input.checkpointId,
    lastEvaluatedAt: now,
    lastError: undefined,
    promotedMemoryId: input.memoryId,
    promotedReferencePath: input.referencePath,
  };

  writeConversationMemoryMaintenanceState(input, next);
  appendConversationMemoryMaintenanceEvent({ profile: input.profile, stateRoot: input.stateRoot }, {
    timestamp: now,
    type: 'promotion_written',
    profile: input.profile,
    conversationId: input.conversationId,
    checkpointId: input.checkpointId,
    memoryId: input.memoryId,
    referencePath: input.referencePath,
    catchUpPending: current.latestCheckpointId !== input.checkpointId,
  });
  return next;
}

export function markConversationMemoryMaintenanceRunFailed(input: {
  profile: string;
  conversationId: string;
  checkpointId: string;
  error: string;
  stateRoot?: string;
}): ConversationMemoryMaintenanceState {
  const current = readConversationMemoryMaintenanceState(input);
  const now = new Date().toISOString();
  if (!current) {
    throw new Error(`Conversation memory maintenance state missing for ${input.conversationId}.`);
  }

  const next: ConversationMemoryMaintenanceState = {
    ...current,
    updatedAt: now,
    status: 'failed',
    runningCheckpointId: undefined,
    lastEvaluatedAt: now,
    lastError: input.error.trim() || 'Unknown conversation memory maintenance error.',
  };

  writeConversationMemoryMaintenanceState(input, next);
  appendConversationMemoryMaintenanceEvent({ profile: input.profile, stateRoot: input.stateRoot }, {
    timestamp: now,
    type: 'evaluation_failed',
    profile: input.profile,
    conversationId: input.conversationId,
    checkpointId: input.checkpointId,
    error: next.lastError,
  });
  return next;
}

export function readConversationCheckpointSnapshotFromState(input: {
  profile: string;
  conversationId: string;
  checkpointId: string;
  stateRoot?: string;
}): ConversationMemoryCheckpointSnapshot {
  const checkpoint = getConversationCheckpoint({
    stateRoot: input.stateRoot,
    profile: input.profile,
    checkpointId: input.checkpointId,
  });
  if (!checkpoint) {
    throw new Error(`Conversation checkpoint not found: ${input.checkpointId}`);
  }

  const snapshotPath = resolveConversationCheckpointSnapshotFile({
    stateRoot: input.stateRoot,
    profile: input.profile,
    checkpoint,
  });
  if (!existsSync(snapshotPath)) {
    throw new Error(`Conversation checkpoint snapshot missing: ${snapshotPath}`);
  }

  return {
    checkpointId: checkpoint.id,
    snapshotContent: readFileSync(snapshotPath, 'utf-8'),
    snapshotLineCount: checkpoint.snapshot.lineCount,
    snapshotMessageCount: checkpoint.snapshot.messageCount,
    anchor: checkpoint.anchor,
  };
}

export function buildConversationMemoryWorkItemsFromStates(states: ConversationMemoryMaintenanceState[]): ConversationMemoryWorkItem[] {
  return states
    .filter((state) => state.status === 'pending' || state.status === 'failed')
    .map((state) => ({
      conversationId: state.conversationId,
      conversationTitle: state.latestConversationTitle ?? state.conversationId,
      runId: state.lastRunId ?? `state:${state.conversationId}`,
      status: state.status,
      createdAt: state.lastEvaluatedAt ?? state.updatedAt,
      updatedAt: state.updatedAt,
      ...(state.lastError ? { lastError: state.lastError } : {}),
    }));
}

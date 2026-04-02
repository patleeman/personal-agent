import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getConversationProjectLink,
  getProfilesRoot,
  loadMemoryDocs,
} from '@personal-agent/core';
import { startBackgroundRun } from '@personal-agent/daemon';
import { ensureDaemonAvailable } from '../automation/daemonToolUtils.js';
import { listDurableRuns } from '../automation/durableRuns.js';
import {
  ensureMemoryDocsDir,
  type MemoryDocItem,
} from '../knowledge/memoryDocs.js';
import { saveCuratedDistilledConversationMemory, type DistilledConversationMemoryDraft } from './conversationMemoryCuration.js';
import {
  writeConversationMemoryDistillActivity,
} from './conversationMemoryActivity.js';
import {
  buildConversationMemoryWorkItemsFromStates,
  isConversationMemoryDistillRecoveryTitle,
  listConversationMemoryMaintenanceStates,
  markConversationMemoryMaintenanceRunCompleted,
  normalizeConversationMemoryDistillRecoveryTitle,
  readConversationCheckpointSnapshotFromState,
  readConversationMemoryMaintenanceState,
  type ConversationMemoryMaintenanceMode,
  type ConversationMemoryMaintenanceTrigger,
  type ConversationMemoryWorkItem,
} from './conversationMemoryMaintenance.js';
import {
  getCurrentProfile,
  listConversationSessionsSnapshot,
  resolveConversationSessionFile,
} from './conversationService.js';
import {
  registry as liveRegistry,
} from './liveSessions.js';

const CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE = 'conversation-node-distill';
const LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE = 'conversation-memory-distill';
const CONVERSATION_NODE_DISTILL_BATCH_RECOVERY_RUN_SOURCE_TYPE = 'conversation-node-distill-recovery-batch';
const CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering', 'waiting']);

type DurableRun = Awaited<ReturnType<typeof listDurableRuns>>['runs'][number];

export interface ConversationMemoryDistillRunState {
  conversationId: string;
  running: boolean;
  runId: string | null;
  status: string | null;
}

export interface ConversationMemoryDistillRunInput {
  conversationId: string;
  profile: string;
  checkpointId: string;
  mode: ConversationMemoryMaintenanceMode;
  trigger: ConversationMemoryMaintenanceTrigger;
  title?: string;
  summary?: string;
  emitActivity?: boolean;
}

export interface ResolvedConversationMemoryDistillRunInput {
  conversationId: string;
  checkpointId: string;
  mode: ConversationMemoryMaintenanceMode;
  trigger: ConversationMemoryMaintenanceTrigger;
  title?: string;
  summary?: string;
  emitActivity: boolean;
}

export interface DistillConversationMemoryNowInput {
  conversationId: string;
  profile: string;
  title?: string;
  summary?: string;
  anchorMessageId?: string;
  checkpointId?: string;
  mode: ConversationMemoryMaintenanceMode;
  trigger: ConversationMemoryMaintenanceTrigger;
  emitActivity: boolean;
}

interface BackgroundRunLaunchOptions {
  repoRoot: string;
  port: number;
}

interface CheckpointSnapshotBuildResult {
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

interface SaveDistilledConversationMemoryOptions {
  title?: string;
  summary?: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
  sourceProfile?: string;
  relatedProjectIds: string[];
  snapshot: CheckpointSnapshotBuildResult;
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

function isConversationNodeDistillRunSourceType(value: string | undefined): boolean {
  return value === CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE
    || value === LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE;
}

function isConversationMemoryDistillRun(run: DurableRun, conversationId: string): boolean {
  return run.manifest?.kind === 'background-run'
    && isConversationNodeDistillRunSourceType(run.manifest.source?.type)
    && run.manifest.source?.id === conversationId;
}

export async function readConversationMemoryDistillRunState(conversationId: string): Promise<ConversationMemoryDistillRunState> {
  const runs = (await listDurableRuns()).runs
    .filter((run) => isConversationMemoryDistillRun(run, conversationId))
    .sort((left, right) => {
      const leftCreatedAt = left.manifest?.createdAt ?? '';
      const rightCreatedAt = right.manifest?.createdAt ?? '';
      return rightCreatedAt.localeCompare(leftCreatedAt);
    });

  const latest = runs[0];
  const status = latest?.status?.status ?? null;

  return {
    conversationId,
    running: Boolean(status && CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES.has(status)),
    runId: latest?.runId ?? null,
    status,
  };
}

function readOptionalRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalRecordBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readConversationMemoryDistillRunInputFromRun(
  run: DurableRun,
  profile: string,
): ResolvedConversationMemoryDistillRunInput | null {
  const source = run.manifest?.source;
  if (run.manifest?.kind !== 'background-run' || !isConversationNodeDistillRunSourceType(source?.type)) {
    return null;
  }

  const conversationId = typeof source?.id === 'string' ? source.id.trim() : '';
  if (!conversationId) {
    return null;
  }

  const payload = isRecord(run.checkpoint?.payload) ? run.checkpoint.payload : {};
  const maintenanceState = readConversationMemoryMaintenanceState({ profile, conversationId });
  const checkpointId = readOptionalRecordString(payload, 'checkpointId')
    ?? maintenanceState?.runningCheckpointId
    ?? maintenanceState?.latestCheckpointId;

  if (!checkpointId) {
    return null;
  }

  const modeValue = readOptionalRecordString(payload, 'mode');
  const mode: ConversationMemoryMaintenanceMode = modeValue === 'manual'
    ? 'manual'
    : modeValue === 'auto'
      ? 'auto'
      : maintenanceState?.latestMode ?? 'auto';
  const triggerValue = readOptionalRecordString(payload, 'trigger');
  const trigger: ConversationMemoryMaintenanceTrigger = triggerValue === 'manual' || triggerValue === 'auto_compaction_end' || triggerValue === 'turn_end'
    ? triggerValue
    : maintenanceState?.latestTrigger ?? 'turn_end';

  return {
    conversationId,
    checkpointId,
    mode,
    trigger,
    title: readOptionalRecordString(payload, 'title'),
    summary: readOptionalRecordString(payload, 'summary'),
    emitActivity: readOptionalRecordBoolean(payload, 'emitActivity') ?? false,
  };
}

export function formatConversationMemoryCheckpointAnchor(snapshot: Awaited<ReturnType<typeof readConversationCheckpointSnapshotFromState>> | null): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  return `${snapshot.anchor.role} at ${new Date(snapshot.anchor.timestamp).toLocaleString()} — ${snapshot.anchor.preview}`;
}

export function buildConversationMemoryDistillRecoveryVisibleMessage(input: {
  runId: string;
  status: string;
  sourceConversationId: string;
  sourceConversationTitle?: string;
  checkpointId: string;
  anchorLabel?: string;
  error?: string;
}): string {
  return [
    `Run ${input.runId} did not finish its page distillation.`,
    `Status: ${input.status}`,
    `Source conversation: ${input.sourceConversationTitle ?? input.sourceConversationId}`,
    `Checkpoint: ${input.checkpointId}`,
    input.anchorLabel ? `Anchor: ${input.anchorLabel}` : undefined,
    input.error ? `Last error: ${input.error}` : undefined,
    '',
    'Use this branch to inspect the failure and steer a retry or manual fix.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function buildConversationMemoryDistillRecoveryHiddenContext(input: {
  runId: string;
  status: string;
  sourceConversationId: string;
  sourceConversationTitle?: string;
  checkpointId: string;
  anchorLabel?: string;
  title?: string;
  summary?: string;
  error?: string;
}): string {
  return [
    'You are helping recover a conversation page distillation that did not complete cleanly.',
    '',
    'This conversation is a fork of the source conversation, so the relevant transcript history is already available above.',
    '',
    'Recovery target:',
    `- runId: ${input.runId}`,
    `- status: ${input.status}`,
    `- source conversation: ${input.sourceConversationTitle ?? input.sourceConversationId}`,
    `- checkpointId: ${input.checkpointId}`,
    input.anchorLabel ? `- anchor: ${input.anchorLabel}` : undefined,
    input.title ? `- requested title: ${input.title}` : undefined,
    input.summary ? `- requested summary: ${input.summary}` : undefined,
    input.error ? `- last error: ${input.error}` : undefined,
    '',
    'Help the user inspect the failure, decide whether to retry the distillation, and if needed manually finish the durable note-page update.',
    `If you need the raw log, inspect durable run ${input.runId}.`,
    'Prefer targeted fixes over broad rewrites.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function resolveConversationMemoryDistillRunnerPath(): string {
  return fileURLToPath(new URL('../automation/distillConversationMemoryRun.js', import.meta.url));
}

function resolveConversationMemoryDistillBatchRecoveryRunnerPath(): string {
  return fileURLToPath(new URL('../automation/recoverConversationMemoryDistillRuns.js', import.meta.url));
}

export async function startConversationMemoryDistillRun(
  input: ConversationMemoryDistillRunInput,
  options: BackgroundRunLaunchOptions,
) {
  await ensureDaemonAvailable();

  const runnerPath = resolveConversationMemoryDistillRunnerPath();
  if (!existsSync(runnerPath)) {
    return {
      accepted: false,
      reason: `Distillation runner not found: ${runnerPath}`,
      runId: undefined,
      logPath: undefined,
    };
  }

  const payload = Buffer.from(JSON.stringify({
    conversationId: input.conversationId,
    checkpointId: input.checkpointId,
    title: input.title,
    summary: input.summary,
    mode: input.mode,
    trigger: input.trigger,
    emitActivity: input.emitActivity ?? false,
  }), 'utf-8').toString('base64url');

  return startBackgroundRun({
    taskSlug: `distill-node-${input.conversationId}`,
    cwd: options.repoRoot,
    argv: [
      process.execPath,
      runnerPath,
      '--port',
      String(options.port),
      '--profile',
      input.profile,
      '--payload',
      payload,
    ],
    source: {
      type: CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE,
      id: input.conversationId,
    },
    checkpointPayload: {
      conversationId: input.conversationId,
      checkpointId: input.checkpointId,
      mode: input.mode,
      trigger: input.trigger,
      ...(input.title ? { title: input.title } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
      emitActivity: input.emitActivity ?? false,
    },
  });
}

export async function startConversationMemoryDistillBatchRecoveryRun(
  input: { profile: string; runIds: string[] },
  options: BackgroundRunLaunchOptions,
) {
  await ensureDaemonAvailable();

  const runnerPath = resolveConversationMemoryDistillBatchRecoveryRunnerPath();
  if (!existsSync(runnerPath)) {
    return {
      accepted: false,
      reason: `Distillation recovery runner not found: ${runnerPath}`,
      runId: undefined,
      logPath: undefined,
    };
  }

  const runIds = [...new Set(input.runIds.map((runId) => runId.trim()).filter((runId) => runId.length > 0))];
  if (runIds.length === 0) {
    return {
      accepted: false,
      reason: 'At least one failed distillation run is required for batch recovery.',
      runId: undefined,
      logPath: undefined,
    };
  }

  return startBackgroundRun({
    taskSlug: `recover-node-distills-${input.profile}`,
    cwd: options.repoRoot,
    argv: [
      process.execPath,
      runnerPath,
      '--port',
      String(options.port),
      '--profile',
      input.profile,
      ...runIds.flatMap((runId) => ['--run-id', runId]),
    ],
    source: {
      type: CONVERSATION_NODE_DISTILL_BATCH_RECOVERY_RUN_SOURCE_TYPE,
      id: input.profile,
    },
    checkpointPayload: {
      profile: input.profile,
      runIds,
      totalRuns: runIds.length,
    },
  });
}

export async function listMemoryWorkItems(profile = getCurrentProfile()): Promise<ConversationMemoryWorkItem[]> {
  const sessionsById = new Map(listConversationSessionsSnapshot().map((session) => [session.id, session]));
  const maintenanceStates = listConversationMemoryMaintenanceStates({ profile });
  const maintenanceStateByConversationId = new Map(maintenanceStates.map((state) => [state.conversationId, state]));
  const runs = (await listDurableRuns()).runs
    .filter((run) => run.manifest?.kind === 'background-run' && isConversationNodeDistillRunSourceType(run.manifest.source?.type))
    .sort((left, right) => {
      const leftCreatedAt = left.manifest?.createdAt ?? '';
      const rightCreatedAt = right.manifest?.createdAt ?? '';
      return rightCreatedAt.localeCompare(leftCreatedAt);
    });

  const visibleStatuses = new Set([...CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES, 'failed', 'interrupted']);
  const latestRunByConversationId = new Map<string, DurableRun>();
  for (const run of runs) {
    const conversationId = typeof run.manifest?.source?.id === 'string' ? run.manifest.source.id.trim() : '';
    if (!conversationId || latestRunByConversationId.has(conversationId)) {
      continue;
    }

    latestRunByConversationId.set(conversationId, run);
  }

  const items: ConversationMemoryWorkItem[] = [];
  for (const [conversationId, run] of latestRunByConversationId) {
    const session = sessionsById.get(conversationId);
    const maintenanceState = maintenanceStateByConversationId.get(conversationId);
    const conversationTitle = normalizeConversationMemoryDistillRecoveryTitle(
      session?.title ?? maintenanceState?.latestConversationTitle ?? conversationId,
    ) ?? conversationId;
    if (isConversationMemoryDistillRecoveryTitle(conversationTitle)) {
      continue;
    }

    const status = run.status?.status ?? '';
    if (!visibleStatuses.has(status)) {
      continue;
    }

    const createdAt = run.manifest?.createdAt ?? run.status?.createdAt ?? new Date().toISOString();
    const updatedAt = run.status?.updatedAt ?? createdAt;

    items.push({
      conversationId,
      conversationTitle,
      runId: run.runId,
      status,
      createdAt,
      updatedAt,
      ...(run.status?.lastError ? { lastError: run.status.lastError } : {}),
    });
  }

  const pendingStates = buildConversationMemoryWorkItemsFromStates(
    maintenanceStates
      .filter((state) => {
        const latestRun = latestRunByConversationId.get(state.conversationId);
        if (!latestRun) {
          return true;
        }

        const latestRunStatus = latestRun.status?.status ?? '';
        if (visibleStatuses.has(latestRunStatus)) {
          return false;
        }

        const latestRunUpdatedAt = latestRun.status?.updatedAt ?? latestRun.manifest?.createdAt ?? '';
        return state.updatedAt >= latestRunUpdatedAt;
      })
      .filter((state) => !isConversationMemoryDistillRecoveryTitle(
        sessionsById.get(state.conversationId)?.title ?? state.latestConversationTitle,
      )),
  ).map((item) => ({
    ...item,
    conversationTitle: normalizeConversationMemoryDistillRecoveryTitle(
      sessionsById.get(item.conversationId)?.title ?? item.conversationTitle,
    ) ?? item.conversationTitle,
  }));

  return [...items, ...pendingStates].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp.trim() : '';
  const message = value.message && typeof value.message === 'object'
    ? value.message as Record<string, unknown>
    : null;

  if (!id || !timestamp || !message) {
    return null;
  }

  const role = typeof message.role === 'string' ? message.role.trim() : '';
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

function buildCheckpointSnapshotFromSessionFile(sessionFile: string, requestedAnchorMessageId?: string): CheckpointSnapshotBuildResult {
  const lines = parseSessionJsonLines(sessionFile);
  const messageEntries = lines
    .map((line, lineIndex) => {
      const message = parseSessionMessageLine(line.value);
      if (!message) {
        return null;
      }

      return {
        lineIndex,
        message,
      };
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

function normalizeDistilledText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

function normalizeOptionalDistilledText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = normalizeDistilledText(value, 220);
  return normalized.length > 0 ? normalized : undefined;
}

function currentDateYyyyMmDd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizeDistilledTag(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return normalized.length > 0 ? normalized : null;
}

function buildDefaultDistilledTitle(anchorPreview: string, anchorTimestamp: string): string {
  const normalizedPreview = normalizeDistilledText(anchorPreview, 88);
  if (normalizedPreview.length > 0 && normalizedPreview !== 'Checkpoint anchor' && !normalizedPreview.startsWith('(')) {
    return normalizedPreview;
  }

  const date = new Date(Date.parse(anchorTimestamp));
  if (Number.isFinite(date.getTime())) {
    return `Conversation memory ${date.toISOString().slice(0, 16).replace('T', ' ')}`;
  }

  return 'Conversation memory';
}

function parseSnapshotMessages(snapshotContent: string): SessionJsonMessageLine[] {
  return snapshotContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const message = parseSessionMessageLine(parsed);
        return message ? [message] : [];
      } catch {
        return [];
      }
    });
}

function deriveDistilledConversationMemoryDraft(options: SaveDistilledConversationMemoryOptions): DistilledConversationMemoryDraft {
  const snapshotMessages = parseSnapshotMessages(options.snapshot.snapshotContent);

  const userMessages = snapshotMessages
    .filter((message) => message.role === 'user')
    .map((message) => normalizeDistilledText(buildCheckpointAnchorPreview(message.content), 200))
    .filter((message) => message.length > 0);

  const assistantMessages = snapshotMessages
    .filter((message) => message.role === 'assistant')
    .map((message) => normalizeDistilledText(buildCheckpointAnchorPreview(message.content), 200))
    .filter((message) => message.length > 0 && message !== 'Checkpoint anchor');

  const userIntentCandidate = userMessages[userMessages.length - 1]
    ?? userMessages[0]
    ?? normalizeDistilledText(options.snapshot.anchor.preview, 200);
  const userIntent = userIntentCandidate.length > 0
    ? userIntentCandidate
    : 'Continue the same work with the same intent.';

  const learnedPoints = [...new Set([
    ...assistantMessages.slice(-2),
    options.snapshot.anchor.role === 'assistant' ? normalizeDistilledText(options.snapshot.anchor.preview, 200) : '',
  ].filter((value) => value.length > 0))].slice(0, 3);

  const carryForwardPoints = [
    options.relatedProjectIds.length > 0 ? `Related projects: ${options.relatedProjectIds.map((projectId) => `@${projectId}`).join(', ')}` : '',
    options.sourceCwd ? `Working directory at distillation: ${options.sourceCwd}` : '',
    `Anchor: ${options.snapshot.anchor.role} at ${new Date(options.snapshot.anchor.timestamp).toLocaleString()} — ${normalizeDistilledText(options.snapshot.anchor.preview, 160)}`,
  ].filter((value) => value.length > 0);

  const title = normalizeOptionalDistilledText(options.title) ?? buildDefaultDistilledTitle(options.snapshot.anchor.preview, options.snapshot.anchor.timestamp);

  const derivedSummary = normalizeDistilledText(
    options.summary
      ?? `User intent: ${userIntent}`,
    180,
  ) || 'Distilled memory from a conversation checkpoint.';

  const bodyLines = [
    `# ${title}`,
    '',
    derivedSummary,
    '',
    `At this checkpoint, the user intent was: ${userIntent}`,
  ];

  if (learnedPoints.length > 0) {
    bodyLines.push('', 'What the agent had learned by this point:');
    for (const point of learnedPoints) {
      bodyLines.push(`- ${point}`);
    }
  }

  if (carryForwardPoints.length > 0) {
    bodyLines.push('', 'Key carry-forward points:');
    for (const point of carryForwardPoints) {
      bodyLines.push(`- ${point}`);
    }
  }

  const sourceLabel = options.sourceConversationTitle
    ? `conversation "${options.sourceConversationTitle}"`
    : 'conversation context';

  bodyLines.push('', `_Distilled from ${sourceLabel} on ${new Date(options.snapshot.anchor.timestamp).toLocaleString()}._`);

  return {
    title,
    summary: derivedSummary,
    body: `${bodyLines.join('\n')}\n`,
    userIntent,
    learnedPoints,
    carryForwardPoints,
  };
}

function saveDistilledConversationMemory(options: SaveDistilledConversationMemoryOptions): MemoryDocItem & {
  disposition: 'updated-existing' | 'created-reference';
  reference: {
    path: string;
    relativePath: string;
    title: string;
    summary: string;
    updated: string;
  };
} {
  const memoryDir = ensureMemoryDocsDir();
  const draft = deriveDistilledConversationMemoryDraft(options);
  const updated = currentDateYyyyMmDd();
  const distilledAt = new Date().toISOString();
  const area = options.relatedProjectIds.length === 1
    ? normalizeDistilledTag(options.relatedProjectIds[0] ?? '') ?? undefined
    : undefined;
  const loaded = loadMemoryDocs({ profilesRoot: getProfilesRoot() });
  const saved = saveCuratedDistilledConversationMemory({
    memoryDir,
    existingDocs: loaded.docs,
    draft,
    updated,
    distilledAt,
    area,
    sourceConversationTitle: options.sourceConversationTitle,
    sourceCwd: options.sourceCwd,
    sourceProfile: options.sourceProfile,
    relatedProjectIds: options.relatedProjectIds,
    anchorPreview: normalizeDistilledText(options.snapshot.anchor.preview, 180),
  });

  return {
    ...saved.memory,
    disposition: saved.disposition,
    reference: saved.reference,
    recentSessionCount: 0,
    lastUsedAt: null,
    usedInLastSession: false,
  } satisfies MemoryDocItem & {
    disposition: 'updated-existing' | 'created-reference';
    reference: {
      path: string;
      relativePath: string;
      title: string;
      summary: string;
      updated: string;
    };
  };
}

type SavedConversationMemoryRecord = ReturnType<typeof saveDistilledConversationMemory>;

export interface DistillConversationMemoryNowResult {
  conversationId: string;
  memory: SavedConversationMemoryRecord;
  disposition: SavedConversationMemoryRecord['disposition'];
  reference: SavedConversationMemoryRecord['reference'];
  activityId?: string;
}

export async function distillConversationMemoryNow(input: DistillConversationMemoryNowInput): Promise<DistillConversationMemoryNowResult> {
  const normalizedCheckpointId = typeof input.checkpointId === 'string' && input.checkpointId.trim().length > 0
    ? input.checkpointId.trim()
    : undefined;

  if (!normalizedCheckpointId && liveRegistry.get(input.conversationId)?.session.isStreaming) {
    throw new Error('Stop the current response before distilling a note node.');
  }

  const sourceSession = listConversationSessionsSnapshot().find((session) => session.id === input.conversationId);
  const maintenanceState = readConversationMemoryMaintenanceState({
    profile: input.profile,
    conversationId: input.conversationId,
  });
  const relatedProjectIds = getConversationProjectLink({
    profile: input.profile,
    conversationId: input.conversationId,
  })?.relatedProjectIds ?? [];

  const snapshot = normalizedCheckpointId
    ? readConversationCheckpointSnapshotFromState({
        profile: input.profile,
        conversationId: input.conversationId,
        checkpointId: normalizedCheckpointId,
      })
    : (() => {
        const sessionFile = resolveConversationSessionFile(input.conversationId);
        if (!sessionFile || !existsSync(sessionFile)) {
          throw new Error('Conversation not found.');
        }
        return buildCheckpointSnapshotFromSessionFile(sessionFile, input.anchorMessageId);
      })();

  const memory = saveDistilledConversationMemory({
    title: input.title,
    summary: input.summary,
    sourceConversationTitle: sourceSession?.title ?? maintenanceState?.latestConversationTitle,
    sourceCwd: sourceSession?.cwd ?? maintenanceState?.latestCwd,
    sourceProfile: input.profile,
    relatedProjectIds,
    snapshot,
  });

  const activitySummary = memory.disposition === 'updated-existing'
    ? `Updated note reference in @${memory.id}`
    : `Created note reference in @${memory.id}`;
  const activityDetails = [
    memory.disposition === 'updated-existing'
      ? `Updated an existing reference inside durable note node @${memory.id} from this conversation.`
      : `Created a new reference inside durable note node @${memory.id} from this conversation.`,
    `Hub title: ${memory.title}`,
    memory.summary ? `Hub summary: ${memory.summary}` : undefined,
    `Reference: ${memory.reference.title}`,
    `Reference path: ${memory.reference.relativePath}`,
  ].filter((line): line is string => Boolean(line)).join('\n');

  const activityId = input.emitActivity
    ? writeConversationMemoryDistillActivity({
        profile: input.profile,
        conversationId: input.conversationId,
        kind: 'conversation-node-distilled',
        summary: activitySummary,
        details: activityDetails,
        relatedProjectIds,
      })
    : undefined;

  if (normalizedCheckpointId) {
    markConversationMemoryMaintenanceRunCompleted({
      profile: input.profile,
      conversationId: input.conversationId,
      checkpointId: normalizedCheckpointId,
      memoryId: memory.id,
      referencePath: memory.reference.relativePath,
    });
  }

  return {
    conversationId: input.conversationId,
    memory,
    disposition: memory.disposition,
    reference: memory.reference,
    ...(activityId ? { activityId } : {}),
  };
}

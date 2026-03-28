import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager, type SessionEntry } from '@mariozechner/pi-coding-agent';
import {
  appendDurableRunEvent,
  loadDurableRunCheckpoint,
  resolveDaemonPaths,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  startBackgroundRun,
  type ScannedDurableRun,
} from '@personal-agent/daemon';
import {
  getExecutionTarget,
  listExecutionTargets,
  setConversationExecutionTarget,
  setConversationProjectLinks,
  type ExecutionTargetPathMapping,
  type ExecutionTargetRecord,
} from '@personal-agent/core';
import { buildContentDispositionHeader } from './httpHeaders.js';
import {
  appendDetachedUserMessage,
  appendVisibleCustomMessage,
  ensureSessionFileExists,
  patchSessionManagerPersistence,
  registry as liveRegistry,
  resolvePersistentSessionDir,
} from './liveSessions.js';
import {
  buildDisplayBlocksFromEntries,
  buildDisplayMessageEntriesFromSessionEntries,
  type DisplayBlock,
} from './sessions.js';

export const REMOTE_EXECUTION_RUN_SOURCE_TYPE = 'conversation-remote-run';
const REMOTE_EXECUTION_RESULT_FILE = 'remote-execution.json';
const REMOTE_EXECUTION_SESSION_FILE = 'remote-session.jsonl';
const REMOTE_EXECUTION_IMPORT_CUSTOM_TYPE = 'remote_run_import';
const REMOTE_EXECUTION_WORKER_PATH = fileURLToPath(new URL('./remoteExecutionWorker.mjs', import.meta.url));

export type RemoteRunImportStatus = 'not_ready' | 'ready' | 'imported' | 'failed';

export interface RemoteExecutionCheckpointState {
  version: 1;
  targetId: string;
  targetLabel: string;
  transport: 'ssh';
  conversationId: string;
  localCwd: string;
  remoteCwd: string;
  prompt: string;
  submittedAt: string;
  import?: {
    status: 'imported' | 'failed';
    updatedAt: string;
    importedAt?: string;
    messageId?: string;
    summary?: string;
    error?: string;
  };
}

export interface RemoteExecutionResultBundle {
  version: 1;
  targetId: string;
  targetLabel: string;
  transport: 'ssh';
  sshDestination: string;
  conversationId: string;
  localCwd: string;
  remoteCwd: string;
  prompt: string;
  submittedAt: string;
  completedAt: string;
  bootstrapLeafId: string | null;
  bootstrapEntryCount: number;
  remoteSessionPath: string;
}

interface RemoteExecutionRequestBundle {
  version: 1;
  target: ExecutionTargetRecord;
  conversationId: string;
  localCwd: string;
  remoteCwd: string;
  prompt: string;
  submittedAt: string;
  bootstrapSessionFile: string;
  bootstrapLeafId: string | null;
  bootstrapEntryCount: number;
}

export interface RemoteExecutionRunSummary {
  targetId: string;
  targetLabel: string;
  transport: 'ssh';
  conversationId: string;
  localCwd: string;
  remoteCwd: string;
  prompt: string;
  submittedAt: string;
  importStatus: RemoteRunImportStatus;
  importedAt?: string;
  importSummary?: string;
  importError?: string;
  transcriptAvailable: boolean;
  transcriptFileName?: string;
}

export interface ExecutionTargetSummary extends ExecutionTargetRecord {
  activeRunCount: number;
  readyImportCount: number;
  latestRunAt?: string;
}

export interface ExecutionTargetsState {
  targets: ExecutionTargetSummary[];
  sshBinary: {
    available: boolean;
    command: string;
    path?: string;
    version?: string;
    error?: string;
  };
  summary: {
    totalTargets: number;
    activeRemoteRuns: number;
    readyImports: number;
  };
}

export interface ConversationExecutionState {
  conversationId: string;
  targetId: string | null;
  location: 'local' | 'remote';
  target: ExecutionTargetSummary | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readOptionalString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeIsoTimestamp(value: unknown, label: string): string {
  const normalized = readRequiredString(value, label);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${normalized}`);
  }

  return new Date(parsed).toISOString();
}

function normalizeImportState(value: unknown): RemoteExecutionCheckpointState['import'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = value.status === 'imported' || value.status === 'failed'
    ? value.status
    : undefined;
  const updatedAt = readOptionalString(value.updatedAt);
  if (!status || !updatedAt) {
    return undefined;
  }

  return {
    status,
    updatedAt: normalizeIsoTimestamp(updatedAt, 'remote execution import updatedAt'),
    ...(readOptionalString(value.importedAt) ? { importedAt: normalizeIsoTimestamp(value.importedAt, 'remote execution import importedAt') } : {}),
    ...(readOptionalString(value.messageId) ? { messageId: readOptionalString(value.messageId) } : {}),
    ...(readOptionalString(value.summary) ? { summary: readOptionalString(value.summary) } : {}),
    ...(readOptionalString(value.error) ? { error: readOptionalString(value.error) } : {}),
  };
}

function normalizeRemoteExecutionCheckpointState(value: unknown): RemoteExecutionCheckpointState | null {
  if (!isRecord(value)) {
    return null;
  }

  const version = typeof value.version === 'number' ? value.version : 1;
  if (version !== 1) {
    return null;
  }

  const targetId = readOptionalString(value.targetId);
  const targetLabel = readOptionalString(value.targetLabel);
  const transport = value.transport === 'ssh' ? value.transport : undefined;
  const conversationId = readOptionalString(value.conversationId);
  const localCwd = readOptionalString(value.localCwd);
  const remoteCwd = readOptionalString(value.remoteCwd);
  const prompt = readOptionalString(value.prompt);
  const submittedAt = readOptionalString(value.submittedAt);

  if (!targetId || !targetLabel || !transport || !conversationId || !localCwd || !remoteCwd || !prompt || !submittedAt) {
    return null;
  }

  return {
    version: 1,
    targetId,
    targetLabel,
    transport,
    conversationId,
    localCwd,
    remoteCwd,
    prompt,
    submittedAt: normalizeIsoTimestamp(submittedAt, 'remote execution submittedAt'),
    ...(normalizeImportState(value.import) ? { import: normalizeImportState(value.import) } : {}),
  };
}

function normalizeRemoteExecutionResultBundle(value: unknown): RemoteExecutionResultBundle | null {
  if (!isRecord(value)) {
    return null;
  }

  const version = typeof value.version === 'number' ? value.version : 1;
  if (version !== 1) {
    return null;
  }

  const targetId = readOptionalString(value.targetId);
  const targetLabel = readOptionalString(value.targetLabel);
  const transport = value.transport === 'ssh' ? value.transport : undefined;
  const sshDestination = readOptionalString(value.sshDestination);
  const conversationId = readOptionalString(value.conversationId);
  const localCwd = readOptionalString(value.localCwd);
  const remoteCwd = readOptionalString(value.remoteCwd);
  const prompt = readOptionalString(value.prompt);
  const submittedAt = readOptionalString(value.submittedAt);
  const completedAt = readOptionalString(value.completedAt);
  const remoteSessionPath = readOptionalString(value.remoteSessionPath);
  const bootstrapLeafId = value.bootstrapLeafId === null ? null : readOptionalString(value.bootstrapLeafId) ?? null;
  const bootstrapEntryCount = typeof value.bootstrapEntryCount === 'number' && Number.isInteger(value.bootstrapEntryCount) && value.bootstrapEntryCount >= 0
    ? value.bootstrapEntryCount
    : undefined;

  if (
    !targetId
    || !targetLabel
    || !transport
    || !sshDestination
    || !conversationId
    || !localCwd
    || !remoteCwd
    || !prompt
    || !submittedAt
    || !completedAt
    || !remoteSessionPath
    || bootstrapEntryCount === undefined
  ) {
    return null;
  }

  return {
    version: 1,
    targetId,
    targetLabel,
    transport,
    sshDestination,
    conversationId,
    localCwd,
    remoteCwd,
    prompt,
    submittedAt: normalizeIsoTimestamp(submittedAt, 'remote execution submittedAt'),
    completedAt: normalizeIsoTimestamp(completedAt, 'remote execution completedAt'),
    bootstrapLeafId,
    bootstrapEntryCount,
    remoteSessionPath,
  };
}

function readCheckpointRemoteExecutionState(run: Pick<ScannedDurableRun, 'checkpoint'>): RemoteExecutionCheckpointState | null {
  const payload = isRecord(run.checkpoint?.payload) ? run.checkpoint.payload : undefined;
  return normalizeRemoteExecutionCheckpointState(payload?.remoteExecution);
}

function readRemoteExecutionResultBundle(runRoot: string): RemoteExecutionResultBundle | null {
  const path = join(runRoot, REMOTE_EXECUTION_RESULT_FILE);
  if (!existsSync(path)) {
    return null;
  }

  try {
    return normalizeRemoteExecutionResultBundle(JSON.parse(readFileSync(path, 'utf-8')) as unknown);
  } catch {
    return null;
  }
}

function remoteExecutionSessionCopyPath(runRoot: string): string {
  return join(runRoot, REMOTE_EXECUTION_SESSION_FILE);
}

function transcriptFileName(runId: string): string {
  return `${runId}-remote-transcript.md`;
}

export function isRemoteExecutionRun(run: Pick<ScannedDurableRun, 'manifest' | 'checkpoint'>): boolean {
  return run.manifest?.source?.type === REMOTE_EXECUTION_RUN_SOURCE_TYPE
    || readCheckpointRemoteExecutionState(run) !== null;
}

export function decorateRemoteExecutionRun<T extends ScannedDurableRun>(run: T): T & {
  location: 'local' | 'remote';
  remoteExecution?: RemoteExecutionRunSummary;
} {
  const checkpointState = readCheckpointRemoteExecutionState(run);
  if (!checkpointState) {
    return {
      ...run,
      location: 'local',
    };
  }

  const resultBundle = readRemoteExecutionResultBundle(run.paths.root);
  const executionCompleted = run.status?.status === 'completed';
  const transcriptAvailable = Boolean(resultBundle && existsSync(remoteExecutionSessionCopyPath(run.paths.root)));
  const importStatus: RemoteRunImportStatus = checkpointState.import?.status === 'imported'
    ? 'imported'
    : checkpointState.import?.status === 'failed'
      ? 'failed'
      : executionCompleted
        ? (transcriptAvailable ? 'ready' : 'failed')
        : 'not_ready';

  return {
    ...run,
    location: 'remote',
    remoteExecution: {
      targetId: checkpointState.targetId,
      targetLabel: checkpointState.targetLabel,
      transport: checkpointState.transport,
      conversationId: checkpointState.conversationId,
      localCwd: checkpointState.localCwd,
      remoteCwd: checkpointState.remoteCwd,
      prompt: checkpointState.prompt,
      submittedAt: checkpointState.submittedAt,
      importStatus,
      ...(checkpointState.import?.importedAt ? { importedAt: checkpointState.import.importedAt } : {}),
      ...(checkpointState.import?.summary ? { importSummary: checkpointState.import.summary } : {}),
      ...(checkpointState.import?.error
        ? { importError: checkpointState.import.error }
        : (executionCompleted && !transcriptAvailable ? { importError: 'Remote transcript bundle is missing.' } : {})),
      transcriptAvailable,
      ...(transcriptAvailable ? { transcriptFileName: transcriptFileName(run.runId) } : {}),
    },
  };
}

function resolveRemoteCwdFromMappings(localCwd: string, mappings: ExecutionTargetPathMapping[]): string | null {
  const normalizedLocalCwd = localCwd.replace(/\\/g, '/').replace(/\/$/, '');

  for (const mapping of mappings) {
    if (normalizedLocalCwd === mapping.localPrefix || normalizedLocalCwd.startsWith(`${mapping.localPrefix}/`)) {
      const remainder = normalizedLocalCwd.slice(mapping.localPrefix.length).replace(/^\//, '');
      return remainder.length > 0
        ? `${mapping.remotePrefix}/${remainder}`.replace(/\/+/g, '/')
        : mapping.remotePrefix;
    }
  }

  return null;
}

export function resolveRemoteExecutionCwd(target: ExecutionTargetRecord, localCwd: string): string {
  const mapped = resolveRemoteCwdFromMappings(localCwd, target.cwdMappings);
  if (mapped) {
    return mapped;
  }

  if (target.defaultRemoteCwd) {
    return target.defaultRemoteCwd;
  }

  throw new Error(`Execution target ${target.id} does not define a matching cwd mapping or default remote cwd for ${localCwd}.`);
}

function buildUserMessage(text: string) {
  return {
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    timestamp: Date.now(),
  };
}

async function createStoredConversation(options: {
  cwd: string;
  text: string;
  profile: string;
  referencedProjectIds: string[];
}): Promise<{ conversationId: string; sessionFile: string; localCwd: string }> {
  const sessionManager = SessionManager.create(options.cwd, resolvePersistentSessionDir(options.cwd));
  patchSessionManagerPersistence(sessionManager);
  const sessionFile = sessionManager.getSessionFile();
  const conversationId = sessionManager.getSessionId();
  if (!sessionFile) {
    throw new Error('Could not create a stored conversation session file.');
  }

  sessionManager.appendMessage(buildUserMessage(options.text));
  ensureSessionFileExists(sessionManager);

  if (options.referencedProjectIds.length > 0) {
    setConversationProjectLinks({
      profile: options.profile,
      conversationId,
      relatedProjectIds: options.referencedProjectIds,
    });
  }

  return {
    conversationId,
    sessionFile,
    localCwd: options.cwd,
  };
}

function resolveConversationSessionFileForRemoteRun(options: {
  conversationId: string;
  sessionFile?: string;
}): string {
  const liveEntry = liveRegistry.get(options.conversationId);
  if (liveEntry) {
    ensureSessionFileExists(liveEntry.session.sessionManager);
  }

  const liveSessionFile = readOptionalString(liveEntry?.session.sessionFile);
  if (liveSessionFile && existsSync(liveSessionFile)) {
    return liveSessionFile;
  }

  const providedSessionFile = readOptionalString(options.sessionFile);
  if (providedSessionFile && existsSync(providedSessionFile)) {
    return providedSessionFile;
  }

  if (liveSessionFile) {
    return liveSessionFile;
  }

  if (providedSessionFile) {
    return providedSessionFile;
  }

  throw new Error(`Conversation ${options.conversationId} does not have a persisted session transcript file.`);
}

async function appendUserMessageToConversation(options: {
  conversationId: string;
  sessionFile?: string;
  text: string;
}): Promise<{ localCwd: string; sessionFile: string }> {
  const liveEntry = liveRegistry.get(options.conversationId);
  if (liveEntry) {
    if (liveEntry.session.isStreaming) {
      throw new Error('Wait for the current local turn to finish before offloading work remotely.');
    }

    await appendDetachedUserMessage(options.conversationId, options.text);
    return {
      localCwd: liveEntry.cwd,
      sessionFile: resolveConversationSessionFileForRemoteRun(options),
    };
  }

  const sessionFile = resolveConversationSessionFileForRemoteRun(options);
  const manager = SessionManager.open(sessionFile);
  patchSessionManagerPersistence(manager);
  manager.appendMessage(buildUserMessage(options.text));
  ensureSessionFileExists(manager);
  return {
    localCwd: manager.getCwd(),
    sessionFile,
  };
}

function createRemoteExecutionCheckpointState(input: {
  target: ExecutionTargetRecord;
  conversationId: string;
  localCwd: string;
  remoteCwd: string;
  prompt: string;
  submittedAt: string;
}): RemoteExecutionCheckpointState {
  return {
    version: 1,
    targetId: input.target.id,
    targetLabel: input.target.label,
    transport: 'ssh',
    conversationId: input.conversationId,
    localCwd: input.localCwd,
    remoteCwd: input.remoteCwd,
    prompt: input.prompt,
    submittedAt: input.submittedAt,
  };
}

async function createRemoteExecutionRequestBundle(input: {
  target: ExecutionTargetRecord;
  conversationId: string;
  localCwd: string;
  remoteCwd: string;
  prompt: string;
  sessionFile: string;
  submittedAt: string;
}): Promise<{ bundlePath: string }> {
  const bundleDir = mkdtempSync(join(tmpdir(), 'pa-remote-execution-'));
  const bootstrapSessionFile = join(bundleDir, 'bootstrap-session.jsonl');
  copyFileSync(input.sessionFile, bootstrapSessionFile);

  const manager = SessionManager.open(bootstrapSessionFile);
  const requestBundle: RemoteExecutionRequestBundle = {
    version: 1,
    target: input.target,
    conversationId: input.conversationId,
    localCwd: input.localCwd,
    remoteCwd: input.remoteCwd,
    prompt: input.prompt,
    submittedAt: input.submittedAt,
    bootstrapSessionFile,
    bootstrapLeafId: manager.getLeafId(),
    bootstrapEntryCount: manager.getEntries().length,
  };

  const bundlePath = join(bundleDir, 'request.json');
  writeFileSync(bundlePath, `${JSON.stringify(requestBundle, null, 2)}\n`);
  return { bundlePath };
}

export async function submitRemoteExecutionRun(options: {
  conversationId?: string;
  sessionFile?: string;
  cwd?: string;
  referencedProjectIds?: string[];
  text: string;
  targetId: string;
  profile: string;
  repoRoot: string;
}): Promise<{ conversationId: string; sessionFile: string; runId: string; remoteCwd: string; target: ExecutionTargetRecord }> {
  const prompt = options.text.trim();
  if (!prompt) {
    throw new Error('Remote execution prompt is required.');
  }

  const target = getExecutionTarget({ targetId: options.targetId });
  if (!target) {
    throw new Error(`Execution target ${options.targetId} not found.`);
  }

  let conversationId = readOptionalString(options.conversationId);
  let sessionFile = readOptionalString(options.sessionFile);
  let localCwd = '';

  if (!conversationId || !sessionFile) {
    const cwd = readOptionalString(options.cwd);
    if (!cwd) {
      throw new Error('A working directory is required to start a remote conversation run.');
    }

    const created = await createStoredConversation({
      cwd,
      text: prompt,
      profile: options.profile,
      referencedProjectIds: options.referencedProjectIds ?? [],
    });
    conversationId = created.conversationId;
    sessionFile = created.sessionFile;
    localCwd = created.localCwd;
  } else {
    const appended = await appendUserMessageToConversation({
      conversationId,
      sessionFile,
      text: prompt,
    });
    localCwd = appended.localCwd;
    sessionFile = appended.sessionFile;
  }

  const remoteCwd = resolveRemoteExecutionCwd(target, localCwd);
  const submittedAt = new Date().toISOString();
  const checkpointState = createRemoteExecutionCheckpointState({
    target,
    conversationId,
    localCwd,
    remoteCwd,
    prompt,
    submittedAt,
  });
  const requestBundle = await createRemoteExecutionRequestBundle({
    target,
    conversationId,
    localCwd,
    remoteCwd,
    prompt,
    sessionFile,
    submittedAt,
  });

  try {
    const result = await startBackgroundRun({
      taskSlug: `remote-${target.id}-${conversationId}`,
      cwd: options.repoRoot,
      argv: [process.execPath, REMOTE_EXECUTION_WORKER_PATH, requestBundle.bundlePath],
      source: {
        type: REMOTE_EXECUTION_RUN_SOURCE_TYPE,
        id: conversationId,
        filePath: sessionFile,
      },
      manifestMetadata: {
        remoteExecution: checkpointState,
      },
      checkpointPayload: {
        remoteExecution: checkpointState,
      },
    });

    if (!result.accepted) {
      throw new Error(result.reason ?? 'The daemon did not accept the remote run.');
    }

    setConversationExecutionTarget({
      profile: options.profile,
      conversationId,
      targetId: target.id,
      updatedAt: submittedAt,
    });

    return {
      conversationId,
      sessionFile,
      runId: result.runId,
      remoteCwd,
      target,
    };
  } catch (error) {
    await rm(join(requestBundle.bundlePath, '..'), { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function resolveRemoteExecutionRunPaths(runId: string) {
  return resolveDurableRunPaths(resolveDurableRunsRoot(resolveDaemonPaths().root), runId);
}

async function updateRemoteExecutionImportState(
  run: ScannedDurableRun,
  nextImport: NonNullable<RemoteExecutionCheckpointState['import']>,
): Promise<void> {
  const checkpoint = loadDurableRunCheckpoint(run.paths.checkpointPath);
  const payload = isRecord(checkpoint?.payload) ? checkpoint.payload : {};
  const remoteExecution = normalizeRemoteExecutionCheckpointState(payload.remoteExecution);
  if (!checkpoint || !remoteExecution) {
    throw new Error(`Run ${run.runId} does not contain remote execution metadata.`);
  }

  const updatedAt = nextImport.updatedAt;
  saveDurableRunCheckpoint(run.paths.checkpointPath, {
    ...checkpoint,
    updatedAt,
    payload: {
      ...payload,
      remoteExecution: {
        ...remoteExecution,
        import: nextImport,
      },
    },
  });

  await appendDurableRunEvent(run.paths.eventsPath, {
    version: 1,
    runId: run.runId,
    timestamp: updatedAt,
    type: nextImport.status === 'imported' ? 'remote_execution.imported' : 'remote_execution.import_failed',
    payload: {
      targetId: remoteExecution.targetId,
      conversationId: remoteExecution.conversationId,
      ...(nextImport.summary ? { summary: nextImport.summary } : {}),
      ...(nextImport.error ? { error: nextImport.error } : {}),
    },
  });
}

function readRemoteExecutionConversationId(run: Pick<ScannedDurableRun, 'checkpoint'>): string | null {
  return readCheckpointRemoteExecutionState(run)?.conversationId ?? null;
}

function collectDeltaSessionEntries(entries: SessionEntry[], bundle: RemoteExecutionResultBundle): SessionEntry[] {
  const leafIndex = bundle.bootstrapLeafId
    ? entries.findIndex((entry) => entry.id === bundle.bootstrapLeafId)
    : -1;
  const startIndex = leafIndex >= 0
    ? leafIndex + 1
    : Math.min(bundle.bootstrapEntryCount, entries.length);

  return entries.slice(startIndex);
}

function buildRemoteTranscriptBlocks(run: ScannedDurableRun): { bundle: RemoteExecutionResultBundle; blocks: DisplayBlock[] } {
  const bundle = readRemoteExecutionResultBundle(run.paths.root);
  if (!bundle) {
    throw new Error(`Run ${run.runId} is missing a remote execution result bundle.`);
  }

  const sessionCopyPath = remoteExecutionSessionCopyPath(run.paths.root);
  if (!existsSync(sessionCopyPath)) {
    throw new Error(`Run ${run.runId} is missing the copied remote session transcript.`);
  }

  const manager = SessionManager.open(sessionCopyPath);
  const deltaEntries = collectDeltaSessionEntries(manager.getBranch(), bundle);
  const blocks = buildDisplayBlocksFromEntries(buildDisplayMessageEntriesFromSessionEntries(deltaEntries));
  return { bundle, blocks };
}

function summarizeRemoteTranscript(blocks: DisplayBlock[]): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type === 'text') {
      const normalized = block.text.replace(/\s+/g, ' ').trim();
      if (normalized.length > 0) {
        return normalized.length > 220 ? `${normalized.slice(0, 219).trimEnd()}…` : normalized;
      }
    }

    if (block?.type === 'error') {
      const normalized = block.message.replace(/\s+/g, ' ').trim();
      if (normalized.length > 0) {
        return normalized.length > 220 ? `${normalized.slice(0, 219).trimEnd()}…` : normalized;
      }
    }
  }

  const toolCount = blocks.filter((block) => block.type === 'tool_use').length;
  if (toolCount > 0) {
    return `Remote execution finished after ${toolCount} tool ${toolCount === 1 ? 'call' : 'calls'}.`;
  }

  return 'Remote execution finished without a textual response.';
}

function formatTranscriptSectionHeading(label: string): string {
  return `## ${label}`;
}

function buildRemoteTranscriptMarkdown(run: ScannedDurableRun): { bundle: RemoteExecutionResultBundle; summary: string; markdown: string } {
  const { bundle, blocks } = buildRemoteTranscriptBlocks(run);
  const lines = [
    '# Remote execution transcript',
    '',
    `- run: ${run.runId}`,
    `- target: ${bundle.targetLabel} (${bundle.targetId})`,
    `- transport: ${bundle.transport}`,
    `- remote cwd: ${bundle.remoteCwd}`,
    `- submitted at: ${bundle.submittedAt}`,
    `- completed at: ${bundle.completedAt}`,
    '',
  ];

  if (blocks.length === 0) {
    lines.push('_No remote transcript delta was recorded._');
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'user':
        lines.push(formatTranscriptSectionHeading('User'), '', block.text || '_Empty user message._', '');
        break;
      case 'text':
        lines.push(formatTranscriptSectionHeading('Assistant'), '', block.text || '_Empty assistant message._', '');
        break;
      case 'thinking':
        lines.push(formatTranscriptSectionHeading('Thinking'), '', block.text, '');
        break;
      case 'summary':
        lines.push(formatTranscriptSectionHeading(block.title), '', block.text, '');
        break;
      case 'tool_use':
        lines.push(formatTranscriptSectionHeading(`Tool · ${block.tool}`), '');
        lines.push('Input:');
        lines.push('```json');
        lines.push(JSON.stringify(block.input, null, 2));
        lines.push('```');
        lines.push('');
        lines.push('Output:');
        lines.push('```text');
        lines.push(block.output || '(empty)');
        lines.push('```');
        lines.push('');
        break;
      case 'image':
        lines.push(formatTranscriptSectionHeading('Image output'), '', block.caption || block.alt || '(image)', '');
        break;
      case 'error':
        lines.push(formatTranscriptSectionHeading('Error'), '', block.message, '');
        break;
    }
  }

  return {
    bundle,
    summary: summarizeRemoteTranscript(blocks),
    markdown: `${lines.join('\n').trim()}\n`,
  };
}

function buildRemoteImportMessage(input: {
  runId: string;
  targetLabel: string;
  remoteCwd: string;
  importedAt: string;
  summary: string;
}): string {
  return [
    `Remote execution imported from ${input.targetLabel}.`,
    '',
    `Summary: ${input.summary}`,
    `Remote cwd: ${input.remoteCwd}`,
    `Run: ${input.runId}`,
    `Imported at: ${input.importedAt}`,
    '',
    'The full remote transcript is attached to the linked remote run.',
  ].join('\n');
}

function buildRemoteImportDetails(input: {
  runId: string;
  targetId: string;
  targetLabel: string;
  remoteCwd: string;
  summary: string;
  importedAt: string;
}) {
  return {
    runId: input.runId,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    remoteCwd: input.remoteCwd,
    summary: input.summary,
    importedAt: input.importedAt,
    transcriptFileName: transcriptFileName(input.runId),
  };
}

async function appendRemoteImportMessage(options: {
  conversationId: string;
  sessionFile: string;
  content: string;
  details: Record<string, unknown>;
}): Promise<string | undefined> {
  const liveEntry = liveRegistry.get(options.conversationId);
  if (liveEntry) {
    if (liveEntry.session.isStreaming) {
      throw new Error('Wait for the current local turn to finish before importing remote execution.');
    }

    await appendVisibleCustomMessage(options.conversationId, REMOTE_EXECUTION_IMPORT_CUSTOM_TYPE, options.content, options.details);
    return undefined;
  }

  const manager = SessionManager.open(options.sessionFile);
  patchSessionManagerPersistence(manager);
  const messageId = manager.appendCustomMessageEntry(REMOTE_EXECUTION_IMPORT_CUSTOM_TYPE, options.content, true, options.details);
  ensureSessionFileExists(manager);
  return messageId;
}

export async function importRemoteExecutionRun(options: {
  run: ScannedDurableRun;
  sessionFile: string;
}): Promise<{ conversationId: string; summary: string; importedAt: string }> {
  const remoteExecution = decorateRemoteExecutionRun(options.run).remoteExecution;
  if (!remoteExecution) {
    throw new Error(`Run ${options.run.runId} is not a remote execution run.`);
  }

  if (options.run.status?.status !== 'completed') {
    throw new Error(`Run ${options.run.runId} has not completed remote execution yet.`);
  }

  if (remoteExecution.importStatus === 'imported') {
    throw new Error(`Run ${options.run.runId} has already been imported.`);
  }

  const importedAt = new Date().toISOString();

  try {
    const transcript = buildRemoteTranscriptMarkdown(options.run);
    const content = buildRemoteImportMessage({
      runId: options.run.runId,
      targetLabel: remoteExecution.targetLabel,
      remoteCwd: remoteExecution.remoteCwd,
      importedAt,
      summary: transcript.summary,
    });
    const details = buildRemoteImportDetails({
      runId: options.run.runId,
      targetId: remoteExecution.targetId,
      targetLabel: remoteExecution.targetLabel,
      remoteCwd: remoteExecution.remoteCwd,
      summary: transcript.summary,
      importedAt,
    });

    const messageId = await appendRemoteImportMessage({
      conversationId: remoteExecution.conversationId,
      sessionFile: options.sessionFile,
      content,
      details,
    });

    await updateRemoteExecutionImportState(options.run, {
      status: 'imported',
      updatedAt: importedAt,
      importedAt,
      ...(messageId ? { messageId } : {}),
      summary: transcript.summary,
    });

    return {
      conversationId: remoteExecution.conversationId,
      summary: transcript.summary,
      importedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateRemoteExecutionImportState(options.run, {
      status: 'failed',
      updatedAt: importedAt,
      error: message,
    });
    throw error;
  }
}

export function buildRemoteExecutionTranscriptResponse(run: ScannedDurableRun): {
  fileName: string;
  content: string;
  contentType: string;
  contentDisposition: string;
} {
  const transcript = buildRemoteTranscriptMarkdown(run);
  const fileName = transcriptFileName(run.runId);
  return {
    fileName,
    content: transcript.markdown,
    contentType: 'text/markdown; charset=utf-8',
    contentDisposition: buildContentDispositionHeader('attachment', fileName),
  };
}

export function buildExecutionTargetsState(options: {
  runs: ScannedDurableRun[];
  inspectSshBinary: () => ExecutionTargetsState['sshBinary'];
}): ExecutionTargetsState {
  const sshBinary = options.inspectSshBinary();
  const remoteRuns = options.runs
    .map((run) => decorateRemoteExecutionRun(run))
    .filter((run): run is ReturnType<typeof decorateRemoteExecutionRun> & { remoteExecution: RemoteExecutionRunSummary } => Boolean(run.remoteExecution));

  const targets = listExecutionTargets().map((target) => {
    const targetRuns = remoteRuns.filter((run) => run.remoteExecution.targetId === target.id);
    const latestRunAt = targetRuns
      .map((run) => run.status?.updatedAt ?? run.status?.completedAt ?? run.manifest?.createdAt)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort((left, right) => right.localeCompare(left))[0];

    return {
      ...target,
      activeRunCount: targetRuns.filter((run) => run.status?.status === 'running' || run.status?.status === 'recovering').length,
      readyImportCount: targetRuns.filter((run) => run.remoteExecution.importStatus === 'ready').length,
      ...(latestRunAt ? { latestRunAt } : {}),
    } satisfies ExecutionTargetSummary;
  });

  return {
    targets,
    sshBinary,
    summary: {
      totalTargets: targets.length,
      activeRemoteRuns: targets.reduce((sum, target) => sum + target.activeRunCount, 0),
      readyImports: targets.reduce((sum, target) => sum + target.readyImportCount, 0),
    },
  };
}

export function buildConversationExecutionState(options: {
  conversationId: string;
  targetId: string | null;
  runs: ScannedDurableRun[];
  inspectSshBinary: () => ExecutionTargetsState['sshBinary'];
}): ConversationExecutionState {
  const targetsState = buildExecutionTargetsState({
    runs: options.runs,
    inspectSshBinary: options.inspectSshBinary,
  });
  const target = options.targetId ? targetsState.targets.find((candidate) => candidate.id === options.targetId) ?? null : null;

  return {
    conversationId: options.conversationId,
    targetId: options.targetId,
    location: target ? 'remote' : 'local',
    target,
  };
}

export function readRemoteExecutionRunConversationId(run: ScannedDurableRun): string | null {
  return readRemoteExecutionConversationId(run);
}

export function resolveRemoteExecutionRunPathsForId(runId: string) {
  return resolveRemoteExecutionRunPaths(runId);
}

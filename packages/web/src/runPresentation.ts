import type { DurableRunListResult, DurableRunRecord, RemoteExecutionRunSummary, ScheduledTaskSummary, SessionMeta } from './types';

const REMOTE_EXECUTION_RUN_SOURCE_TYPE = 'conversation-remote-run';
const CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE = 'conversation-node-distill';
const LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE = 'conversation-memory-distill';

function isConversationNodeDistillRunSourceType(value: string | undefined): boolean {
  return value === CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE
    || value === LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE;
}

export interface RunPresentationLookups {
  tasks?: ScheduledTaskSummary[] | null;
  sessions?: SessionMeta[] | null;
}

export interface RunConnection {
  key: string;
  label: string;
  value: string;
  to?: string;
  detail?: string;
}

export interface RunHeadline {
  title: string;
  summary: string;
}

export interface RunMoment {
  label: 'completed' | 'updated' | 'started' | 'created';
  at?: string;
}

export type RunCategory = 'scheduled' | 'conversation' | 'deferred' | 'background' | 'other';
export type RunLocation = 'local' | 'remote';
export type RunImportState = 'not_ready' | 'ready' | 'imported' | 'failed' | null;

export interface ActiveRunsSummary {
  total: number;
  scheduled: number;
  conversation: number;
  deferred: number;
  background: number;
  other: number;
}

export function isRunInProgress(run: DurableRunRecord): boolean {
  const status = run.status?.status;
  return status === 'running' || status === 'recovering';
}

export function runNeedsAttention(run: DurableRunRecord, options?: { includeDismissed?: boolean }): boolean {
  const status = run.status?.status;
  const importState = getRunImportState(run);
  const needsAttention = run.problems.length > 0
    || run.recoveryAction === 'resume'
    || run.recoveryAction === 'rerun'
    || run.recoveryAction === 'attention'
    || run.recoveryAction === 'invalid'
    || status === 'failed'
    || status === 'interrupted'
    || status === 'recovering'
    || importState === 'ready'
    || importState === 'failed';

  return options?.includeDismissed ? needsAttention : needsAttention && !run.attentionDismissed;
}

export function summarizeActiveRuns(input: {
  tasks?: ScheduledTaskSummary[] | null;
  sessions?: SessionMeta[] | null;
  runs?: DurableRunListResult | null;
}): ActiveRunsSummary {
  const fallbackCounts = (input.runs?.runs ?? []).reduce<Record<RunCategory, number>>((counts, run) => {
    if (!isRunInProgress(run)) {
      return counts;
    }

    counts[getRunCategory(run)] += 1;
    return counts;
  }, {
    scheduled: 0,
    conversation: 0,
    deferred: 0,
    background: 0,
    other: 0,
  });

  const scheduled = input.tasks
    ? input.tasks.filter((task) => task.running).length
    : fallbackCounts.scheduled;
  const conversation = input.sessions
    ? input.sessions.filter((session) => session.isRunning).length
    : fallbackCounts.conversation;
  const deferred = fallbackCounts.deferred;
  const background = fallbackCounts.background;
  const other = fallbackCounts.other;

  return {
    total: scheduled + conversation + deferred + background + other,
    scheduled,
    conversation,
    deferred,
    background,
    other,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readSpec(run: DurableRunRecord, key: string): string | undefined {
  return isRecord(run.manifest?.spec) ? readString(run.manifest.spec, key) : undefined;
}

function readNestedSpec(run: DurableRunRecord, key: string, nestedKey: string): string | undefined {
  if (!isRecord(run.manifest?.spec)) {
    return undefined;
  }

  const value = run.manifest.spec[key];
  return isRecord(value) ? readString(value, nestedKey) : undefined;
}

function readCheckpoint(run: DurableRunRecord, key: string): string | undefined {
  return isRecord(run.checkpoint?.payload) ? readString(run.checkpoint.payload, key) : undefined;
}

function readNestedCheckpoint(run: DurableRunRecord, key: string, nestedKey: string): string | undefined {
  if (!isRecord(run.checkpoint?.payload)) {
    return undefined;
  }

  const value = run.checkpoint.payload[key];
  return isRecord(value) ? readString(value, nestedKey) : undefined;
}

function excerpt(value: string | undefined, maxLength = 88): string | undefined {
  if (!value) {
    return undefined;
  }

  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  const normalized = firstLine.replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

interface ShellToken {
  raw: string;
  start: number;
}

function tokenizeShell(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let index = 0;

  while (index < command.length) {
    while (index < command.length && /\s/.test(command[index] ?? '')) {
      index += 1;
    }

    if (index >= command.length) {
      break;
    }

    const start = index;
    let quote: '"' | "'" | null = null;

    while (index < command.length) {
      const char = command[index] ?? '';
      if (quote) {
        if (char === '\\' && quote === '"' && index + 1 < command.length) {
          index += 2;
          continue;
        }

        index += 1;
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        index += 1;
        continue;
      }

      if (char === '\\' && index + 1 < command.length) {
        index += 2;
        continue;
      }

      if (/\s/.test(char)) {
        break;
      }

      index += 1;
    }

    tokens.push({
      raw: command.slice(start, index),
      start,
    });
  }

  return tokens;
}

function shellTokenValue(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }

  return token;
}

function isShellEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function stripLeadingShellEnvironment(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }

  const tokens = tokenizeShell(trimmed);
  if (tokens.length === 0) {
    return trimmed;
  }

  let index = 0;
  if (shellTokenValue(tokens[0]?.raw ?? '') === 'env') {
    index = 1;

    while (index < tokens.length) {
      const token = shellTokenValue(tokens[index]?.raw ?? '');
      if (!token) {
        index += 1;
        continue;
      }

      if (token === '--') {
        index += 1;
        break;
      }

      if (
        token === '-u'
        || token === '--unset'
        || token === '-C'
        || token === '--chdir'
        || token === '-S'
        || token === '--split-string'
      ) {
        index += 2;
        continue;
      }

      if (
        token === '-i'
        || token === '--ignore-environment'
        || token === '-0'
        || token === '--null'
        || token.startsWith('--unset=')
        || token.startsWith('--chdir=')
        || (token.startsWith('-u') && token.length > 2)
        || (token.startsWith('-C') && token.length > 2)
      ) {
        index += 1;
        continue;
      }

      if (!token.startsWith('-')) {
        break;
      }

      index += 1;
    }
  }

  while (index < tokens.length && isShellEnvAssignment(tokens[index]?.raw ?? '')) {
    index += 1;
  }

  if (index <= 0 || index >= tokens.length) {
    return trimmed;
  }

  return trimmed.slice(tokens[index]?.start ?? 0).trim();
}

function excerptShellCommand(command: string | undefined, maxLength = 88): string | undefined {
  return excerpt(stripLeadingShellEnvironment(command), maxLength);
}

function taskById(lookups: RunPresentationLookups, taskId: string | undefined): ScheduledTaskSummary | undefined {
  if (!taskId || !lookups.tasks) {
    return undefined;
  }

  return lookups.tasks.find((task) => task.id === taskId);
}

function sessionById(lookups: RunPresentationLookups, conversationId: string | undefined): SessionMeta | undefined {
  if (!conversationId || !lookups.sessions) {
    return undefined;
  }

  return lookups.sessions.find((session) => session.id === conversationId);
}

function conversationLabel(run: DurableRunRecord, lookups: RunPresentationLookups): { title?: string; conversationId?: string } {
  const sourceType = run.manifest?.source?.type;
  const isConversationRun = run.manifest?.kind === 'conversation'
    || sourceType === 'web-live-session'
    || sourceType === 'deferred-resume'
    || sourceType === REMOTE_EXECUTION_RUN_SOURCE_TYPE
    || isConversationNodeDistillRunSourceType(sourceType);

  if (isConversationRun) {
    const conversationId = sourceType === 'web-live-session'
      || sourceType === REMOTE_EXECUTION_RUN_SOURCE_TYPE
      || isConversationNodeDistillRunSourceType(sourceType)
      ? run.manifest?.source?.id ?? readSpec(run, 'conversationId') ?? readCheckpoint(run, 'conversationId')
      : readCheckpoint(run, 'conversationId') ?? readSpec(run, 'conversationId');
    const title = readCheckpoint(run, 'title') ?? sessionById(lookups, conversationId)?.title;

    return {
      title,
      conversationId,
    };
  }

  if (run.manifest?.kind === 'background-run' && sourceType === 'tool') {
    const conversationId = run.manifest.source?.id;
    const session = sessionById(lookups, conversationId);
    if (session) {
      return {
        title: session.title,
        conversationId: session.id,
      };
    }
  }

  return {};
}

export function getRunLocation(run: DurableRunRecord): 'local' | 'remote' {
  return run.location === 'remote' || Boolean(run.remoteExecution) || run.manifest?.source?.type === REMOTE_EXECUTION_RUN_SOURCE_TYPE
    ? 'remote'
    : 'local';
}

export function getRunImportState(run: DurableRunRecord): RemoteExecutionRunSummary['importStatus'] | null {
  return run.remoteExecution?.importStatus ?? null;
}

export function getRunCategory(run: DurableRunRecord): RunCategory {
  if (run.manifest?.source?.type === 'scheduled-task' || run.manifest?.kind === 'scheduled-task') {
    return 'scheduled';
  }

  if (run.manifest?.source?.type === 'deferred-resume') {
    return 'deferred';
  }

  if (run.manifest?.source?.type === 'web-live-session' || run.manifest?.kind === 'conversation') {
    return 'conversation';
  }

  if (
    run.manifest?.kind === 'background-run'
    || run.manifest?.source?.type === 'background-run'
    || run.manifest?.source?.type === REMOTE_EXECUTION_RUN_SOURCE_TYPE
    || run.manifest?.kind === 'raw-shell'
    || run.manifest?.kind === 'workflow'
  ) {
    return 'background';
  }

  return 'other';
}

function sourceKindLabel(run: DurableRunRecord): string {
  if (run.manifest?.source?.type === 'scheduled-task' || run.manifest?.kind === 'scheduled-task') {
    return 'Scheduled task';
  }

  if (run.manifest?.source?.type === 'web-live-session') {
    return 'Live conversation';
  }

  if (run.manifest?.source?.type === REMOTE_EXECUTION_RUN_SOURCE_TYPE || run.remoteExecution) {
    return 'Remote execution';
  }

  if (run.manifest?.source?.type === 'deferred-resume') {
    return 'Wakeup';
  }

  if (run.manifest?.kind === 'background-run' || run.manifest?.source?.type === 'background-run') {
    return 'Background run';
  }

  if (run.manifest?.kind === 'raw-shell') {
    return 'Shell run';
  }

  if (run.manifest?.kind === 'workflow') {
    return 'Workflow';
  }

  if (run.manifest?.kind === 'conversation') {
    return 'Conversation run';
  }

  return run.manifest?.kind ?? 'Run';
}

export function getRunHeadline(run: DurableRunRecord, lookups: RunPresentationLookups = {}): RunHeadline {
  if (run.manifest?.source?.type === 'scheduled-task' || run.manifest?.kind === 'scheduled-task') {
    const taskId = run.manifest?.source?.id ?? readSpec(run, 'taskId');
    const task = taskById(lookups, taskId);
    const title = excerpt(task?.prompt) ?? taskId ?? run.runId;
    const summary = taskId ? `Scheduled task · ${taskId}` : 'Scheduled task';
    return { title, summary };
  }

  if (run.manifest?.source?.type === 'web-live-session') {
    const { title, conversationId } = conversationLabel(run, lookups);
    const headline = title ?? conversationId ?? run.runId;
    const summary = conversationId && headline !== conversationId
      ? `Live conversation · ${conversationId}`
      : 'Live conversation';
    return { title: headline, summary };
  }

  if (run.manifest?.source?.type === 'deferred-resume') {
    const deferredResumeId = run.manifest.source.id;
    const prompt = excerpt(readCheckpoint(run, 'prompt') ?? readSpec(run, 'prompt'));
    const { title, conversationId } = conversationLabel(run, lookups);
    const target = title ?? conversationId;
    const headline = prompt ?? target ?? deferredResumeId ?? run.runId;
    const suffix = conversationId ?? deferredResumeId;
    const summary = suffix && headline !== suffix
      ? `Wakeup · ${suffix}`
      : 'Wakeup';
    return { title: headline, summary };
  }

  if (run.manifest?.source?.type === REMOTE_EXECUTION_RUN_SOURCE_TYPE || run.remoteExecution) {
    const prompt = excerpt(run.remoteExecution?.prompt) ?? excerpt(readCheckpoint(run, 'prompt') ?? readSpec(run, 'prompt'));
    const { title, conversationId } = conversationLabel(run, lookups);
    const targetLabel = run.remoteExecution?.targetLabel;
    const headline = prompt ?? title ?? conversationId ?? run.runId;
    const summary = targetLabel
      ? `Remote execution · ${targetLabel}`
      : 'Remote execution';
    return { title: headline, summary };
  }

  if (isConversationNodeDistillRunSourceType(run.manifest?.source?.type)) {
    const { title, conversationId } = conversationLabel(run, lookups);
    const requestedTitle = excerpt(readCheckpoint(run, 'title') ?? readSpec(run, 'title'));
    const sourceLabel = title ?? conversationId;
    const headline = requestedTitle ?? (sourceLabel ? `Distill page: ${sourceLabel}` : 'Distill durable page');
    return {
      title: headline,
      summary: 'Conversation page distillation',
    };
  }

  if (run.manifest?.kind === 'background-run' || run.manifest?.source?.type === 'background-run') {
    const agentPrompt = excerpt(readNestedSpec(run, 'agent', 'prompt') ?? readNestedCheckpoint(run, 'agent', 'prompt'));
    const shellCommand = excerptShellCommand(readSpec(run, 'shellCommand') ?? readCheckpoint(run, 'shellCommand'));
    const taskSlug = readSpec(run, 'taskSlug') ?? readCheckpoint(run, 'taskSlug') ?? run.manifest?.source?.id;
    const headline = agentPrompt ?? shellCommand ?? taskSlug ?? run.runId;
    const summary = taskSlug && headline !== taskSlug
      ? `Background run · ${taskSlug}`
      : 'Background run';
    return { title: headline, summary };
  }

  if (run.manifest?.kind === 'raw-shell') {
    const shellCommand = excerptShellCommand(readSpec(run, 'shellCommand') ?? readCheckpoint(run, 'shellCommand'));
    return {
      title: shellCommand ?? run.runId,
      summary: shellCommand ? 'Shell run' : sourceKindLabel(run),
    };
  }

  return {
    title: run.manifest?.source?.id ?? run.runId,
    summary: sourceKindLabel(run),
  };
}

export function getRunConnections(run: DurableRunRecord, lookups: RunPresentationLookups = {}): RunConnection[] {
  const connections: RunConnection[] = [];

  if (run.manifest?.source?.type === 'scheduled-task' || run.manifest?.kind === 'scheduled-task') {
    const taskId = run.manifest?.source?.id ?? readSpec(run, 'taskId');
    const task = taskById(lookups, taskId);
    if (taskId) {
      connections.push({
        key: `task:${taskId}`,
        label: 'Scheduled task',
        value: taskId,
        to: `/scheduled/${encodeURIComponent(taskId)}`,
        detail: excerpt(task?.prompt) ?? task?.filePath ?? run.manifest?.source?.filePath,
      });
    }
  }

  const { title, conversationId } = conversationLabel(run, lookups);
  if (conversationId) {
    connections.push({
      key: `conversation:${conversationId}`,
      label: run.manifest?.source?.type === 'deferred-resume' ? 'Conversation to reopen' : 'Conversation',
      value: title ?? conversationId,
      to: `/conversations/${encodeURIComponent(conversationId)}`,
      detail: title && title !== conversationId ? conversationId : undefined,
    });
  }

  if (run.manifest?.source?.type === 'deferred-resume' && run.manifest.source.id) {
    const prompt = excerpt(readCheckpoint(run, 'prompt') ?? readSpec(run, 'prompt'));
    connections.push({
      key: `deferred-resume:${run.manifest.source.id}`,
      label: 'Wakeup',
      value: run.manifest.source.id,
      detail: prompt,
    });
  }

  if (run.manifest?.source?.type === REMOTE_EXECUTION_RUN_SOURCE_TYPE || run.remoteExecution) {
    const targetLabel = run.remoteExecution?.targetLabel ?? readCheckpoint(run, 'targetLabel');
    const remoteCwd = run.remoteExecution?.remoteCwd ?? readCheckpoint(run, 'remoteCwd');
    const prompt = excerpt(run.remoteExecution?.prompt ?? readCheckpoint(run, 'prompt') ?? readSpec(run, 'prompt'));

    if (targetLabel) {
      connections.push({
        key: `target:${run.remoteExecution?.targetId ?? targetLabel}`,
        label: 'Execution target',
        value: targetLabel,
        detail: [remoteCwd, prompt].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ') || undefined,
      });
    }
  }

  const filePath = run.manifest?.source?.filePath;
  if (filePath) {
    connections.push({
      key: `file:${filePath}`,
      label: 'Source file',
      value: filePath,
    });
  }

  return connections;
}

export function getRunPrimaryConnection(
  run: DurableRunRecord,
  lookups: RunPresentationLookups = {},
): RunConnection | undefined {
  return getRunConnections(run, lookups).find((connection) => connection.label !== 'Source file' && connection.to);
}

export function getRunPrimaryActionLabel(connection: RunConnection | undefined): string | undefined {
  if (!connection?.to) {
    return undefined;
  }

  if (connection.label === 'Scheduled task') {
    return 'Open task';
  }

  if (connection.label === 'Conversation' || connection.label === 'Conversation to reopen') {
    return 'Open conversation';
  }

  return 'Open';
}

export function getRunMoment(run: DurableRunRecord): RunMoment {
  if (run.status?.completedAt) {
    return { label: 'completed', at: run.status.completedAt };
  }

  if (run.status?.startedAt && run.status.status === 'running') {
    return { label: 'started', at: run.status.startedAt };
  }

  if (run.status?.updatedAt) {
    return { label: 'updated', at: run.status.updatedAt };
  }

  return { label: 'created', at: run.manifest?.createdAt };
}

export function getRunSortTimestamp(run: DurableRunRecord): string {
  return getRunMoment(run).at ?? run.manifest?.createdAt ?? '';
}

export function getRunTimeline(run: DurableRunRecord): Array<{ label: string; at: string }> {
  const timeline = [
    { label: 'Created', at: run.manifest?.createdAt },
    { label: 'Submitted remotely', at: run.remoteExecution?.submittedAt },
    { label: 'Started', at: run.status?.startedAt },
    { label: 'Updated', at: run.status?.updatedAt },
    { label: 'Completed', at: run.status?.completedAt },
    { label: 'Imported', at: run.remoteExecution?.importedAt },
  ];

  return timeline.filter((item): item is { label: string; at: string } => typeof item.at === 'string' && item.at.length > 0);
}

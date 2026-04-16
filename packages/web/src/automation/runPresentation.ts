import type { DurableRunListResult, DurableRunRecord, ScheduledTaskSummary, SessionMeta } from '../shared/types';

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

type RunCategory = 'scheduled' | 'conversation' | 'deferred' | 'background' | 'other';

export function isRunInProgress(run: DurableRunRecord): boolean {
  const status = run.status?.status;
  return status === 'running' || status === 'recovering';
}

export function isRunActive(run: DurableRunRecord | null | undefined): boolean {
  const status = run?.status?.status;
  return status === 'queued' || status === 'waiting' || status === 'running' || status === 'recovering';
}

export function runNeedsAttention(run: DurableRunRecord, options?: { includeDismissed?: boolean }): boolean {
  const status = run.status?.status;
  const needsAttention = run.problems.length > 0
    || run.recoveryAction === 'resume'
    || run.recoveryAction === 'rerun'
    || run.recoveryAction === 'attention'
    || run.recoveryAction === 'invalid'
    || status === 'failed'
    || status === 'interrupted'
    || status === 'recovering';

  return options?.includeDismissed ? needsAttention : needsAttention && !run.attentionDismissed;
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

function readTargetSpec(run: DurableRunRecord, key: string): string | undefined {
  return readNestedSpec(run, 'target', key);
}

function readTargetCheckpoint(run: DurableRunRecord, key: string): string | undefined {
  return readNestedCheckpoint(run, 'target', key);
}

function readMetadataSpec(run: DurableRunRecord, key: string): string | undefined {
  return readNestedSpec(run, 'metadata', key);
}

function readMetadataCheckpoint(run: DurableRunRecord, key: string): string | undefined {
  return readNestedCheckpoint(run, 'metadata', key);
}

export function getRunTaskSlug(run: DurableRunRecord): string | undefined {
  return readMetadataSpec(run, 'taskSlug')
    ?? readMetadataCheckpoint(run, 'taskSlug')
    ?? readSpec(run, 'taskSlug')
    ?? readCheckpoint(run, 'taskSlug');
}

export function getRunTargetPrompt(run: DurableRunRecord): string | undefined {
  return readTargetSpec(run, 'prompt')
    ?? readTargetCheckpoint(run, 'prompt')
    ?? readNestedSpec(run, 'agent', 'prompt')
    ?? readNestedCheckpoint(run, 'agent', 'prompt')
    ?? readSpec(run, 'prompt')
    ?? readCheckpoint(run, 'prompt');
}

export function getRunTargetCommand(run: DurableRunRecord): string | undefined {
  return readTargetSpec(run, 'command')
    ?? readTargetCheckpoint(run, 'command')
    ?? readSpec(run, 'shellCommand')
    ?? readCheckpoint(run, 'shellCommand');
}

export function getRunWorkingDirectory(run: DurableRunRecord): string | undefined {
  return readTargetSpec(run, 'cwd')
    ?? readTargetCheckpoint(run, 'cwd')
    ?? readMetadataSpec(run, 'cwd')
    ?? readMetadataCheckpoint(run, 'cwd')
    ?? readSpec(run, 'cwd')
    ?? readCheckpoint(run, 'cwd');
}

export function getRunTargetModel(run: DurableRunRecord): string | undefined {
  return readTargetSpec(run, 'model')
    ?? readTargetCheckpoint(run, 'model')
    ?? readNestedSpec(run, 'agent', 'model')
    ?? readNestedCheckpoint(run, 'agent', 'model')
    ?? readSpec(run, 'model')
    ?? readCheckpoint(run, 'model');
}

export function getRunTargetProfile(run: DurableRunRecord): string | undefined {
  return readTargetSpec(run, 'profile')
    ?? readTargetCheckpoint(run, 'profile')
    ?? readNestedSpec(run, 'agent', 'profile')
    ?? readNestedCheckpoint(run, 'agent', 'profile')
    ?? readSpec(run, 'profile')
    ?? readCheckpoint(run, 'profile');
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

export function getRunTaskId(run: DurableRunRecord): string | undefined {
  return run.manifest?.source?.type === 'scheduled-task'
    ? run.manifest.source.id ?? readMetadataSpec(run, 'taskId') ?? readSpec(run, 'taskId')
    : run.manifest?.kind === 'scheduled-task'
      ? run.manifest?.source?.id ?? readMetadataSpec(run, 'taskId') ?? readSpec(run, 'taskId')
      : undefined;
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

function runTranscriptSession(run: DurableRunRecord, lookups: RunPresentationLookups): SessionMeta | undefined {
  if (!lookups.sessions) {
    return undefined;
  }

  const matches = lookups.sessions
    .filter((session) => session.sourceRunId === run.runId)
    .sort((left, right) => {
      const leftRoot = left.parentSessionId?.trim() ? 1 : 0;
      const rightRoot = right.parentSessionId?.trim() ? 1 : 0;
      if (leftRoot !== rightRoot) {
        return leftRoot - rightRoot;
      }

      const leftTimestamp = left.lastActivityAt ?? left.timestamp;
      const rightTimestamp = right.lastActivityAt ?? right.timestamp;
      return rightTimestamp.localeCompare(leftTimestamp) || left.id.localeCompare(right.id);
    });

  return matches[0];
}

function conversationLabel(run: DurableRunRecord, lookups: RunPresentationLookups): { title?: string; conversationId?: string } {
  const sourceType = run.manifest?.source?.type;
  const isConversationRun = run.manifest?.kind === 'conversation'
    || sourceType === 'web-live-session'
    || sourceType === 'deferred-resume';

  if (isConversationRun) {
    const conversationId = sourceType === 'web-live-session'
      ? run.manifest?.source?.id ?? readTargetSpec(run, 'conversationId') ?? readSpec(run, 'conversationId') ?? readTargetCheckpoint(run, 'conversationId') ?? readCheckpoint(run, 'conversationId')
      : readTargetCheckpoint(run, 'conversationId') ?? readCheckpoint(run, 'conversationId') ?? readTargetSpec(run, 'conversationId') ?? readSpec(run, 'conversationId');
    const title = readCheckpoint(run, 'title') ?? readMetadataCheckpoint(run, 'title') ?? sessionById(lookups, conversationId)?.title;

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

function getRunCategory(run: DurableRunRecord): RunCategory {
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
    const taskId = getRunTaskId(run);
    const task = taskById(lookups, taskId);
    const title = task?.title ?? excerpt(task?.prompt) ?? taskId ?? run.runId;
    const summary = task?.title && taskId && task.title !== taskId
      ? `Scheduled task · ${task.title}`
      : taskId ? `Scheduled task · ${taskId}` : 'Scheduled task';
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
    const prompt = excerpt(getRunTargetPrompt(run));
    const { title, conversationId } = conversationLabel(run, lookups);
    const target = title ?? conversationId;
    const headline = prompt ?? target ?? deferredResumeId ?? run.runId;
    const suffix = conversationId ?? deferredResumeId;
    const summary = suffix && headline !== suffix
      ? `Wakeup · ${suffix}`
      : 'Wakeup';
    return { title: headline, summary };
  }

  if (run.manifest?.kind === 'background-run' || run.manifest?.source?.type === 'background-run') {
    const agentPrompt = excerpt(getRunTargetPrompt(run));
    const shellCommand = excerptShellCommand(getRunTargetCommand(run));
    const taskSlug = getRunTaskSlug(run);
    const headline = agentPrompt ?? shellCommand ?? taskSlug ?? run.runId;
    const summary = taskSlug && headline !== taskSlug
      ? `Background run · ${taskSlug}`
      : shellCommand && headline !== shellCommand
        ? `Background run · ${shellCommand}`
        : 'Background run';
    return { title: headline, summary };
  }

  if (run.manifest?.kind === 'raw-shell') {
    const shellCommand = excerptShellCommand(getRunTargetCommand(run));
    const taskSlug = getRunTaskSlug(run);
    const title = taskSlug ?? shellCommand ?? run.runId;
    const detail = title === taskSlug ? shellCommand : taskSlug;
    return {
      title,
      summary: detail ? `Shell run · ${detail}` : shellCommand ? 'Shell run' : sourceKindLabel(run),
    };
  }

  return {
    title: run.manifest?.source?.id ?? run.runId,
    summary: sourceKindLabel(run),
  };
}

export function getRunConnections(run: DurableRunRecord, lookups: RunPresentationLookups = {}): RunConnection[] {
  const connections: RunConnection[] = [];

  const transcriptSession = runTranscriptSession(run, lookups);
  if (transcriptSession) {
    connections.push({
      key: `transcript:${transcriptSession.id}`,
      label: 'Conversation transcript',
      value: transcriptSession.title,
      to: `/conversations/${encodeURIComponent(transcriptSession.id)}`,
      detail: transcriptSession.title !== transcriptSession.id ? transcriptSession.id : undefined,
    });
  }

  if (run.manifest?.source?.type === 'scheduled-task' || run.manifest?.kind === 'scheduled-task') {
    const taskId = getRunTaskId(run);
    const task = taskById(lookups, taskId);
    if (taskId) {
      connections.push({
        key: `task:${taskId}`,
        label: 'Scheduled task',
        value: task?.title ?? taskId,
        to: `/automations/${encodeURIComponent(taskId)}`,
        detail: task?.title && task.title !== taskId
          ? taskId
          : excerpt(task?.prompt) ?? task?.filePath ?? run.manifest?.source?.filePath,
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
    const prompt = excerpt(getRunTargetPrompt(run));
    connections.push({
      key: `deferred-resume:${run.manifest.source.id}`,
      label: 'Wakeup',
      value: run.manifest.source.id,
      detail: prompt,
    });
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

export function listConnectedConversationBackgroundRuns(input: {
  conversationId: string;
  runs?: DurableRunListResult | null;
  lookups?: RunPresentationLookups;
  excludeConversationRunId?: string | null;
}): DurableRunRecord[] {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    return [];
  }

  const excludedRunId = input.excludeConversationRunId?.trim() || null;
  const lookups = input.lookups ?? {};

  return [...(input.runs?.runs ?? [])]
    .filter((run) => run.runId !== excludedRunId)
    .filter((run) => getRunCategory(run) === 'background')
    .filter((run) => {
      if (run.manifest?.source?.type === 'tool' && run.manifest.source.id === conversationId) {
        return true;
      }

      return getRunConnections(run, lookups).some((connection) => connection.key === `conversation:${conversationId}`);
    })
    .sort((left, right) => {
      const leftActive = isRunActive(left) ? 1 : 0;
      const rightActive = isRunActive(right) ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }

      return getRunSortTimestamp(right).localeCompare(getRunSortTimestamp(left));
    });
}

export function getRunPrimaryConnection(
  run: DurableRunRecord,
  lookups: RunPresentationLookups = {},
): RunConnection | undefined {
  return getRunConnections(run, lookups).find((connection) => connection.label !== 'Source file' && connection.to);
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

function getRunSortTimestamp(run: DurableRunRecord): string {
  return getRunMoment(run).at ?? run.manifest?.createdAt ?? '';
}

export function getRunTimeline(run: DurableRunRecord): Array<{ label: string; at: string }> {
  const timeline = [
    { label: 'Created', at: run.manifest?.createdAt },
    { label: 'Started', at: run.status?.startedAt },
    { label: 'Updated', at: run.status?.updatedAt },
    { label: 'Completed', at: run.status?.completedAt },
  ];

  return timeline.filter((item): item is { label: string; at: string } => typeof item.at === 'string' && item.at.length > 0);
}

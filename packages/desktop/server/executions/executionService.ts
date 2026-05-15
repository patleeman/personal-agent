import type { ScannedDurableRun } from '@personal-agent/daemon';

import { cancelDurableRun, getDurableRun, getDurableRunLog, listDurableRuns } from '../automation/durableRuns.js';

export type ExecutionKind = 'background-command' | 'subagent' | 'scheduled-task' | 'deferred-resume' | 'conversation' | 'unknown';
export type ExecutionVisibility = 'primary' | 'system' | 'hidden';

export interface ExecutionCapabilities {
  canCancel: boolean;
  canRerun: boolean;
  canFollowUp: boolean;
  hasLog: boolean;
  hasResult: boolean;
}

export interface ExecutionRecord {
  id: string;
  kind: ExecutionKind;
  visibility: ExecutionVisibility;
  conversationId?: string;
  sessionFile?: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
  title: string;
  subtitle?: string;
  status: string;
  cwd?: string;
  command?: string;
  prompt?: string;
  model?: string;
  taskId?: string;
  createdAt?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  attention?: {
    required: boolean;
    reason?: string;
    dismissed?: boolean;
  };
  capabilities: ExecutionCapabilities;
}

export interface ConversationExecutionsResult {
  conversationId: string;
  primary: ExecutionRecord[];
  system: ExecutionRecord[];
  hidden: ExecutionRecord[];
  executions: ExecutionRecord[];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function terminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

function inferExecutionKind(run: ScannedDurableRun): ExecutionKind {
  const manifest = run.manifest;
  const spec = readRecord(manifest?.spec);
  const sourceType = manifest?.source?.type;
  if (manifest?.kind === 'raw-shell' || readString(spec?.shellCommand)) return 'background-command';
  if (manifest?.kind === 'background-run') return 'subagent';
  if (manifest?.kind === 'scheduled-task' || sourceType === 'scheduled-task') return 'scheduled-task';
  if (sourceType === 'deferred-resume') return 'deferred-resume';
  if (manifest?.kind === 'conversation') return 'conversation';
  return 'unknown';
}

function inferVisibility(kind: ExecutionKind): ExecutionVisibility {
  if (kind === 'background-command' || kind === 'subagent') return 'primary';
  if (kind === 'scheduled-task' || kind === 'deferred-resume' || kind === 'conversation') return 'system';
  return 'hidden';
}

function inferConversationId(run: ScannedDurableRun): string | undefined {
  const source = run.manifest?.source;
  const spec = readRecord(run.manifest?.spec);
  const metadata = readRecord(spec?.metadata) ?? readRecord(spec?.manifestMetadata);
  const metadataConversationId = readString(metadata?.conversationId);
  if (metadataConversationId) return metadataConversationId;
  if (source?.type === 'tool') return readString(source.id);
  const sourceId = readString(source?.id);
  if (sourceId?.startsWith('conversation-live-')) return sourceId.replace(/^conversation-live-/, '');
  return undefined;
}

function inferSessionFile(run: ScannedDurableRun): string | undefined {
  const source = run.manifest?.source;
  const spec = readRecord(run.manifest?.spec);
  const callback = readRecord(spec?.callbackConversation);
  return readString(source?.filePath) ?? readString(callback?.sessionFile);
}

function inferTitle(run: ScannedDurableRun, kind: ExecutionKind): string {
  const spec = readRecord(run.manifest?.spec);
  const metadata = readRecord(spec?.metadata) ?? readRecord(spec?.manifestMetadata);
  const title = readString(metadata?.title) ?? readString(metadata?.taskSlug) ?? readString(spec?.taskSlug);
  if (title) return title;
  const command = readString(spec?.shellCommand);
  if (command) return command;
  const prompt = readString(spec?.prompt) ?? readString(readRecord(spec?.agent)?.prompt);
  if (prompt) return prompt.split(/\s+/).slice(0, 8).join(' ');
  if (kind === 'scheduled-task') return 'Scheduled task execution';
  if (kind === 'deferred-resume') return 'Deferred resume';
  if (kind === 'conversation') return 'Conversation execution';
  return run.runId;
}

export function projectExecution(run: ScannedDurableRun): ExecutionRecord {
  const spec = readRecord(run.manifest?.spec);
  const agent = readRecord(spec?.agent);
  const kind = inferExecutionKind(run);
  const status = run.status?.status ?? 'unknown';
  const command = readString(spec?.shellCommand);
  const prompt = readString(spec?.prompt) ?? readString(agent?.prompt);
  const model = readString(spec?.model) ?? readString(agent?.model);
  const taskId = readString(spec?.taskId) ?? readString(spec?.taskSlug) ?? readString(run.manifest?.source?.id);
  const hasResult = Boolean(run.result && Object.keys(run.result).length > 0);
  const hasLog = Boolean(run.paths.outputLogPath);
  return {
    id: run.runId,
    kind,
    visibility: inferVisibility(kind),
    ...(inferConversationId(run) ? { conversationId: inferConversationId(run) } : {}),
    ...(inferSessionFile(run) ? { sessionFile: inferSessionFile(run) } : {}),
    title: inferTitle(run, kind),
    ...(command && kind !== 'background-command' ? { subtitle: command } : {}),
    status,
    ...(readString(spec?.cwd) ? { cwd: readString(spec?.cwd) } : {}),
    ...(command ? { command } : {}),
    ...(prompt ? { prompt } : {}),
    ...(model ? { model } : {}),
    ...(taskId ? { taskId } : {}),
    ...(run.manifest?.createdAt ? { createdAt: run.manifest.createdAt } : {}),
    ...(run.status?.startedAt ? { startedAt: run.status.startedAt } : {}),
    ...(run.status?.updatedAt ? { updatedAt: run.status.updatedAt } : {}),
    ...(run.status?.completedAt ? { completedAt: run.status.completedAt } : {}),
    attention: {
      required: run.recoveryAction === 'attention' || status === 'interrupted',
      ...(run.recoveryAction ? { reason: run.recoveryAction } : {}),
    },
    capabilities: {
      canCancel: !terminalStatus(status) && (run.manifest?.kind === 'background-run' || run.manifest?.kind === 'raw-shell'),
      canRerun: terminalStatus(status) && (run.manifest?.kind === 'background-run' || run.manifest?.kind === 'raw-shell'),
      canFollowUp: kind === 'subagent' && terminalStatus(status),
      hasLog,
      hasResult,
    },
  };
}

function sortExecutions(left: ExecutionRecord, right: ExecutionRecord): number {
  const leftActive = terminalStatus(left.status) ? 0 : 1;
  const rightActive = terminalStatus(right.status) ? 0 : 1;
  if (leftActive !== rightActive) return rightActive - leftActive;
  return (right.updatedAt ?? right.startedAt ?? right.createdAt ?? '').localeCompare(
    left.updatedAt ?? left.startedAt ?? left.createdAt ?? '',
  );
}

export async function listExecutions(): Promise<{ executions: ExecutionRecord[] }> {
  const result = await listDurableRuns();
  return { executions: result.runs.map(projectExecution).sort(sortExecutions) };
}

export async function listConversationExecutions(conversationId: string): Promise<ConversationExecutionsResult> {
  const normalized = conversationId.trim();
  const executions = (await listExecutions()).executions.filter((execution) => execution.conversationId === normalized);
  return {
    conversationId: normalized,
    primary: executions.filter((execution) => execution.visibility === 'primary'),
    system: executions.filter((execution) => execution.visibility === 'system'),
    hidden: executions.filter((execution) => execution.visibility === 'hidden'),
    executions,
  };
}

export async function getExecution(id: string): Promise<{ execution: ExecutionRecord } | undefined> {
  const result = await getDurableRun(id);
  return result ? { execution: projectExecution(result.run) } : undefined;
}

export { cancelDurableRun as cancelExecution, getDurableRunLog as getExecutionLog };

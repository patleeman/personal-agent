import type { DurableRunRecord, SessionMeta } from '../shared/types';

export type ActivityTreeItemKind = 'conversation' | 'run' | 'terminal' | 'artifact' | 'checkpoint' | 'group';
export type ActivityTreeItemStatus = 'idle' | 'running' | 'queued' | 'failed' | 'done';

export interface ActivityTreeItem {
  id: string;
  kind: ActivityTreeItemKind;
  parentId?: string;
  title: string;
  subtitle?: string;
  status: ActivityTreeItemStatus;
  route?: string;
  accentColor?: string;
  backgroundColor?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface BuildActivityTreeInput {
  conversations: readonly SessionMeta[];
  runs?: readonly DurableRunRecord[];
}

export function buildConversationActivityId(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function buildRunActivityId(runId: string): string {
  return `run:${runId}`;
}

export function buildActivityTreeItems({ conversations, runs = [] }: BuildActivityTreeInput): ActivityTreeItem[] {
  const conversationIds = new Set(conversations.map((session) => session.id));
  const items: ActivityTreeItem[] = conversations.map((session) => ({
    id: buildConversationActivityId(session.id),
    kind: 'conversation',
    title: session.title || 'Untitled thread',
    subtitle: session.cwd || undefined,
    status: session.isRunning ? 'running' : 'idle',
    route: `/conversations/${encodeURIComponent(session.id)}`,
    updatedAt: session.updatedAt ?? session.createdAt,
    metadata: { conversationId: session.id, cwd: session.cwd },
  }));

  for (const run of runs) {
    const parentConversationId = getRunConversationId(run);
    items.push({
      id: buildRunActivityId(run.runId),
      kind: 'run',
      parentId:
        parentConversationId && conversationIds.has(parentConversationId) ? buildConversationActivityId(parentConversationId) : undefined,
      title: getRunTitle(run),
      subtitle: run.status?.lastError || run.manifest?.kind || undefined,
      status: normalizeRunStatus(run.status?.status),
      route: `/runs/${encodeURIComponent(run.runId)}`,
      updatedAt: run.status?.updatedAt ?? run.manifest?.createdAt,
      metadata: { runId: run.runId, conversationId: parentConversationId },
    });
  }

  return items.sort(compareActivityTreeItems);
}

function compareActivityTreeItems(left: ActivityTreeItem, right: ActivityTreeItem): number {
  if (left.parentId && left.parentId === right.id) return 1;
  if (right.parentId && right.parentId === left.id) return -1;
  if (left.parentId !== right.parentId) {
    if (!left.parentId && right.parentId) return -1;
    if (left.parentId && !right.parentId) return 1;
    return String(left.parentId).localeCompare(String(right.parentId));
  }
  return getTimestamp(right.updatedAt) - getTimestamp(left.updatedAt) || left.title.localeCompare(right.title);
}

function getTimestamp(value: string | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeRunStatus(status: string | undefined): ActivityTreeItemStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'queued':
    case 'pending':
      return 'queued';
    case 'failed':
    case 'error':
      return 'failed';
    case 'completed':
    case 'succeeded':
    case 'success':
      return 'done';
    default:
      return 'idle';
  }
}

function getRunTitle(run: DurableRunRecord): string {
  const spec = run.manifest?.spec;
  const title = getStringField(spec, 'title') ?? getStringField(spec, 'taskSlug') ?? getStringField(spec, 'command');
  return title?.trim() || run.runId;
}

function getRunConversationId(run: DurableRunRecord): string | undefined {
  const spec = run.manifest?.spec;
  return (
    getStringField(spec, 'conversationId') ??
    getStringField(spec, 'threadConversationId') ??
    getSourceConversationId(run.manifest?.source) ??
    getStringField(run.result, 'conversationId') ??
    getStringField(run.checkpoint?.payload, 'conversationId')
  );
}

function getSourceConversationId(source: { type: string; id?: string } | undefined): string | undefined {
  if (!source?.id) return undefined;
  return source.type === 'conversation' || source.type === 'thread' ? source.id : undefined;
}

function getStringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

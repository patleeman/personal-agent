import { extractDurableRunIdsFromBlock } from '../../conversation/conversationRuns';
import type { MessageBlock } from '../../shared/types';
import { buildSummaryPreview } from './summaryPreview.js';

type LinkedRunDescriptor = {
  title: string;
  detail: string | null;
  kindLabel: string;
};

type ListedRunDetails = {
  runId: string;
  status: string | null;
  kind: string | null;
  source: string | null;
};

export type LinkedRunPresentation = {
  runId: string;
  title: string;
  detail: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function summarizeLinkedRunTail(value: string): string | null {
  let segments = value
    .split(/[-_]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const timestampIndex = segments.findIndex((segment) => /^\d{4}$/.test(segment) || /^\d{4}T\d+/i.test(segment));
  if (timestampIndex >= 0) {
    segments = segments.slice(0, timestampIndex);
  }

  while (segments.length > 0) {
    const last = segments[segments.length - 1] ?? '';
    if (/^[a-f0-9]{6,}$/i.test(last) || /^\d+$/.test(last)) {
      segments = segments.slice(0, -1);
      continue;
    }
    break;
  }

  const summary = segments.join(' ').trim();
  if (!summary) {
    return null;
  }

  const compact = summary.replace(/\s+/g, '');
  if (/^[a-f0-9]+$/i.test(compact) && compact.length >= 8) {
    return null;
  }

  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function describeLinkedRun(runId: string): LinkedRunDescriptor {
  if (runId.startsWith('conversation-live-')) {
    return {
      title: 'Live Conversation',
      detail: summarizeLinkedRunTail(runId.slice('conversation-live-'.length)),
      kindLabel: 'live conversation',
    };
  }

  if (runId.startsWith('conversation-deferred-resume-')) {
    return {
      title: 'Wakeup',
      detail: summarizeLinkedRunTail(runId.slice('conversation-deferred-resume-'.length)),
      kindLabel: 'wakeup',
    };
  }

  if (runId.startsWith('task-')) {
    return {
      title: 'Scheduled Task',
      detail: summarizeLinkedRunTail(runId.slice('task-'.length)),
      kindLabel: 'scheduled task',
    };
  }

  if (runId.startsWith('run-')) {
    return {
      title: 'Background Run',
      detail: summarizeLinkedRunTail(runId.slice('run-'.length)),
      kindLabel: 'background run',
    };
  }

  return {
    title: 'Linked Run',
    detail: summarizeLinkedRunTail(runId),
    kindLabel: 'linked run',
  };
}

export function normalizeRunLabel(value: string): string {
  return value.replace(/[-_\s]+/g, ' ').trim().toLowerCase();
}

function readRunField(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function excerptLinkedRunText(value: string | null | undefined, maxLength = 72): string | null {
  if (!value) {
    return null;
  }

  const preview = buildSummaryPreview(value, 1).replace(/\s+/g, ' ').trim();
  if (!preview) {
    return null;
  }

  return preview.length <= maxLength
    ? preview
    : `${preview.slice(0, maxLength - 1).trimEnd()}…`;
}

function summarizeWorkspaceTail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[\\/]+$/g, '').trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? normalized;
}

function pushRunDetail(target: string[], value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }

  const normalized = normalizeRunLabel(trimmed);
  if (target.some((item) => normalizeRunLabel(item) === normalized)) {
    return;
  }

  target.push(trimmed);
}

function buildRunToolPreview(block: Extract<MessageBlock, { type: 'tool_use' }>): string {
  const details = isRecord(block.details) ? block.details : null;
  const input = isRecord(block.input) ? block.input : null;
  const action = readRunField(details, 'action') ?? readRunField(input, 'action');

  if (!action) {
    return '';
  }

  const runId = readRunField(details, 'runId') ?? readRunField(input, 'runId');
  const sourceRunId = readRunField(details, 'sourceRunId');
  const taskSlug = readRunField(details, 'taskSlug') ?? readRunField(input, 'taskSlug');
  const prompt = excerptLinkedRunText(readRunField(details, 'prompt') ?? readRunField(input, 'prompt'));
  const command = excerptLinkedRunText(readRunField(details, 'command') ?? readRunField(input, 'command'));
  const runLabel = summarizeLinkedRunTail((runId ?? sourceRunId ?? '').replace(/^(?:run|task)-/, ''));

  switch (action) {
    case 'list':
      return 'list durable runs';
    case 'get':
      return `get ${runLabel ?? runId ?? 'run'}`;
    case 'logs':
      return `logs ${runLabel ?? runId ?? 'run'}`;
    case 'cancel':
      return `cancel ${runLabel ?? runId ?? 'run'}`;
    case 'rerun':
      return `rerun ${summarizeLinkedRunTail((sourceRunId ?? '').replace(/^(?:run|task)-/, '')) ?? sourceRunId ?? runLabel ?? 'run'}`;
    case 'follow_up':
      return `follow_up ${prompt ?? summarizeLinkedRunTail((sourceRunId ?? '').replace(/^(?:run|task)-/, '')) ?? sourceRunId ?? runLabel ?? 'run'}`;
    case 'start_agent':
      return `start_agent ${prompt ?? taskSlug ?? runLabel ?? 'agent run'}`;
    case 'start':
      return `start ${command ?? taskSlug ?? runLabel ?? 'background run'}`;
    default:
      return `${action} ${prompt ?? command ?? taskSlug ?? runLabel ?? 'run'}`.trim();
  }
}

export function buildToolPreview(block: Extract<MessageBlock, { type: 'tool_use' }>): string {
  if (block.tool === 'run') {
    const preview = buildRunToolPreview(block);
    if (preview) {
      return preview;
    }
  }

  return block.input.command
    ? String(block.input.command).split('\n')[0].slice(0, 64)
    : block.input.path ? String(block.input.path)
    : block.input.url ? String(block.input.url).replace('https://', '').slice(0, 60)
    : block.input.query ? String(block.input.query).slice(0, 60)
    : '';
}

function describeListedRunKind(details: ListedRunDetails): string | null {
  if (details.source === 'deferred-resume') {
    return 'wakeup';
  }

  if (details.source === 'web-live-session') {
    return 'live conversation';
  }

  if (details.source === 'scheduled-task' || details.kind === 'scheduled-task') {
    return 'scheduled task';
  }

  if (details.kind === 'raw-shell') {
    return 'shell run';
  }

  if (details.kind === 'workflow') {
    return 'workflow';
  }

  if (details.kind === 'background-run') {
    return 'background run';
  }

  if (details.kind === 'conversation') {
    return 'conversation run';
  }

  return null;
}

function readListedRuns(block: Extract<MessageBlock, { type: 'tool_use' }>): ListedRunDetails[] | null {
  if (block.tool !== 'run' || !isRecord(block.details) || block.details.action !== 'list' || !Array.isArray(block.details.runs)) {
    return null;
  }

  const next: ListedRunDetails[] = [];
  const seen = new Set<string>();

  for (const candidate of block.details.runs) {
    if (!isRecord(candidate)) {
      continue;
    }

    const runId = typeof candidate.runId === 'string' ? candidate.runId.trim() : '';
    if (!runId || seen.has(runId)) {
      continue;
    }

    seen.add(runId);
    next.push({
      runId,
      status: typeof candidate.status === 'string' ? candidate.status.trim() : null,
      kind: typeof candidate.kind === 'string' ? candidate.kind.trim() : null,
      source: typeof candidate.source === 'string' ? candidate.source.trim() : null,
    });
  }

  return next.length > 0 ? next : null;
}

function presentLinkedRun(runId: string, listed: ListedRunDetails | null = null): LinkedRunPresentation {
  const descriptor = describeLinkedRun(runId);
  const title = descriptor.detail ?? descriptor.title;
  const detailBits: string[] = [];
  const status = listed?.status && listed.status !== 'unknown'
    ? normalizeRunLabel(listed.status)
    : null;
  const kindLabel = listed ? (describeListedRunKind(listed) ?? descriptor.kindLabel) : descriptor.kindLabel;

  if (status) {
    detailBits.push(status);
  }

  if (kindLabel && normalizeRunLabel(kindLabel) !== normalizeRunLabel(title)) {
    detailBits.push(kindLabel);
  }

  return {
    runId,
    title,
    detail: detailBits.length > 0 ? detailBits.join(' · ') : null,
  };
}

function readRunToolLinkedRun(block: Extract<MessageBlock, { type: 'tool_use' }>): LinkedRunPresentation | null {
  if (block.tool !== 'run') {
    return null;
  }

  const details = isRecord(block.details) ? block.details : null;
  const input = isRecord(block.input) ? block.input : null;
  const action = readRunField(details, 'action') ?? readRunField(input, 'action');
  if (!action || action === 'list') {
    return null;
  }

  const sourceRunId = readRunField(details, 'sourceRunId');
  const extractedRunIds = extractDurableRunIdsFromBlock(block);
  const runId = readRunField(details, 'runId')
    ?? extractedRunIds.find((candidate) => candidate !== sourceRunId)
    ?? sourceRunId;
  if (!runId) {
    return null;
  }

  const descriptor = describeLinkedRun(runId);
  const taskSlug = readRunField(details, 'taskSlug') ?? readRunField(input, 'taskSlug');
  const prompt = excerptLinkedRunText(readRunField(details, 'prompt') ?? readRunField(input, 'prompt'));
  const command = excerptLinkedRunText(readRunField(details, 'command') ?? readRunField(input, 'command'));
  const cwd = summarizeWorkspaceTail(readRunField(details, 'cwd') ?? readRunField(input, 'cwd'));
  const model = readRunField(details, 'model') ?? readRunField(input, 'model');
  const status = readRunField(details, 'status') ?? (typeof block.status === 'string' ? block.status : null);
  const title = prompt ?? command ?? taskSlug ?? descriptor.detail ?? descriptor.title;
  const detailBits: string[] = [];

  if (status && status !== 'unknown') {
    pushRunDetail(detailBits, normalizeRunLabel(status));
  }

  switch (action) {
    case 'start_agent':
      pushRunDetail(detailBits, 'agent run');
      break;
    case 'start':
      pushRunDetail(detailBits, 'shell run');
      break;
    case 'follow_up':
      pushRunDetail(detailBits, 'follow-up run');
      break;
    case 'rerun':
      pushRunDetail(detailBits, 'rerun');
      break;
    case 'logs':
      pushRunDetail(detailBits, 'log view');
      break;
    case 'get':
      pushRunDetail(detailBits, 'run details');
      break;
    case 'cancel':
      pushRunDetail(detailBits, 'cancelled');
      break;
    default:
      pushRunDetail(detailBits, action.replace(/_/g, ' '));
      break;
  }

  if (taskSlug && normalizeRunLabel(taskSlug) !== normalizeRunLabel(title)) {
    pushRunDetail(detailBits, taskSlug);
  }

  if (cwd) {
    pushRunDetail(detailBits, `cwd ${cwd}`);
  }

  if (model) {
    pushRunDetail(detailBits, model.split('/').pop() ?? model);
  }

  if (sourceRunId) {
    pushRunDetail(
      detailBits,
      `from ${summarizeLinkedRunTail(sourceRunId.replace(/^(?:run|task)-/, '')) ?? sourceRunId}`,
    );
  }

  return {
    runId,
    title,
    detail: detailBits.length > 0 ? detailBits.join(' · ') : null,
  };
}

export function readLinkedRuns(block: Extract<MessageBlock, { type: 'tool_use' }>): { scope: 'listed' | 'mentioned'; runs: LinkedRunPresentation[] } {
  const listedRuns = readListedRuns(block);
  if (listedRuns) {
    return {
      scope: 'listed',
      runs: listedRuns.map((run) => presentLinkedRun(run.runId, run)),
    };
  }

  const runToolLinkedRun = readRunToolLinkedRun(block);
  if (runToolLinkedRun) {
    return {
      scope: 'mentioned',
      runs: [runToolLinkedRun],
    };
  }

  return {
    scope: 'mentioned',
    runs: extractDurableRunIdsFromBlock(block).map((runId) => presentLinkedRun(runId)),
  };
}

export function collectTraceClusterLinkedRuns(blocks: MessageBlock[]): LinkedRunPresentation[] {
  const seen = new Set<string>();
  const next: LinkedRunPresentation[] = [];

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block || block.type !== 'tool_use') {
      continue;
    }

    for (const run of readLinkedRuns(block).runs) {
      const runId = run.runId.trim();
      if (!runId || seen.has(runId)) {
        continue;
      }

      seen.add(runId);
      next.push(run);
    }
  }

  return next;
}

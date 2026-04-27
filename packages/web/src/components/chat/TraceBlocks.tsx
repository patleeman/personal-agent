import { memo, useMemo, useState } from 'react';
import type { MessageBlock } from '../../shared/types';
import { getStreamingThroughputLabel } from '../../transcript/streamingThroughput';
import { Pill, SurfacePanel, cx } from '../ui';
import { buildReplySelectionScopeProps, type ReplySelectionGestureHandler } from './replySelection.js';
import { buildSummaryPreview } from './summaryPreview.js';
import { collectTraceClusterLinkedRuns } from './linkedRuns.js';
import { InlineTraceRunCard } from './InlineTraceRunCard.js';
import { buildInlineRunExpansionKey } from './linkedRunPolling.js';
import { ToolBlock } from './ToolBlock.js';
import { resolveDisclosureOpen, shouldAutoOpenConversationBlock, shouldAutoOpenTraceCluster, toggleDisclosurePreference, toolMeta, type DisclosurePreference } from './toolPresentation.js';
import type { TraceClusterSummary, TraceClusterSummaryCategory, TraceConversationBlock } from './transcriptItems.js';

const TRACE_LINKED_RUN_VISIBLE_LIMIT = 4;

export const ThinkingBlock = memo(function ThinkingBlock({ block, autoOpen }: { block: Extract<MessageBlock, { type: 'thinking' }>; autoOpen: boolean }) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const open = resolveDisclosureOpen(autoOpen, preference);
  const preview = useMemo(() => buildSummaryPreview(block.text, 1), [block.text]);

  return (
    <SurfacePanel muted className="overflow-hidden border-transparent bg-elevated/35 text-[12px] shadow-none">
      <button
        onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-elevated transition-colors"
      >
        <span className="text-dim select-none">💭</span>
        <Pill tone="muted">Thinking</Pill>
        {!open && preview ? (
          <span className="min-w-0 flex-1 truncate text-secondary italic">{preview}</span>
        ) : (
          <span className="flex-1" />
        )}
        {autoOpen && <span className="text-[10px] uppercase tracking-[0.14em] text-dim/55">live</span>}
        <span className="text-dim text-[10px]">{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="border-t border-border-subtle/70 px-2.5 pb-2.5 pt-1.5 text-secondary italic leading-relaxed space-y-1">
          {block.text.split('\n').map((l, i) => <p key={i} className="text-[12px]">{l || <br />}</p>)}
        </div>
      )}
    </SurfacePanel>
  );
});

// ── SubagentBlock ─────────────────────────────────────────────────────────────

export const SubagentBlock = memo(function SubagentBlock({ block }: { block: Extract<MessageBlock, { type: 'subagent' }> }) {
  const [open, setOpen] = useState(false);
  const clr = { running: 'text-steel bg-steel/8 border-steel/20', complete: 'text-success bg-success/8 border-success/20', failed: 'text-danger bg-danger/8 border-danger/20' }[block.status];
  const tone = { running: 'steel', complete: 'success', failed: 'danger' }[block.status] as 'steel' | 'success' | 'danger';
  return (
    <div className={`rounded-lg overflow-hidden text-[12px] ${clr}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-black/5 transition-colors"
      >
        {block.status === 'running'
          ? <span className="w-4 h-4 border-[1.5px] border-current border-t-transparent rounded-full animate-spin shrink-0" />
          : <span className="font-bold shrink-0 select-none">⟳</span>}
        <Pill tone={tone} mono>subagent</Pill>
        <span className="flex-1 truncate opacity-70 font-normal">{block.name}</span>
        <Pill tone={tone}>{block.status}</Pill>
        <span className="shrink-0 ml-1 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-border-subtle/70 px-2.5 py-2 space-y-2 bg-black/5">
          <div>
            <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">prompt</p>
            <p className="opacity-70 leading-relaxed">{block.prompt}</p>
          </div>
          {block.summary && (
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">result</p>
              <p className="opacity-80 leading-relaxed">{block.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function traceSummaryTone(category: TraceClusterSummaryCategory) {
  switch (category.kind) {
    case 'thinking':
      return 'muted';
    case 'subagent':
      return 'steel';
    case 'error':
      return 'danger';
    case 'tool':
      return toolMeta(category.tool ?? category.label).tone;
  }
}

const MAX_VISIBLE_TRACE_BLOCKS = 5;

export function TraceClusterBlock({
  clusterStartIndex,
  blocks,
  summary,
  live,
  onOpenArtifact,
  activeArtifactId,
  onOpenCheckpoint,
  activeCheckpointId,
  onOpenFilePath,
  onResume,
  resumeBusy,
  resumeTitle,
  resumeLabel,
  isInlineRunExpanded,
  onToggleInlineRun,
}: {
  clusterStartIndex: number;
  blocks: TraceConversationBlock[];
  summary: TraceClusterSummary;
  live: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onResume?: () => Promise<void> | void;
  resumeBusy?: boolean;
  resumeTitle?: string | null;
  resumeLabel?: string;
  isInlineRunExpanded?: (inlineRunKey: string) => boolean;
  onToggleInlineRun?: (inlineRunKey: string) => void;
}) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const [showAllBlocks, setShowAllBlocks] = useState(false);
  const [showAllLinkedRuns, setShowAllLinkedRuns] = useState(false);
  const linkedRuns = useMemo(() => collectTraceClusterLinkedRuns(blocks), [blocks]);
  const hiddenLinkedRunCount = Math.max(0, linkedRuns.length - TRACE_LINKED_RUN_VISIBLE_LIMIT);
  const visibleLinkedRuns = showAllLinkedRuns || hiddenLinkedRunCount === 0
    ? linkedRuns
    : linkedRuns.slice(0, TRACE_LINKED_RUN_VISIBLE_LIMIT);
  const expandedCategories = summary.categories.slice(0, 3);
  const remainingCategoryCount = Math.max(0, summary.categories.length - expandedCategories.length);
  const durationLabel = summary.durationMs && summary.durationMs > 0
    ? `${(summary.durationMs / 1000).toFixed(1)}s`
    : null;
  const throughputLabel = useMemo(
    () => getStreamingThroughputLabel(blocks, live),
    [blocks, live],
  );
  const isActive = live || summary.hasRunning;
  const title = isActive ? 'Working' : 'Internal work';
  const autoOpen = shouldAutoOpenTraceCluster(live, summary.hasRunning);
  const open = resolveDisclosureOpen(autoOpen, preference);
  const hiddenBlockCount = Math.max(0, blocks.length - MAX_VISIBLE_TRACE_BLOCKS);
  const visibleBlocks = showAllBlocks || hiddenBlockCount === 0
    ? blocks
    : blocks.slice(-MAX_VISIBLE_TRACE_BLOCKS);
  const visibleStartIndex = blocks.length - visibleBlocks.length;
  const panelClassName = cx(
    'flex-1 rounded-xl border px-2.5 py-2 text-left transition-colors',
    summary.hasError
      ? 'border-danger/30 bg-danger/5 hover:bg-danger/10'
      : 'border-border-subtle bg-elevated/60 hover:bg-elevated',
  );

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
        <button
          type="button"
          onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
          aria-expanded={open}
          className={panelClassName}
        >
          <div className="flex items-center gap-2 text-[12px]">
            {isActive ? (
              <span className="h-4 w-4 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent animate-spin text-accent" />
            ) : (
              <span className={cx('w-4 shrink-0 text-center text-[11px] select-none', summary.hasError ? 'text-danger' : 'text-dim')}>⋯</span>
            )}
            <span className="font-medium text-primary">{title}</span>
            <span className="text-secondary">· {summary.stepCount} step{summary.stepCount === 1 ? '' : 's'}</span>
            <span className="flex-1" />
            {isActive && <span className="text-[10px] uppercase tracking-[0.14em] text-accent/80">live</span>}
            {throughputLabel && (
              <span
                className="font-mono text-[11px] text-accent/80"
                title="Estimated from streamed output using the same chars/4 token heuristic used elsewhere in Pi."
              >
                {throughputLabel}
              </span>
            )}
            {durationLabel && !isActive && <span className="text-[11px] text-dim">{durationLabel}</span>}
            <span className="text-[10px] text-dim">{open ? '▲ hide' : '▼ show'}</span>
          </div>
          {summary.categories.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {expandedCategories.map((category) => (
                <Pill key={category.key} tone={traceSummaryTone(category)} mono={category.kind === 'tool'}>
                  {category.label}{category.count > 1 ? ` ×${category.count}` : ''}
                </Pill>
              ))}
              {remainingCategoryCount > 0 && <span className="text-[11px] text-dim">+{remainingCategoryCount} more</span>}
            </div>
          )}
        </button>
        <ResumeConversationAction
          onResume={onResume}
          busy={resumeBusy}
          title={resumeTitle}
          label={resumeLabel}
          variant="inline"
        />
      </div>

      {linkedRuns.length > 0 && (
        <div className="ml-2.5 space-y-1.5 border-l border-border-subtle pl-2.5">
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-elevated/30 px-2.5 py-1.5 text-[11px] text-secondary">
            <span className="text-[10px] uppercase tracking-[0.14em] text-dim">runs</span>
            <span>{linkedRuns.length} linked</span>
            <span className="flex-1" />
            {hiddenLinkedRunCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllLinkedRuns((current) => !current)}
                className="ui-action-button text-[10px]"
              >
                {showAllLinkedRuns ? `Show first ${TRACE_LINKED_RUN_VISIBLE_LIMIT}` : `Show all ${linkedRuns.length}`}
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {visibleLinkedRuns.map((linkedRun) => {
              const inlineRunKey = buildInlineRunExpansionKey(clusterStartIndex, linkedRun.runId);

              return (
                <InlineTraceRunCard
                  key={linkedRun.runId}
                  run={linkedRun}
                  expanded={isInlineRunExpanded?.(inlineRunKey) ?? false}
                  onToggle={() => {
                    onToggleInlineRun?.(inlineRunKey);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {open && (
        <div className="ml-2.5 space-y-1.5 border-l border-border-subtle pl-2.5">
          {hiddenBlockCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-elevated/35 px-2.5 py-1.5 text-[11px] text-secondary">
              <span>{showAllBlocks ? `Showing all ${blocks.length} steps.` : `${hiddenBlockCount} earlier step${hiddenBlockCount === 1 ? '' : 's'} summarized above.`}</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setShowAllBlocks((current) => !current)}
                className="ui-action-button text-[10px]"
              >
                {showAllBlocks ? `Show latest ${MAX_VISIBLE_TRACE_BLOCKS}` : 'Show all'}
              </button>
            </div>
          )}
          {visibleBlocks.map((block, index) => {
            const blockIndex = visibleStartIndex + index;
            const autoOpen = shouldAutoOpenConversationBlock(block, blockIndex, blocks.length, live);

            switch (block.type) {
              case 'thinking':
                return <ThinkingBlock key={`thinking-${blockIndex}`} block={block} autoOpen={autoOpen} />;
              case 'tool_use':
                return (
                  <ToolBlock
                    key={`tool-${blockIndex}`}
                    block={block}
                    autoOpen={autoOpen}
                    onOpenArtifact={onOpenArtifact}
                    activeArtifactId={activeArtifactId}
                    onOpenCheckpoint={onOpenCheckpoint}
                    activeCheckpointId={activeCheckpointId}
                    onOpenFilePath={onOpenFilePath}
                  />
                );
              case 'subagent':
                return <SubagentBlock key={`subagent-${blockIndex}`} block={block} />;
              case 'error':
                return <ErrorBlock key={`error-${blockIndex}`} block={block} onOpenFilePath={onOpenFilePath} />;
              default:
                return null;
            }
          })}
        </div>
      )}
    </div>
  );
}

// ── ImageBlock ────────────────────────────────────────────────────────────────

export function ResumeConversationAction({
  onResume,
  busy = false,
  title,
  label = 'continue',
  variant = 'compact',
}: {
  onResume?: () => Promise<void> | void;
  busy?: boolean;
  title?: string | null;
  label?: string;
  variant?: 'compact' | 'inline';
}) {
  if (!onResume) {
    return null;
  }

  const compactClassName = 'shrink-0 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:text-dim';
  const inlineClassName = 'group inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:bg-elevated hover:text-primary disabled:cursor-default disabled:text-dim disabled:hover:bg-transparent sm:self-center';

  return (
    <button
      type="button"
      onClick={() => { void onResume(); }}
      disabled={busy}
      title={title ?? 'Resume this conversation'}
      className={variant === 'inline' ? inlineClassName : compactClassName}
    >
      {variant === 'inline' && (
        busy ? (
          <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent animate-spin text-dim" />
        ) : (
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            className="h-3.5 w-3.5 shrink-0 text-accent/75 transition-colors group-hover:text-accent"
          >
            <path d="M12.75 4.75V1.75M12.75 1.75H9.75M12.75 1.75L10.25 4.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.1 7.1C12.1 9.91665 9.81665 12.2 7 12.2C4.18335 12.2 1.9 9.91665 1.9 7.1C1.9 4.28335 4.18335 2 7 2C8.31638 2 9.5163 2.49883 10.4201 3.31798" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      )}
      {busy ? 'opening…' : label}
    </button>
  );
}

// ── ErrorBlock ────────────────────────────────────────────────────────────────

export const ErrorBlock = memo(function ErrorBlock({
  block,
  messageIndex,
  onResume,
  resumeBusy,
  resumeTitle,
  resumeLabel,
  onOpenFilePath: _onOpenFilePath,
  onSelectionGesture,
}: {
  block: Extract<MessageBlock, { type: 'error' }>;
  messageIndex?: number;
  onResume?: () => Promise<void> | void;
  resumeBusy?: boolean;
  resumeTitle?: string | null;
  resumeLabel?: string;
  onOpenFilePath?: (path: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
}) {
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <SurfacePanel className="border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] font-mono flex gap-2 items-start">
      <span className="text-danger font-bold shrink-0 mt-0.5 select-none">✕</span>
      <div className="flex-1 min-w-0 space-y-2">
        <div {...replySelectionScopeProps}>
          {block.tool && <span className="text-danger/70 font-semibold">{block.tool} · </span>}
          <span className="text-danger/85 leading-relaxed">{block.message}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1" />
          <ResumeConversationAction
            onResume={onResume}
            busy={resumeBusy}
            title={resumeTitle}
            label={resumeLabel}
            variant="inline"
          />
        </div>
      </div>
    </SurfacePanel>
  );
});

// ── Message actions ───────────────────────────────────────────────────────────


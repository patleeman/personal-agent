import { useMemo, useState } from 'react';
import { readArtifactPresentation } from '../../conversation/conversationArtifacts';
import { readCheckpointPresentation } from '../../conversation/conversationCheckpoints';
import { readAskUserQuestionPresentation, type AskUserQuestionAnswers, type AskUserQuestionPresentation } from '../../transcript/askUserQuestions';
import { readTerminalBashToolPresentation } from '../../transcript/terminalBashBlock';
import type { MessageBlock } from '../../shared/types';
import { Pill, cx } from '../ui';
import { buildToolPreview, readLinkedRuns } from './linkedRuns.js';
import { AskUserQuestionToolBlock, describeAskUserQuestionState } from './AskUserQuestionToolBlock.js';
import { ArtifactToolBlock, CheckpointToolBlock } from './ArtifactCheckpointToolBlocks.js';
import { TerminalToolBlock } from './TerminalToolBlock.js';
import { resolveDisclosureOpen, toggleDisclosurePreference, toolMeta, type DisclosurePreference } from './toolPresentation.js';

const MAX_VISIBLE_LINKED_RUNS = 5;

export function ToolBlock({
  block,
  autoOpen,
  onOpenArtifact,
  activeArtifactId,
  onOpenCheckpoint,
  activeCheckpointId,
  onOpenFilePath: _onOpenFilePath,
  onHydrateMessage,
  hydratingMessageBlockIds,
  messages,
  messageIndex,
  onSubmitAskUserQuestion,
  askUserQuestionDisplayMode = 'inline',
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  autoOpen: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  messages?: MessageBlock[];
  messageIndex?: number;
  onSubmitAskUserQuestion?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  askUserQuestionDisplayMode?: 'inline' | 'composer';
}) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const [showAllRuns, setShowAllRuns] = useState(false);
  const open = resolveDisclosureOpen(autoOpen, preference);
  const meta = toolMeta(block.tool);
  const artifact = readArtifactPresentation(block);
  const checkpoint = readCheckpointPresentation(block);
  const askUserQuestion = readAskUserQuestionPresentation(block);
  const askUserQuestionState = useMemo(
    () => describeAskUserQuestionState(messages, messageIndex),
    [messageIndex, messages],
  );
  const linkedRuns = useMemo(() => readLinkedRuns(block), [block]);

  if (artifact) {
    return (
      <ArtifactToolBlock
        block={block}
        artifact={artifact}
        onOpenArtifact={onOpenArtifact}
        activeArtifactId={activeArtifactId}
      />
    );
  }

  if (checkpoint) {
    return (
      <CheckpointToolBlock
        block={block}
        checkpoint={checkpoint}
        onOpenCheckpoint={onOpenCheckpoint}
        activeCheckpointId={activeCheckpointId}
      />
    );
  }

  const terminalBash = readTerminalBashToolPresentation(block);
  if (terminalBash) {
    return (
      <TerminalToolBlock
        block={block}
        onHydrateMessage={onHydrateMessage}
        hydratingMessageBlockIds={hydratingMessageBlockIds}
      />
    );
  }

  if (block.tool === 'ask_user_question' && askUserQuestion && !(block.status === 'error' || block.error)) {
    return (
      <AskUserQuestionToolBlock
        block={block}
        presentation={askUserQuestion}
        state={askUserQuestionState}
        onSubmit={onSubmitAskUserQuestion}
        mode={askUserQuestionDisplayMode}
      />
    );
  }

  // Normalise tool state across streamed and persisted entries.
  const isRunning = block.status === 'running' || !!block.running;
  const isError   = block.status === 'error'   || !!block.error;
  const output    = block.output ?? '';
  const blockId = block.id?.trim();
  const outputDeferred = Boolean(block.outputDeferred && blockId && onHydrateMessage);
  const hydratingDeferredOutput = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));

  const preview = buildToolPreview(block);
  const hiddenRunCount = Math.max(0, linkedRuns.runs.length - MAX_VISIBLE_LINKED_RUNS);
  const visibleRuns = showAllRuns || hiddenRunCount === 0
    ? linkedRuns.runs
    : linkedRuns.runs.slice(0, MAX_VISIBLE_LINKED_RUNS);

  return (
    <div className={cx('rounded-lg text-[12px] font-mono overflow-hidden transition-colors', meta.color, isError && 'border border-danger/40 bg-danger/5 text-danger')}>
      <button
        onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-black/5 transition-colors text-left"
      >
        {isRunning ? (
          <span className="w-4 h-4 border-[1.5px] border-current border-t-transparent rounded-full animate-spin shrink-0 opacity-70" />
        ) : (
          <span className="font-bold w-4 text-center shrink-0 select-none">{meta.icon}</span>
        )}
        <Pill tone={isError ? 'danger' : meta.tone} mono className="shrink-0">
          {meta.label}
        </Pill>
        <span className="flex-1 truncate opacity-70 font-normal">{preview}</span>
        {block.durationMs && !isRunning && (
          <span className="shrink-0 opacity-40 ml-2">{(block.durationMs / 1000).toFixed(1)}s</span>
        )}
        {isRunning ? (
          <>
            <span className="shrink-0 text-[10px] opacity-60 ml-2">running…</span>
            <span className="shrink-0 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>
          </>
        ) : <span className="shrink-0 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>}
      </button>

      {linkedRuns.runs.length > 0 && (
        <div className="border-t border-border-subtle/70 bg-black/5 px-2.5 py-2 text-[11px] font-sans">
          <p className="mb-1.5 uppercase tracking-[0.14em] opacity-40">
            {linkedRuns.runs.length === 1
              ? (linkedRuns.scope === 'listed' ? 'listed execution' : 'mentioned execution')
              : (linkedRuns.scope === 'listed' ? 'listed executions' : 'mentioned executions')}
          </p>
          {hiddenRunCount > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-[10px] text-secondary/80">
              <span>
                {showAllRuns
                  ? `Showing all ${linkedRuns.runs.length} ${linkedRuns.scope === 'listed' ? 'executions returned by the tool.' : 'executions mentioned in this step.'}`
                  : `Showing ${MAX_VISIBLE_LINKED_RUNS} of ${linkedRuns.runs.length} ${linkedRuns.scope === 'listed' ? 'executions returned by the tool.' : 'executions mentioned in this step.'}`}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setShowAllRuns((current) => !current)}
                className="ui-action-button text-[10px]"
              >
                {showAllRuns ? 'Show fewer' : 'Show all'}
              </button>
            </div>
          )}
          <div className="space-y-1.5">
            {visibleRuns.map((linkedRun) => (
              <div
                key={linkedRun.runId}
                className="w-full rounded-md px-2 py-1.5 text-left text-dim"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium leading-4 text-primary">{linkedRun.title}</p>
                    {linkedRun.detail && (
                      <p className="mt-1 truncate text-[10px] leading-4 text-secondary/80">{linkedRun.detail}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] opacity-45">linked</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-border-subtle/70">
          <div className="px-2.5 py-2 bg-black/5">
            <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">input</p>
            <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">{JSON.stringify(block.input, null, 2)}</pre>
          </div>
          {(isRunning || output || outputDeferred) && (
            <div className={cx('px-2.5 py-2', isRunning && output && 'max-h-40 overflow-y-auto')}>
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[10px] uppercase tracking-wider opacity-40">
                  {isRunning ? 'live output' : `output · ${output.split('\n').length} lines`}
                </p>
                {outputDeferred && blockId && (
                  <button
                    type="button"
                    onClick={() => { void onHydrateMessage?.(blockId); }}
                    disabled={hydratingDeferredOutput}
                    className="ui-action-button text-[10px]"
                  >
                    {hydratingDeferredOutput ? 'Loading full output…' : 'Load full output'}
                  </button>
                )}
              </div>
              {output ? (
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">{output}</pre>
              ) : isRunning ? (
                <p className="text-[11px] italic leading-relaxed opacity-55">Waiting for output…</p>
              ) : outputDeferred ? (
                <p className="text-[11px] italic leading-relaxed opacity-55">Older tool output is available on demand.</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ThinkingBlock ─────────────────────────────────────────────────────────────


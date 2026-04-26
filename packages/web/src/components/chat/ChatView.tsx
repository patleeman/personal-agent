import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { parseSkillBlock } from '../../knowledge/skillBlock';
import { readArtifactPresentation } from '../../conversation/conversationArtifacts';
import { readCheckpointPresentation } from '../../conversation/conversationCheckpoints';
import {
  isAskUserQuestionComplete,
  moveAskUserQuestionIndex,
  readAskUserQuestionPresentation,
  resolveAskUserQuestionDefaultOptionIndex,
  resolveAskUserQuestionNavigationHotkey,
  resolveAskUserQuestionOptionHotkey,
  shouldAdvanceAskUserQuestionAfterSelection,
  type AskUserQuestionAnswers,
  type AskUserQuestionPresentation,
} from '../../transcript/askUserQuestions';
import { api } from '../../client/api';
import { useAppData } from '../../app/contexts';
import {
  getRunHeadline,
  getRunMoment,
  getRunTargetCommand,
  getRunTargetModel,
  getRunTargetProfile,
  getRunTargetPrompt,
  getRunTaskSlug,
  getRunTimeline,
  getRunWorkingDirectory,
  isRunActive,
  type RunPresentationLookups,
} from '../../automation/runPresentation';
import type { DurableRunDetailResult, DurableRunRecord, MessageBlock } from '../../shared/types';
import { timeAgo } from '../../shared/utils';
import { buildChatRenderItems, type ChatRenderItem, type TraceClusterSummary, type TraceClusterSummaryCategory, type TraceConversationBlock } from './transcriptItems.js';
import { renderMarkdownText, renderText, SkillInvocationCard } from './MarkdownMessage.js';
import { readTerminalBashToolPresentation } from '../../transcript/terminalBashBlock';
import { getStreamingThroughputLabel } from '../../transcript/streamingThroughput';
import { getDesktopBridge, shouldUseNativeAppContextMenus } from '../../desktop/desktopBridge';
import { CheckpointInlineDiff } from './CheckpointInlineDiff';
import { Pill, SurfacePanel, cx } from '../ui';
import { buildReplySelectionScopeProps, findSelectionReplyScopeElement, findSelectionReplyScopeElements, readSelectedTextWithinElement, type ReplySelectionGestureHandler } from './replySelection.js';
import { buildSummaryPreview } from './summaryPreview.js';
import { buildToolPreview, normalizeRunLabel, readLinkedRuns, type LinkedRunPresentation } from './linkedRuns.js';

function formatInjectedContextLabel(customType?: string): string {
  if (!customType || customType === 'referenced_context') {
    return 'Injected context';
  }

  const normalized = customType.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Injected context';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// ── Tool icon & color ─────────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: string; label: string; color: string; tone: 'steel' | 'teal' | 'accent' | 'success' | 'warning' | 'muted' }> = {
  bash:        { icon: '$',  label: 'bash',            color: 'text-steel bg-steel/5',       tone: 'steel' },
  read:        { icon: '≡',  label: 'read',            color: 'text-teal bg-teal/5',         tone: 'teal' },
  write:       { icon: '✎',  label: 'write',           color: 'text-accent bg-accent/5',     tone: 'accent' },
  edit:        { icon: '✎',  label: 'edit',            color: 'text-accent bg-accent/5',     tone: 'accent' },
  web_search:  { icon: '⌕',  label: 'web_search',      color: 'text-success bg-success/5',   tone: 'success' },
  web_fetch:   { icon: '⌕',  label: 'web_fetch',       color: 'text-success bg-success/5',   tone: 'success' },
  image:       { icon: '◌',  label: 'image',           color: 'text-accent bg-accent/5',     tone: 'accent' },
  screenshot:  { icon: '⊡',  label: 'screenshot',      color: 'text-secondary bg-elevated',  tone: 'muted' },
  artifact:    { icon: '◫',  label: 'artifact',        color: 'text-accent bg-accent/5',     tone: 'accent' },
  checkpoint:  { icon: '✓',  label: 'checkpoint',      color: 'text-success bg-success/5',   tone: 'success' },
  ask_user_question: { icon: '?', label: 'question',   color: 'text-warning bg-warning/5',   tone: 'warning' },
  change_working_directory: { icon: '↗', label: 'cwd', color: 'text-teal bg-teal/5', tone: 'teal' },
  deferred_resume: { icon: '⏰', label: 'deferred_resume', color: 'text-warning bg-warning/5', tone: 'warning' },
};
function toolMeta(t: string) {
  return TOOL_META[t] ?? { icon: '⚙', label: t, color: 'text-secondary bg-elevated', tone: 'muted' as const };
}

type DisclosurePreference = 'auto' | 'open' | 'closed';

function resolveDisclosureOpen(autoOpen: boolean, preference: DisclosurePreference): boolean {
  if (preference === 'open') return true;
  if (preference === 'closed') return false;
  return autoOpen;
}

function toggleDisclosurePreference(autoOpen: boolean, preference: DisclosurePreference): DisclosurePreference {
  return resolveDisclosureOpen(autoOpen, preference) ? 'closed' : 'open';
}

function shouldAutoOpenTraceCluster(live: boolean, hasRunning: boolean): boolean {
  return live || hasRunning;
}

function shouldAutoOpenConversationBlock(
  block: MessageBlock,
  index: number,
  total: number,
  isStreaming: boolean,
): boolean {
  if (block.type === 'tool_use') {
    return block.status === 'running' || !!block.running;
  }

  if (block.type === 'thinking') {
    return isStreaming && index === total - 1;
  }

  return false;
}

function getStreamingStatusLabel(messages: MessageBlock[], isStreaming: boolean): string | null {
  if (!isStreaming) {
    return null;
  }

  const last = messages[messages.length - 1];
  if (!last) {
    return 'Working…';
  }

  switch (last.type) {
    case 'thinking':
      return 'Thinking…';
    case 'tool_use':
      return last.status === 'running' || !!last.running
        ? `Running ${toolMeta(last.tool).label}…`
        : 'Working…';
    case 'subagent':
      return last.status === 'running'
        ? `Running ${last.name}…`
        : 'Working…';
    case 'text':
      return 'Responding…';
    default:
      return 'Working…';
  }
}

// ── ToolBlock ─────────────────────────────────────────────────────────────────

const ArtifactToolBlock = memo(function ArtifactToolBlock({
  block,
  artifact,
  onOpenArtifact,
  activeArtifactId,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  artifact: NonNullable<ReturnType<typeof readArtifactPresentation>>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error;
  const isActive = activeArtifactId === artifact.artifactId;
  const actionLabel = isActive ? 'opened' : 'open';

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3.5 py-3 text-[12px] transition-colors',
        isError && 'border-danger/30 bg-danger/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">◫</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-primary">{artifact.title}</span>
            <Pill tone={isError ? 'danger' : 'accent'} mono>{artifact.kind}</Pill>
            {artifact.revision !== undefined && <span className="text-[10px] text-dim">rev {artifact.revision}</span>}
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-secondary">{artifact.artifactId}</p>
          {block.output && !isError && (
            <p className="mt-2 text-[12px] leading-relaxed text-secondary">{block.output}</p>
          )}
          {isError && block.output && (
            <p className="mt-2 text-[12px] leading-relaxed text-danger/85">{block.output}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 text-dim">
                <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                saving artifact…
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenArtifact?.(artifact.artifactId)}
                disabled={!onOpenArtifact}
                className={cx(
                  'text-accent transition-colors hover:text-accent/80 disabled:cursor-default disabled:text-dim',
                  isActive && 'text-dim hover:text-dim',
                )}
              >
                {actionLabel}
              </button>
            )}
            {artifact.updatedAt && <span className="text-dim">updated {timeAgo(artifact.updatedAt)}</span>}
          </div>
        </div>
      </div>
    </SurfacePanel>
  );
});

const CheckpointToolBlock = memo(function CheckpointToolBlock({
  block,
  checkpoint,
  onOpenCheckpoint,
  activeCheckpointId,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  checkpoint: NonNullable<ReturnType<typeof readCheckpointPresentation>>;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error;
  const isActive = activeCheckpointId === checkpoint.checkpointId;
  const commentCount = (checkpoint as { commentCount?: number }).commentCount;

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3.5 py-3 text-[12px] transition-colors',
        isError ? 'border-danger/30 bg-danger/5' : 'border-success/20 bg-success/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">✓</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-primary">{checkpoint.subject}</span>
            <Pill tone={isError ? 'danger' : 'success'} mono>{checkpoint.shortSha}</Pill>
            {typeof checkpoint.fileCount === 'number' ? <span className="text-[10px] text-dim">{checkpoint.fileCount} files</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            {typeof checkpoint.linesAdded === 'number' && typeof checkpoint.linesDeleted === 'number' ? (
              <span className="font-mono tabular-nums text-secondary"><span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span></span>
            ) : null}
            {typeof commentCount === 'number' && commentCount > 0 ? (
              <span className="text-dim">{commentCount} comment{commentCount === 1 ? '' : 's'}</span>
            ) : null}
            {checkpoint.updatedAt && <span className="text-dim">updated {timeAgo(checkpoint.updatedAt)}</span>}
          </div>
          {isError && block.output && (
            <p className="mt-2 text-[12px] leading-relaxed text-danger/85">{block.output}</p>
          )}
          {isRunning ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-dim">
                <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                saving checkpoint…
              </span>
            </div>
          ) : !isError && checkpoint.conversationId ? (
            <CheckpointInlineDiff
              conversationId={checkpoint.conversationId}
              checkpointId={checkpoint.checkpointId}
              onOpenCheckpoint={onOpenCheckpoint}
              modalOpen={isActive}
            />
          ) : !isError && onOpenCheckpoint ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => onOpenCheckpoint(checkpoint.checkpointId)}
                className={cx('ui-action-button text-[11px]', isActive ? 'text-secondary' : 'text-accent')}
              >
                {isActive ? 'Modal open' : 'Open modal'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </SurfacePanel>
  );
});

const TerminalToolBlock = memo(function TerminalToolBlock({
  block,
  onHydrateMessage,
  hydratingMessageBlockIds,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
}) {
  const presentation = readTerminalBashToolPresentation(block);
  if (!presentation) {
    return null;
  }

  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error || ((presentation.exitCode ?? 0) !== 0 && presentation.exitCode !== undefined);
  const blockId = block.id?.trim();
  const outputDeferred = Boolean(block.outputDeferred && blockId && onHydrateMessage);
  const hydratingDeferredOutput = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));
  const hasBody = isRunning || block.output || outputDeferred;
  const copyText = block.output ? `$ ${presentation.command}\n${block.output}` : `$ ${presentation.command}`;
  const footerBits: string[] = [];

  if (presentation.cancelled) {
    footerBits.push('cancelled');
  } else if (presentation.exitCode !== undefined) {
    footerBits.push(`exit ${presentation.exitCode}`);
  } else if (isRunning) {
    footerBits.push('running');
  }

  if (presentation.truncated) {
    footerBits.push('truncated');
  }

  if (block.durationMs && !isRunning) {
    footerBits.push(`${(block.durationMs / 1000).toFixed(1)}s`);
  }

  return (
    <div className="group space-y-1.5">
      <div className={cx(
        'ui-terminal-block',
        isError ? 'border-danger/35' : null,
      )}>
        <div className="ui-terminal-block__chrome flex items-center gap-2 border-b px-3 py-2 text-[11px]">
          {isRunning ? (
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent animate-spin text-accent" />
          ) : (
            <span className={cx('w-3 shrink-0 text-center', isError ? 'text-danger' : 'text-accent')}>$</span>
          )}
          <span className="min-w-0 flex-1 break-all text-primary">{presentation.command}</span>
          {presentation.excludeFromContext && <Pill tone="warning" mono>no context</Pill>}
        </div>

        {hasBody && (
          <div className="px-3 py-2.5">
            {block.output ? (
              <pre className={cx('whitespace-pre-wrap break-all text-[11px] leading-relaxed', isError ? 'text-danger/85' : 'text-secondary')}>
                {block.output}
              </pre>
            ) : isRunning ? (
              <p className="text-[11px] italic leading-relaxed text-dim">Waiting for output…</p>
            ) : outputDeferred ? (
              <p className="text-[11px] italic leading-relaxed text-dim">Older terminal output is available on demand.</p>
            ) : null}
          </div>
        )}

        <div className="ui-terminal-block__chrome flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[10px] text-dim">
          {footerBits.map((bit) => (
            <span key={bit}>{bit}</span>
          ))}
          {presentation.fullOutputPath && (
            <span className="min-w-0 break-all text-dim/80">{presentation.fullOutputPath}</span>
          )}
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
          <span className="ml-auto">{timeAgo(block.ts)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <MsgActions copyText={copyText} />
      </div>
    </div>
  );
});

interface AskUserQuestionState {
  status: 'pending' | 'answered' | 'superseded';
  answerBlock?: Extract<MessageBlock, { type: 'user' }>;
}

function describeAskUserQuestionState(messages: MessageBlock[] | undefined, messageIndex: number | undefined): AskUserQuestionState {
  if (!messages || typeof messageIndex !== 'number') {
    return { status: 'pending' };
  }

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }

    if (candidate.type === 'user') {
      return { status: 'answered', answerBlock: candidate };
    }

    if (candidate.type === 'tool_use' && candidate.tool === 'ask_user_question') {
      return { status: 'superseded' };
    }
  }

  return { status: 'pending' };
}

function summarizeAskUserQuestionAnswer(block: Extract<MessageBlock, { type: 'user' }> | undefined): string | null {
  if (!block) {
    return null;
  }

  const text = block.text.trim().replace(/\s+/g, ' ');
  if (text.length > 0) {
    return text.length > 180 ? `${text.slice(0, 179)}…` : text;
  }

  const imageCount = block.images?.length ?? 0;
  if (imageCount > 0) {
    return imageCount === 1 ? 'Sent 1 image attachment.' : `Sent ${imageCount} image attachments.`;
  }

  return null;
}

function AskUserQuestionToolBlock({
  block,
  presentation,
  state,
  onSubmit,
  mode = 'inline',
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  presentation: AskUserQuestionPresentation;
  state: AskUserQuestionState;
  onSubmit?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  mode?: 'inline' | 'composer';
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const answerPreview = summarizeAskUserQuestionAnswer(state.answerBlock);
  const statusLabel = state.status === 'answered'
    ? 'answered'
    : state.status === 'superseded'
      ? 'replaced'
      : isRunning
        ? 'asking…'
        : 'waiting';
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [answers, setAnswers] = useState<AskUserQuestionAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const questionTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const questionIdsKey = useMemo(
    () => presentation.questions.map((question) => question.id).join('|'),
    [presentation.questions],
  );

  useEffect(() => {
    setActiveQuestionIndex(0);
    setActiveOptionIndex(0);
    setAnswers({});
    setSubmitting(false);
  }, [questionIdsKey]);

  const activeQuestion = presentation.questions[Math.max(0, Math.min(activeQuestionIndex, presentation.questions.length - 1))] ?? null;

  useEffect(() => {
    if (!activeQuestion) {
      setActiveOptionIndex(0);
      optionRefs.current = [];
      return;
    }

    setActiveOptionIndex(resolveAskUserQuestionDefaultOptionIndex(activeQuestion, answers));
    optionRefs.current = [];
  }, [activeQuestion, activeQuestionIndex, answers, questionIdsKey]);

  const answeredCount = presentation.questions.filter((question) => (answers[question.id]?.length ?? 0) > 0).length;
  const hasInteractiveOptions = presentation.questions.some((question) => question.options.length > 0);
  const canSubmit = hasInteractiveOptions && isAskUserQuestionComplete(presentation, answers) && Boolean(onSubmit);
  const submitLabel = submitting ? 'Submitting…' : '✓ Submit →';

  const focusQuestionTab = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      questionTabRefs.current[index]?.focus();
    });
  }, []);

  const focusSubmitButton = useCallback(() => {
    window.requestAnimationFrame(() => {
      submitButtonRef.current?.focus();
    });
  }, []);

  const focusOption = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      optionRefs.current[index]?.focus();
    });
  }, []);

  const activateQuestion = useCallback((index: number, options?: { focus?: 'tab' | 'option' }) => {
    const nextIndex = Math.max(0, Math.min(index, presentation.questions.length - 1));
    const nextQuestion = presentation.questions[nextIndex];
    const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, answers);
    setActiveQuestionIndex(nextIndex);
    setActiveOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);

    if (options?.focus === 'tab') {
      focusQuestionTab(nextIndex);
    } else if (options?.focus === 'option') {
      if (nextOptionIndex >= 0) {
        focusOption(nextOptionIndex);
      } else {
        focusQuestionTab(nextIndex);
      }
    }
  }, [answers, focusOption, focusQuestionTab, presentation.questions]);

  const submitIfReady = useCallback(async () => {
    if (!onSubmit || !canSubmit) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(presentation, answers);
    } finally {
      setSubmitting(false);
    }
  }, [answers, canSubmit, onSubmit, presentation]);

  const advanceAfterAnswer = useCallback((questionIndex: number, nextAnswers: AskUserQuestionAnswers) => {
    const nextQuestionIndex = questionIndex + 1;
    if (nextQuestionIndex < presentation.questions.length) {
      const nextQuestion = presentation.questions[nextQuestionIndex];
      const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, nextAnswers);
      setActiveQuestionIndex(nextQuestionIndex);
      setActiveOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);
      if (nextOptionIndex >= 0) {
        focusOption(nextOptionIndex);
      } else {
        focusQuestionTab(nextQuestionIndex);
      }
      return;
    }

    if (isAskUserQuestionComplete(presentation, nextAnswers)) {
      focusSubmitButton();
    }
  }, [focusOption, focusQuestionTab, focusSubmitButton, presentation]);

  const applyRadioAnswer = useCallback((questionIndex: number, value: string) => {
    const question = presentation.questions[questionIndex];
    if (!question) {
      return;
    }

    const nextValues = [value];
    const nextAnswers = {
      ...answers,
      [question.id]: nextValues,
    };
    setAnswers(nextAnswers);
    if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
      advanceAfterAnswer(questionIndex, nextAnswers);
    }
  }, [advanceAfterAnswer, answers, presentation.questions]);

  const applyCheckAnswer = useCallback((questionIndex: number, value: string) => {
    const question = presentation.questions[questionIndex];
    if (!question) {
      return;
    }

    const currentValues = answers[question.id] ?? [];
    const alreadySelected = currentValues.includes(value);
    const nextValues = alreadySelected
      ? currentValues.filter((candidate) => candidate !== value)
      : [...currentValues, value];
    const nextAnswers = {
      ...answers,
      [question.id]: nextValues,
    };

    setAnswers(nextAnswers);
    if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
      advanceAfterAnswer(questionIndex, nextAnswers);
    }
  }, [advanceAfterAnswer, answers, presentation.questions]);

  const handleOptionSelect = useCallback((questionIndex: number, optionIndex: number) => {
    const question = presentation.questions[questionIndex];
    const option = question?.options[optionIndex];
    if (!question || !option || submitting) {
      return;
    }

    setActiveOptionIndex(optionIndex);
    if (question.style === 'check') {
      applyCheckAnswer(questionIndex, option.value);
      return;
    }

    applyRadioAnswer(questionIndex, option.value);
  }, [applyCheckAnswer, applyRadioAnswer, presentation.questions, submitting]);

  const handleQuestionTabKeyDown = useCallback((index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(Math.max(0, index - 1), { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      if (index >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(index + 1, { focus: 'tab' });
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activateQuestion, activeOptionIndex, activeQuestion?.options.length, focusOption, focusSubmitButton, presentation.questions.length]);

  const handleSubmitKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(presentation.questions.length - 1, { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void submitIfReady();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activateQuestion, activeOptionIndex, activeQuestion?.options.length, focusOption, presentation.questions.length, submitIfReady]);

  const handleOptionKeyDown = useCallback((optionIndex: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!activeQuestion) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = moveAskUserQuestionIndex(optionIndex, activeQuestion.options.length, 1);
      setActiveOptionIndex(nextIndex);
      focusOption(nextIndex);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = moveAskUserQuestionIndex(optionIndex, activeQuestion.options.length, -1);
      setActiveOptionIndex(nextIndex);
      focusOption(nextIndex);
      return;
    }

    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(Math.max(0, activeQuestionIndex - 1), { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      if (activeQuestionIndex >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(activeQuestionIndex + 1, { focus: 'tab' });
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOptionSelect(activeQuestionIndex, optionIndex);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activeQuestion, activeQuestionIndex, activateQuestion, focusOption, focusSubmitButton, handleOptionSelect, presentation.questions.length]);

  const handlePanelHotkeys = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || submitting || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const optionHotkeyIndex = resolveAskUserQuestionOptionHotkey(event.key);
    if (activeQuestion && optionHotkeyIndex >= 0 && optionHotkeyIndex < activeQuestion.options.length) {
      event.preventDefault();
      handleOptionSelect(activeQuestionIndex, optionHotkeyIndex);
      return;
    }

    const questionDirection = resolveAskUserQuestionNavigationHotkey(event.key);
    if (questionDirection === 0) {
      return;
    }

    event.preventDefault();
    if (questionDirection > 0) {
      if (activeQuestionIndex >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(activeQuestionIndex + 1, { focus: 'option' });
      }
      return;
    }

    activateQuestion(Math.max(0, activeQuestionIndex - 1), { focus: 'option' });
  }, [activeQuestion, activeQuestionIndex, activateQuestion, focusSubmitButton, handleOptionSelect, presentation.questions.length, submitting]);

  const statusTone = state.status === 'answered'
    ? 'success'
    : state.status === 'superseded'
      ? 'muted'
      : 'warning';

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3 py-2.5 text-[12px] transition-colors',
        state.status === 'pending' && 'border-warning/25 bg-warning/5',
      )}
      onKeyDownCapture={mode === 'inline' ? handlePanelHotkeys : undefined}
    >
      <div className="flex items-start gap-2.5">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">?</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-primary">
              {presentation.questions.length === 1 ? 'Question for you' : 'Questions for you'}
            </span>
            <Pill tone={statusTone}>{statusLabel}</Pill>
            {mode === 'inline' && state.status === 'pending' && presentation.questions.length > 1 && (
              <span className="text-[10px] uppercase tracking-[0.14em] text-dim/65">
                {answeredCount}/{presentation.questions.length} answered
              </span>
            )}
          </div>

          {state.status === 'pending' ? (
            mode === 'composer' ? (
              <>
                {presentation.details && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-secondary break-words">{presentation.details}</p>
                )}
                <div className="mt-2 space-y-1">
                  {presentation.questions.map((question, index) => (
                    <p key={question.id} className="flex items-start gap-2 text-[13px] leading-relaxed text-secondary">
                      <span className="mt-px w-4 shrink-0 text-[11px] font-mono text-dim">{index + 1}.</span>
                      <span className="min-w-0 break-words">{question.label}</span>
                    </p>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-dim">
                  Answer using the composer below. Type 1-9 to select, or send a normal message to skip.
                </p>
              </>
            ) : (
              <>
                {presentation.details && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-secondary break-words">{presentation.details}</p>
                )}

                <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label="Question navigation">
                  {presentation.questions.map((question, index) => {
                    const answered = (answers[question.id]?.length ?? 0) > 0;
                    const active = index === activeQuestionIndex;
                    return (
                      <button
                        key={question.id}
                        ref={(node) => { questionTabRefs.current[index] = node; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`ask-user-question-panel-${question.id}`}
                        onClick={() => activateQuestion(index)}
                        onKeyDown={(event) => handleQuestionTabKeyDown(index, event)}
                        className={cx(
                          'ui-action-button min-w-0 px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                          active
                            ? 'text-primary hover:text-primary'
                            : answered
                              ? 'text-secondary'
                              : 'text-dim',
                        )}
                      >
                        <span aria-hidden="true" className={cx('shrink-0 text-[11px]', answered ? 'text-success' : active ? 'text-accent' : 'text-dim/70')}>
                          {answered ? '✓' : active ? '•' : '○'}
                        </span>
                        <span className="truncate">{question.label}</span>
                      </button>
                    );
                  })}
                  {hasInteractiveOptions && onSubmit && (
                    <button
                      ref={submitButtonRef}
                      type="button"
                      disabled={!canSubmit || submitting}
                      onClick={() => { void submitIfReady(); }}
                      onKeyDown={handleSubmitKeyDown}
                      className={cx(
                        'ui-action-button px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                        canSubmit && !submitting ? 'text-accent' : 'text-dim',
                      )}
                    >
                      {submitLabel}
                    </button>
                  )}
                </div>

                {activeQuestion && (
                  <div id={`ask-user-question-panel-${activeQuestion.id}`} role="tabpanel" className="mt-2.5 border-t border-border-subtle pt-2.5">
                    {presentation.questions.length > 1 && (
                      <p className="text-[10px] uppercase tracking-[0.14em] text-dim/65">
                        Question {activeQuestionIndex + 1} of {presentation.questions.length}
                      </p>
                    )}
                    <p className="mt-0.5 text-[14px] font-medium text-primary break-words">{activeQuestion.label}</p>
                    {activeQuestion.details && (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-secondary break-words">{activeQuestion.details}</p>
                    )}

                    {activeQuestion.options.length > 0 ? (
                      <div
                        className="mt-0.5 -mx-0.5"
                        role={activeQuestion.style === 'check' ? 'group' : 'radiogroup'}
                        aria-label={activeQuestion.label}
                      >
                        {activeQuestion.options.map((option, optionIndex) => {
                          const selectedValues = answers[activeQuestion.id] ?? [];
                          const checked = selectedValues.includes(option.value);
                          const indicator = activeQuestion.style === 'check'
                            ? (checked ? '☑' : '☐')
                            : (checked ? '◉' : '◯');
                          return (
                            <button
                              key={`${activeQuestion.id}:${option.value}`}
                              ref={(node) => { optionRefs.current[optionIndex] = node; }}
                              type="button"
                              role={activeQuestion.style === 'check' ? 'checkbox' : 'radio'}
                              aria-checked={checked}
                              aria-label={option.label}
                              aria-keyshortcuts={optionIndex < 9 ? String(optionIndex + 1) : undefined}
                              onClick={() => handleOptionSelect(activeQuestionIndex, optionIndex)}
                              onKeyDown={(event) => handleOptionKeyDown(optionIndex, event)}
                              className={cx(
                                'ui-list-row -mx-0.5 w-full items-start gap-2 px-2.5 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                                checked ? 'ui-list-row-selected' : 'ui-list-row-hover',
                                submitting && 'cursor-default opacity-60',
                              )}
                            >
                              <span className={cx('mt-px w-3 shrink-0 text-[12px]', checked ? 'text-accent' : 'text-dim')} aria-hidden="true">
                                {indicator}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="ui-row-title block break-words text-[14px]">{option.label}</span>
                                {option.details && (
                                  <span className="ui-row-summary block break-words text-[13px]">{option.details}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">
                        Send a normal message in the composer to answer this question.
                      </p>
                    )}
                  </div>
                )}

                <p className="mt-2.5 text-[11px] text-dim">
                  1-9 selects · n/p switches questions · ↑/↓ moves · Esc exits · send a normal message to skip
                </p>
              </>
            )
          ) : answerPreview ? (
            <div className="mt-2.5 space-y-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-dim/65">Your reply</p>
              <p className="text-[12px] leading-relaxed text-secondary break-words">{answerPreview}</p>
            </div>
          ) : state.status === 'superseded' ? (
            <p className="mt-2.5 text-[11px] text-dim">A newer question was asked later in the conversation.</p>
          ) : null}
        </div>
      </div>
    </SurfacePanel>
  );
}

const MAX_VISIBLE_LINKED_RUNS = 5;


const TRACE_LINKED_RUN_VISIBLE_LIMIT = 4;
const INLINE_RUN_LOG_TAIL_LINES = 240;
const INLINE_RUN_POLL_INTERVAL_MS = 2200;

interface PolledRunSnapshotState {
  detail: DurableRunDetailResult | null;
  log: { path: string; log: string } | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

const EMPTY_POLLED_RUN_SNAPSHOT_STATE: PolledRunSnapshotState = {
  detail: null,
  log: null,
  loading: false,
  refreshing: false,
  error: null,
};

function buildInlineRunExpansionKey(clusterStartIndex: number, runId: string): string {
  return `${clusterStartIndex}:${runId}`;
}

function usePolledDurableRunSnapshot(
  runId: string | null,
  enabled: boolean,
  options?: {
    tail?: number;
    pollIntervalMs?: number;
  },
): PolledRunSnapshotState {
  const tail = options?.tail ?? INLINE_RUN_LOG_TAIL_LINES;
  const pollIntervalMs = options?.pollIntervalMs ?? INLINE_RUN_POLL_INTERVAL_MS;
  const [state, setState] = useState<PolledRunSnapshotState>(EMPTY_POLLED_RUN_SNAPSHOT_STATE);

  useEffect(() => {
    if (!runId) {
      setState(EMPTY_POLLED_RUN_SNAPSHOT_STATE);
      return;
    }

    setState((current) => (
      current.detail?.run.runId === runId
        ? current
        : {
            detail: null,
            log: null,
            loading: false,
            refreshing: false,
            error: null,
          }
    ));
  }, [runId]);

  useEffect(() => {
    if (!runId || !enabled) {
      setState((current) => ({ ...current, loading: false, refreshing: false }));
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const pollSnapshot = async (initial: boolean) => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;
      setState((current) => {
        const hasDetail = current.detail?.run.runId === runId;
        return {
          ...current,
          loading: initial && !hasDetail,
          refreshing: !initial && hasDetail,
          error: initial ? null : current.error,
        };
      });

      try {
        const [detail, log] = await Promise.all([
          api.durableRun(runId),
          api.durableRunLog(runId, tail),
        ]);

        if (cancelled) {
          return;
        }

        setState({
          detail,
          log,
          loading: false,
          refreshing: false,
          error: null,
        });
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Could not load run.';
          setState((current) => ({
            ...current,
            loading: false,
            refreshing: false,
            error: message,
          }));
        }
      } finally {
        inFlight = false;
      }
    };

    void pollSnapshot(true);
    const intervalId = window.setInterval(() => {
      void pollSnapshot(false);
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, pollIntervalMs, runId, tail]);

  return state;
}

function inferStatusFromLinkedRunDetail(detail: string | null | undefined): string | undefined {
  if (!detail) {
    return undefined;
  }

  const firstSegment = detail.split('·')[0]?.trim().toLowerCase();
  if (!firstSegment) {
    return undefined;
  }

  const knownStatus = ['queued', 'waiting', 'running', 'recovering', 'completed', 'failed', 'interrupted', 'cancelled'];
  return knownStatus.includes(firstSegment) ? firstSegment : undefined;
}

function describeInlineRunStatus(status: string | undefined): {
  text: string;
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
} {
  if (status === 'running') {
    return { text: 'running', tone: 'accent' };
  }
  if (status === 'recovering') {
    return { text: 'recovering', tone: 'warning' };
  }
  if (status === 'queued' || status === 'waiting') {
    return { text: status, tone: 'muted' };
  }
  if (status === 'completed') {
    return { text: 'completed', tone: 'success' };
  }
  if (status === 'failed' || status === 'interrupted') {
    return { text: status, tone: 'danger' };
  }
  if (status === 'cancelled') {
    return { text: 'cancelled', tone: 'muted' };
  }

  return {
    text: status?.trim().length ? status : 'linked',
    tone: 'muted',
  };
}

function collectTraceClusterLinkedRuns(blocks: TraceConversationBlock[]): LinkedRunPresentation[] {
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

function extractLinkedTaskSlugFromRunId(runId: string): string | null {
  const normalized = runId.trim();
  if (!normalized.startsWith('run-')) {
    return null;
  }

  const timestampIndex = normalized.search(/-\d{4}-\d{2}-\d{2}T/i);
  if (timestampIndex <= 4) {
    return null;
  }

  const taskSlug = normalized.slice(4, timestampIndex).trim();
  return taskSlug.length > 0 ? taskSlug : null;
}

function pickBestResolvedLinkedRunCandidate(candidates: DurableRunRecord[]): DurableRunRecord | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const leftActive = isRunActive(left) ? 1 : 0;
    const rightActive = isRunActive(right) ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    const leftAt = getRunMoment(left).at ?? '';
    const rightAt = getRunMoment(right).at ?? '';
    return rightAt.localeCompare(leftAt) || left.runId.localeCompare(right.runId);
  })[0] ?? null;
}

function resolveLinkedRunRecord(
  linkedRun: LinkedRunPresentation,
  runs: DurableRunRecord[] | null | undefined,
  lookups: RunPresentationLookups,
): DurableRunRecord | null {
  if (!runs || runs.length === 0) {
    return null;
  }

  const exactMatch = runs.find((candidate) => candidate.runId === linkedRun.runId);
  if (exactMatch) {
    return exactMatch;
  }

  const linkedTaskSlug = extractLinkedTaskSlugFromRunId(linkedRun.runId);
  if (linkedTaskSlug) {
    const linkedTaskSlugNormalized = normalizeRunLabel(linkedTaskSlug);
    const taskSlugMatches = runs.filter((candidate) => {
      const candidateTaskSlug = getRunTaskSlug(candidate);
      return candidateTaskSlug ? normalizeRunLabel(candidateTaskSlug) === linkedTaskSlugNormalized : false;
    });

    const taskSlugResolved = pickBestResolvedLinkedRunCandidate(taskSlugMatches);
    if (taskSlugResolved) {
      return taskSlugResolved;
    }
  }

  const linkedTitleNormalized = normalizeRunLabel(linkedRun.title);
  if (linkedTitleNormalized) {
    const titleMatches = runs.filter((candidate) => {
      const candidateHeadline = getRunHeadline(candidate, lookups);
      return normalizeRunLabel(candidateHeadline.title) === linkedTitleNormalized;
    });

    const titleResolved = pickBestResolvedLinkedRunCandidate(titleMatches);
    if (titleResolved) {
      return titleResolved;
    }
  }

  return null;
}

function InlineRunMetadataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto,minmax(0,1fr)] items-start gap-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-dim">{label}</span>
      <span className="break-words text-[11px] text-primary">{value}</span>
    </div>
  );
}

function InlineTraceRunCard({
  run,
  expanded,
  onToggle,
}: {
  run: LinkedRunPresentation;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { tasks, sessions, runs } = useAppData();
  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const resolvedRunRecord = useMemo(
    () => resolveLinkedRunRecord(run, runs?.runs, runLookups),
    [run, runLookups, runs?.runs],
  );
  const resolvedRunId = resolvedRunRecord?.runId ?? run.runId;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!expanded) {
      setIsVisible(true);
      return;
    }

    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(Boolean(entry?.isIntersecting));
      },
      {
        threshold: [0, 0.01, 0.2],
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);

  const snapshotRunId = expanded ? resolvedRunId : null;
  const pollEnabled = Boolean(snapshotRunId) && isVisible;
  const snapshot = usePolledDurableRunSnapshot(snapshotRunId, pollEnabled, {
    tail: INLINE_RUN_LOG_TAIL_LINES,
    pollIntervalMs: INLINE_RUN_POLL_INTERVAL_MS,
  });
  const detailRun = snapshot.detail?.run ?? resolvedRunRecord ?? null;
  const headline = detailRun ? getRunHeadline(detailRun, runLookups) : {
    title: run.title,
    summary: run.detail ?? 'Linked run',
  };
  const status = describeInlineRunStatus(detailRun?.status?.status ?? inferStatusFromLinkedRunDetail(run.detail));
  const runStreaming = isRunActive(detailRun);
  const outputLabel = detailRun?.manifest?.kind === 'raw-shell' ? 'Terminal output' : 'Run output';
  const outputPathLabel = snapshot.log?.path?.split('/').filter(Boolean).pop() ?? 'output.log';
  const hasOutput = Boolean(snapshot.log?.log && snapshot.log.log.length > 0);
  const emptyOutputLabel = runStreaming ? 'Waiting for output…' : '(empty)';
  const taskSlug = detailRun ? getRunTaskSlug(detailRun) : null;
  const targetPrompt = detailRun ? getRunTargetPrompt(detailRun) : null;
  const targetCommand = detailRun ? getRunTargetCommand(detailRun) : null;
  const targetCwd = detailRun ? getRunWorkingDirectory(detailRun) : null;
  const targetModel = detailRun ? getRunTargetModel(detailRun) : null;
  const targetProfile = detailRun ? getRunTargetProfile(detailRun) : null;
  const timeline = detailRun ? getRunTimeline(detailRun) : [];
  const latestTimelinePoint = timeline.at(-1);
  const resolvedFromMention = resolvedRunId !== run.runId;

  return (
    <div ref={cardRef} className="rounded-lg border border-border-subtle/70 bg-elevated/35 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full px-2.5 py-2 text-left hover:bg-elevated/70 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Pill tone={status.tone}>{status.text}</Pill>
              <span className="truncate text-[12px] font-medium text-primary">{headline.title}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-secondary">{headline.summary || run.detail || run.runId}</p>
          </div>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim">{expanded ? 'hide' : 'show'}</span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-border-subtle/70 bg-base/30 px-2.5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-dim">
            <span className={pollEnabled ? 'text-accent' : 'text-dim'}>{pollEnabled ? 'Polling live log' : 'Polling paused (off-screen)'}</span>
            {snapshot.refreshing && <span>· refreshing…</span>}
            {resolvedFromMention && (
              <>
                <span className="opacity-40">·</span>
                <span className="font-mono text-dim/80" title={`${run.runId} → ${resolvedRunId}`}>{resolvedRunId}</span>
              </>
            )}
            {latestTimelinePoint?.at && (
              <>
                <span className="opacity-40">·</span>
                <span>{latestTimelinePoint.label} {timeAgo(latestTimelinePoint.at)}</span>
              </>
            )}
          </div>

          {snapshot.loading && !detailRun && (
            <p className="text-[11px] text-dim animate-pulse">Loading run…</p>
          )}

          {snapshot.error && !detailRun && (
            <p className="text-[11px] text-danger/85">{snapshot.error}</p>
          )}

          {(detailRun || snapshot.log) && (
            <div className="rounded-md border border-border-subtle/70 bg-elevated/40 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle/60 px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-dim">
                <span className={cx('h-2 w-2 rounded-full', runStreaming ? 'bg-accent animate-pulse' : 'bg-border-default')} />
                <span>{outputLabel}</span>
                <span className="min-w-0 truncate font-mono normal-case tracking-normal text-dim/80">{outputPathLabel}</span>
              </div>
              <div className="max-h-56 overflow-auto px-2 py-2">
                {hasOutput ? (
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-primary">{snapshot.log?.log}</pre>
                ) : (
                  <p className="text-[11px] italic leading-relaxed text-dim">{emptyOutputLabel}</p>
                )}
              </div>
            </div>
          )}

          {detailRun && (
            <details className="ui-disclosure">
              <summary className="ui-disclosure-summary">
                <span>Details</span>
                <span className="ui-disclosure-meta">Command and runtime metadata</span>
              </summary>
              <div className="ui-disclosure-body">
                <div className="space-y-2.5">
                  {taskSlug && <InlineRunMetadataRow label="Task" value={taskSlug} />}
                  {targetPrompt && <InlineRunMetadataRow label="Prompt" value={<span className="whitespace-pre-wrap break-words">{targetPrompt}</span>} />}
                  {targetCommand && <InlineRunMetadataRow label="Command" value={<span className="font-mono">{targetCommand}</span>} />}
                  {targetCwd && <InlineRunMetadataRow label="Working dir" value={<span className="font-mono">{targetCwd}</span>} />}
                  {targetModel && <InlineRunMetadataRow label="Model" value={targetModel} />}
                  {targetProfile && <InlineRunMetadataRow label="Profile" value={targetProfile} />}
                  <InlineRunMetadataRow label="Run" value={detailRun.manifest?.kind ?? 'unknown'} />
                  <InlineRunMetadataRow label="Source" value={detailRun.manifest?.source?.type ?? 'unknown'} />
                  <InlineRunMetadataRow label="Attempt" value={String(detailRun.status?.activeAttempt ?? 0)} />
                  {detailRun.checkpoint?.step && <InlineRunMetadataRow label="Checkpoint" value={detailRun.checkpoint.step} />}
                  {snapshot.log?.path && <InlineRunMetadataRow label="Log" value={<span className="font-mono">{snapshot.log.path}</span>} />}
                </div>

                {(detailRun.status?.lastError || detailRun.problems.length > 0) && (
                  <div className="mt-3 space-y-2 border-t border-border-subtle/60 pt-2.5">
                    {detailRun.status?.lastError && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Last error</p>
                        <p className="whitespace-pre-wrap break-words text-[11px] text-danger/90">{detailRun.status.lastError}</p>
                      </div>
                    )}
                    {detailRun.problems.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Problems</p>
                        <div className="space-y-1 text-[11px] text-danger/90">
                          {detailRun.problems.map((problem) => (
                            <p key={problem}>• {problem}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          )}

          {snapshot.error && detailRun && (
            <p className="text-[11px] text-warning">{snapshot.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ToolBlock({
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
              ? (linkedRuns.scope === 'listed' ? 'listed run' : 'mentioned run')
              : (linkedRuns.scope === 'listed' ? 'listed runs' : 'mentioned runs')}
          </p>
          {hiddenRunCount > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-[10px] text-secondary/80">
              <span>
                {showAllRuns
                  ? `Showing all ${linkedRuns.runs.length} ${linkedRuns.scope === 'listed' ? 'runs returned by the tool.' : 'runs mentioned in this step.'}`
                  : `Showing ${MAX_VISIBLE_LINKED_RUNS} of ${linkedRuns.runs.length} ${linkedRuns.scope === 'listed' ? 'runs returned by the tool.' : 'runs mentioned in this step.'}`}
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

const ThinkingBlock = memo(function ThinkingBlock({ block, autoOpen }: { block: Extract<MessageBlock, { type: 'thinking' }>; autoOpen: boolean }) {
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

const SubagentBlock = memo(function SubagentBlock({ block }: { block: Extract<MessageBlock, { type: 'subagent' }> }) {
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

function traceSummaryTone(category: TraceClusterSummaryCategory) {
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

function TraceClusterBlock({
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

type InspectableImage = {
  alt: string;
  src: string;
  caption?: string;
  width?: number;
  height?: number;
};

function ImageInspectModal({
  image,
  onClose,
}: {
  image: InspectableImage;
  onClose: () => void;
}) {
  const label = image.caption?.trim() || image.alt.trim() || 'Conversation image';

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.72)', backdropFilter: 'blur(2px)', paddingTop: '1rem' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="ui-dialog-shell relative"
        style={{ width: 'min(96vw, 1440px)', height: 'min(94vh, 1040px)', maxHeight: 'calc(100vh - 2rem)', background: 'rgb(10 13 20 / 0.96)' }}
      >
        <div className="relative min-h-0 flex-1 bg-black/30 px-4 py-4 sm:px-6 sm:py-6">
          <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-3 sm:inset-x-6 sm:top-6">
            <div className="pointer-events-auto min-w-0 rounded-lg bg-black/45 px-3 py-1.5 backdrop-blur-sm" title={label}>
              <p className="truncate text-[12px] font-medium text-white/95">{label}</p>
              {image.width && image.height ? (
                <p className="mt-0.5 text-[10px] text-white/60">{image.width}×{image.height}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close image preview"
              className="pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/45 text-[16px] leading-none text-white/80 transition-colors hover:bg-black/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              ×
            </button>
          </div>
          <img
            src={image.src}
            alt={image.alt}
            className="h-full w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}

function ImagePreview({
  alt,
  src,
  caption,
  width,
  height,
  maxHeight,
  deferred = false,
  loading = false,
  onLoad,
  onInspect,
}: {
  alt: string;
  src?: string;
  caption?: string;
  width?: number;
  height?: number;
  maxHeight: number;
  deferred?: boolean;
  loading?: boolean;
  onLoad?: () => Promise<void> | void;
  onInspect?: (image: InspectableImage) => void;
}) {
  const inspectableImage = src
    ? {
        alt,
        src,
        caption,
        width,
        height,
      }
    : null;

  return (
    <SurfacePanel muted className="overflow-hidden">
      {inspectableImage ? (
        <button
          type="button"
          onClick={() => onInspect?.(inspectableImage)}
          className="block w-full cursor-zoom-in bg-elevated text-left transition-opacity hover:opacity-95"
          aria-label={`Inspect image: ${caption ?? alt}`}
          title="Inspect image"
        >
          <img
            src={inspectableImage.src}
            alt={alt}
            className="block w-full object-contain bg-elevated"
            style={{ maxHeight }}
          />
        </button>
      ) : (
        <div
          className="w-full bg-elevated flex flex-col items-center justify-center gap-2 px-4 py-5 text-dim"
          style={{ aspectRatio: `${width ?? 16} / ${height ?? 9}`, maxHeight }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span className="text-[11px] font-mono opacity-50">{alt}</span>
          {width && <span className="text-[10px] opacity-35">{width}×{height}</span>}
          {deferred && onLoad && (
            <button type="button" onClick={() => { void onLoad(); }} disabled={loading} className="ui-action-button text-[11px]">
              {loading ? 'Loading image…' : 'Load image'}
            </button>
          )}
        </div>
      )}
      {(caption || (!src && alt)) && (
        <div className="px-3 py-2 bg-surface border-t border-border-subtle">
          <p className="text-[11px] text-dim font-mono">{caption ?? alt}</p>
        </div>
      )}
    </SurfacePanel>
  );
}

const ImageBlock = memo(function ImageBlock({
  block,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onInspectImage,
}: {
  block: Extract<MessageBlock, { type: 'image' }>;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onInspectImage?: (image: InspectableImage) => void;
}) {
  const blockId = block.id?.trim();
  const canHydrate = Boolean(block.deferred && blockId && onHydrateMessage);
  const loading = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));

  return (
    <ImagePreview
      alt={block.alt}
      src={block.src}
      caption={block.caption}
      width={block.width}
      height={block.height}
      maxHeight={320}
      deferred={block.deferred}
      loading={loading}
      onLoad={canHydrate ? () => onHydrateMessage?.(blockId as string) : undefined}
      onInspect={onInspectImage}
    />
  );
});

function ResumeConversationAction({
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

const ErrorBlock = memo(function ErrorBlock({
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

interface ReplySelectionState {
  text: string;
  messageIndex: number;
  blockId?: string;
}

interface ReplySelectionContextMenuState {
  x: number;
  y: number;
  text: string;
  replySelection: ReplySelectionState | null;
}

function clearWindowSelection() {
  if (typeof window === 'undefined') {
    return;
  }

  window.getSelection()?.removeAllRanges();
}

function MsgActions({
  isUser,
  copyText,
  onFork,
  onRewind,
}: {
  isUser?: boolean;
  copyText?: string;
  onFork?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
}) {
  const [isForking, setIsForking] = useState(false);
  const [isRewinding, setIsRewinding] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyResetTimeoutRef = useRef<number | null>(null);
  const canCopy = !isUser && typeof copyText === 'string' && copyText.length > 0;

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

  function setTransientCopyState(nextState: 'copied' | 'failed') {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    setCopyState(nextState);
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimeoutRef.current = null;
    }, 1200);
  }

  async function handleFork() {
    if (!onFork || isForking) {
      return;
    }

    try {
      setIsForking(true);
      await onFork();
    } finally {
      setIsForking(false);
    }
  }

  async function handleRewind() {
    if (!onRewind || isRewinding) {
      return;
    }

    try {
      setIsRewinding(true);
      await onRewind();
    } finally {
      setIsRewinding(false);
    }
  }

  async function handleCopy() {
    if (!canCopy) {
      return;
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      setTransientCopyState('failed');
      return;
    }

    try {
      await navigator.clipboard.writeText(copyText);
      setTransientCopyState('copied');
    } catch {
      setTransientCopyState('failed');
    }
  }

  return (
    <div className={`flex items-center gap-0 opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 ${isUser ? 'justify-start' : 'justify-end'}`}>
      {canCopy && (
        <button
          type="button"
          onClick={() => { void handleCopy(); }}
          className={cx('ui-message-action-button', copyState === 'copied' && 'text-accent', copyState === 'failed' && 'text-danger')}
          title={copyState === 'failed' ? 'Copy to clipboard failed' : 'Copy this assistant message to the clipboard'}
        >
          {copyState === 'copied' ? '⎘ copied' : copyState === 'failed' ? '⎘ copy failed' : '⎘ copy'}
        </button>
      )}
      {onRewind && (
        <button
          type="button"
          onClick={() => { void handleRewind(); }}
          className={cx('ui-message-action-button', isRewinding && 'text-accent')}
          title={isUser ? 'Rewind into a new conversation from this prompt' : 'Rewind into a new conversation from the prompt that led here'}
          disabled={isRewinding}
        >
          {isRewinding ? '↩ rewinding…' : '↩ rewind'}
        </button>
      )}
      {!isUser && onFork && (
        <button
          type="button"
          onClick={() => { void handleFork(); }}
          className={cx('ui-message-action-button', isForking && 'text-accent')}
          title="Fork into a new conversation from here"
          disabled={isForking}
        >
          {isForking ? '⑂ forking…' : '⑂ fork'}
        </button>
      )}
    </div>
  );
}

// ── UserMessage ───────────────────────────────────────────────────────────────

const UserMessage = memo(function UserMessage({
  block,
  messageIndex,
  onRewindMessage,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenFilePath,
  onOpenCheckpoint,
  onInspectImage,
  layout = 'default',
}: {
  block: Extract<MessageBlock, { type: 'user' }>;
  messageIndex?: number;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onInspectImage?: (image: InspectableImage) => void;
  layout?: ChatViewLayout;
}) {
  const hasText = block.text.trim().length > 0;
  const skillBlock = hasText ? parseSkillBlock(block.text) : null;
  const handleRewind = useCallback(() => {
    if (typeof messageIndex !== 'number') {
      return;
    }

    return onRewindMessage?.(messageIndex);
  }, [messageIndex, onRewindMessage]);

  return (
    <div className="group flex flex-col items-end gap-1.5">
      <MsgActions isUser onRewind={onRewindMessage && typeof messageIndex === 'number' ? handleRewind : undefined} />
      <div className={layout === 'compact' ? 'max-w-[92%] sm:max-w-[88%]' : 'max-w-[86%]'}>
        <div className="ui-message-card-user space-y-2">
          {block.images && block.images.length > 0 && (
            <div className="space-y-2">
              {block.images.map((image, index) => {
                const blockId = block.id?.trim();
                const loading = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));
                const canHydrate = Boolean(image.deferred && blockId && onHydrateMessage);

                return (
                  <ImagePreview
                    key={`${image.caption ?? image.alt}-${index}`}
                    alt={image.alt}
                    src={image.src}
                    caption={image.caption}
                    width={image.width}
                    height={image.height}
                    maxHeight={280}
                    deferred={image.deferred}
                    loading={loading}
                    onLoad={canHydrate ? () => onHydrateMessage?.(blockId as string) : undefined}
                    onInspect={onInspectImage}
                  />
                );
              })}
            </div>
          )}
          {skillBlock ? (
            <div className="space-y-2 px-1.5 pb-0.5">
              <SkillInvocationCard skillBlock={skillBlock} className="ui-skill-invocation-user" onOpenFilePath={onOpenFilePath} />
              {skillBlock.userMessage && renderMarkdownText(skillBlock.userMessage, { onOpenFilePath, onOpenCheckpoint })}
            </div>
          ) : hasText ? (
            <div className="px-1.5 pb-0.5">
              {renderMarkdownText(block.text, { onOpenFilePath, onOpenCheckpoint })}
            </div>
          ) : null}
        </div>
        <p className="ui-message-meta mt-1 text-right pr-1">{timeAgo(block.ts)}</p>
      </div>
    </div>
  );
});

// ── AssistantMessage ──────────────────────────────────────────────────────────

const AssistantMessage = memo(function AssistantMessage({
  block,
  messageIndex,
  onForkMessage,
  onRewindMessage,
  onOpenFilePath,
  onOpenCheckpoint,
  onSelectionGesture,
  showCursor = false,
  layout = 'default',
}: {
  block: Extract<MessageBlock, { type: 'text' }>;
  messageIndex?: number;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
  showCursor?: boolean;
  layout?: ChatViewLayout;
}) {
  const shouldShowCursor = showCursor || !!block.streaming;
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);
  const handleRewind = useCallback(() => {
    if (typeof messageIndex !== 'number') {
      return;
    }

    return onRewindMessage?.(messageIndex);
  }, [messageIndex, onRewindMessage]);
  const handleFork = useCallback(() => {
    if (typeof messageIndex !== 'number') {
      return;
    }

    return onForkMessage?.(messageIndex);
  }, [messageIndex, onForkMessage]);

  return (
    <div className={cx('group flex items-start', layout === 'compact' ? 'gap-2.5' : 'gap-3')}>
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div
          {...replySelectionScopeProps}
          className="ui-message-card-assistant text-primary space-y-1"
        >
          {renderText(block.text, { onOpenFilePath, onOpenCheckpoint })}
          {shouldShowCursor && (
            <span
              className="inline-block w-[2px] h-[14px] bg-accent ml-0.5 rounded-sm"
              style={{ animation: 'cursorBlink 1s step-end infinite', verticalAlign: 'text-bottom' }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
          <span className="flex-1" />
          <MsgActions
            copyText={block.text}
            onRewind={onRewindMessage && typeof messageIndex === 'number' ? handleRewind : undefined}
            onFork={onForkMessage && typeof messageIndex === 'number' ? handleFork : undefined}
          />
        </div>
      </div>
    </div>
  );
});

const ContextMessage = memo(function ContextMessage({
  block,
  messageIndex,
  onOpenFilePath,
  onOpenCheckpoint,
  onSelectionGesture,
}: {
  block: Extract<MessageBlock, { type: 'context' }>;
  messageIndex?: number;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
}) {
  const label = formatInjectedContextLabel(block.customType);
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <div className="group">
      <div
        className="rounded-2xl rounded-l-md border-l-2 border-warning/35 bg-warning/5 px-3.5 py-3"
        data-context-type={block.customType ?? 'injected_context'}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-warning">{label}</p>
          <span className="flex-1" />
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
        </div>
        <div {...replySelectionScopeProps} className="pt-2 text-primary">
          {renderText(block.text, { onOpenFilePath, onOpenCheckpoint })}
        </div>
      </div>
    </div>
  );
});

function resolveCompactionSummaryLabel(title: string | undefined): string {
  const normalized = title?.trim();
  if (!normalized || normalized === 'Compaction summary') {
    return 'Context compacted';
  }

  return normalized;
}

function resolveCompactionSummaryDetail(title: string | undefined, extraDetail?: string): string {
  const baseDetail = (() => {
    switch (title?.trim()) {
      case 'Manual compaction':
        return 'You explicitly summarized older turns to shrink the active context window.';
      case 'Proactive compaction':
        return 'Older turns were summarized because the context window was getting full. The conversation is ready for the next turn.';
      case 'Overflow recovery compaction':
        return 'Older turns were summarized after a context overflow so the interrupted turn could retry automatically.';
      default:
        return 'Older turns were summarized to keep the active context window focused.';
    }
  })();

  const normalizedExtraDetail = extraDetail?.trim();
  return normalizedExtraDetail
    ? `${baseDetail} ${normalizedExtraDetail}`
    : baseDetail;
}

const SummaryMessage = memo(function SummaryMessage({
  block,
  messageIndex,
  onOpenFilePath,
  onOpenCheckpoint,
  onSelectionGesture,
}: {
  block: Extract<MessageBlock, { type: 'summary' }>;
  messageIndex?: number;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
}) {
  const summaryPresentation = (() => {
    switch (block.kind) {
      case 'compaction':
        return {
          label: resolveCompactionSummaryLabel(block.title),
          detail: resolveCompactionSummaryDetail(block.title, block.detail),
          accentClass: 'border-warning/25 bg-warning/5',
          markerClass: 'border-warning/25 bg-warning/10 text-warning',
          labelClass: 'text-warning',
          marker: '≋',
          shouldCollapse: true,
        };
      case 'related':
        return {
          label: block.title || 'Reused thread summaries',
          detail: block.detail?.trim() || 'Selected conversations were summarized and injected before this prompt so this thread could start with reused context.',
          accentClass: 'border-accent/20 bg-accent/5',
          markerClass: 'border-accent/25 bg-accent/10 text-accent',
          labelClass: 'text-accent',
          marker: '⟲',
          shouldCollapse: true,
        };
      default:
        return {
          label: block.title || 'Branch summary',
          detail: block.detail?.trim() || 'Context from another branch was summarized while preserving the current path.',
          accentClass: 'border-teal/20 bg-teal/5',
          markerClass: 'border-teal/25 bg-teal/10 text-teal',
          labelClass: 'text-teal',
          marker: '⑂',
          shouldCollapse: false,
        };
    }
  })();
  const previewLineCount = 4;
  const previewText = useMemo(
    () => (summaryPresentation.shouldCollapse ? buildSummaryPreview(block.text, previewLineCount) : ''),
    [block.text, summaryPresentation.shouldCollapse],
  );
  const [expanded, setExpanded] = useState(() => !summaryPresentation.shouldCollapse);
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <div className="group">
      <SurfacePanel muted className={cx('px-3.5 py-3.5', summaryPresentation.accentClass)} data-summary-kind={block.kind}>
        <div className="flex items-start gap-3">
          <div className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold', summaryPresentation.markerClass)}>
            <span aria-hidden="true">{summaryPresentation.marker}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cx('text-[10px] font-semibold uppercase tracking-[0.18em]', summaryPresentation.labelClass)}>{summaryPresentation.label}</p>
              <span className="flex-1" />
              <p className="ui-message-meta">{timeAgo(block.ts)}</p>
            </div>
            <div {...replySelectionScopeProps} className="space-y-3">
              <p className="text-[12px] leading-relaxed text-secondary">{summaryPresentation.detail}</p>
              <div className="text-primary">
                {summaryPresentation.shouldCollapse && !expanded ? (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-primary">{previewText}</p>
                ) : (
                  renderText(block.text, { onOpenFilePath, onOpenCheckpoint })
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {summaryPresentation.shouldCollapse && (
                <button
                  type="button"
                  className="ui-action-button text-[11px]"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(current => !current)}
                >
                  {expanded ? 'Hide summary' : 'Show summary'}
                </button>
              )}
              <span className="flex-1" />
              <MsgActions />
            </div>
          </div>
        </div>
      </SurfacePanel>
    </div>
  );
});

function StreamingIndicator({ label }: { label: string }) {
  return (
    <div className="flex gap-3 items-start" role="status" aria-live="polite">
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex items-center gap-2 pt-1 text-[12px] text-secondary italic">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse not-italic" />
        <span>{label}</span>
      </div>
    </div>
  );
}

type ChatViewPerformanceMode = 'default' | 'aggressive';
type ChatViewLayout = 'default' | 'compact';

const CHAT_VIEW_RENDERING_PROFILE: Record<ChatViewPerformanceMode, {
  contentVisibilityThreshold: number;
  windowingThreshold: number;
  windowingChunkSize: number;
  windowingOverscanChunks: number;
}> = {
  default: {
    contentVisibilityThreshold: 120,
    windowingThreshold: 240,
    windowingChunkSize: 80,
    windowingOverscanChunks: 2,
  },
  aggressive: {
    contentVisibilityThreshold: 48,
    windowingThreshold: 96,
    windowingChunkSize: 40,
    windowingOverscanChunks: 1,
  },
};

const CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT = 96;
const CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX = 12;

interface ChatRenderChunk {
  key: string;
  items: ChatRenderItem[];
  startItemIndex: number;
  endItemIndex: number;
  startMessageIndex: number;
  endMessageIndex: number;
  spanCount: number;
}

function getChatRenderItemAbsoluteRange(item: ChatRenderItem, messageIndexOffset: number): { start: number; end: number } {
  if (item.type === 'trace_cluster') {
    return {
      start: messageIndexOffset + item.startIndex,
      end: messageIndexOffset + item.endIndex,
    };
  }

  return {
    start: messageIndexOffset + item.index,
    end: messageIndexOffset + item.index,
  };
}

function buildChatRenderChunks(
  renderItems: ChatRenderItem[],
  messageIndexOffset: number,
  chunkSize: number,
): ChatRenderChunk[] {
  const chunks: ChatRenderChunk[] = [];

  for (let startItemIndex = 0; startItemIndex < renderItems.length; startItemIndex += chunkSize) {
    const items = renderItems.slice(startItemIndex, startItemIndex + chunkSize);
    const startRange = getChatRenderItemAbsoluteRange(items[0], messageIndexOffset);
    const endRange = getChatRenderItemAbsoluteRange(items[items.length - 1], messageIndexOffset);
    const spanCount = items.reduce((count, item) => {
      const range = getChatRenderItemAbsoluteRange(item, messageIndexOffset);
      return count + (range.end - range.start + 1);
    }, 0);
    chunks.push({
      key: `${startRange.start}-${endRange.end}-${items.length}`,
      items,
      startItemIndex,
      endItemIndex: startItemIndex + items.length - 1,
      startMessageIndex: startRange.start,
      endMessageIndex: endRange.end,
      spanCount,
    });
  }

  return chunks;
}

function resolveChunkIndexForOffset(offset: number, chunkTops: number[], chunkHeights: number[]): number {
  for (let index = 0; index < chunkTops.length; index += 1) {
    if (offset < chunkTops[index] + chunkHeights[index]) {
      return index;
    }
  }

  return Math.max(0, chunkTops.length - 1);
}

function formatWindowingCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return String(value);
}

function WindowedChatChunk({
  chunk,
  renderItem,
  onHeightChange,
  includeTrailingGap,
}: {
  chunk: ChatRenderChunk;
  renderItem: (item: ChatRenderItem, itemIndex: number) => ReactNode;
  onHeightChange: (chunkKey: string, height: number) => void;
  includeTrailingGap: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const measure = () => {
      onHeightChange(chunk.key, element.getBoundingClientRect().height);
    };

    measure();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null;
    observer?.observe(element);

    return () => {
      observer?.disconnect();
    };
  }, [chunk.key, includeTrailingGap, onHeightChange]);

  return (
    <div ref={ref} className={includeTrailingGap ? 'space-y-4 pb-4' : 'space-y-4'}>
      {chunk.items.map((item, itemIndex) => renderItem(item, chunk.startItemIndex + itemIndex))}
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

interface ChatViewProps {
  messages: MessageBlock[];
  messageIndexOffset?: number;
  scrollContainerRef?: RefObject<HTMLDivElement>;
  focusMessageIndex?: number | null;
  isStreaming?: boolean;
  isCompacting?: boolean;
  pendingStatusLabel?: string | null;
  performanceMode?: ChatViewPerformanceMode;
  layout?: ChatViewLayout;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onReplyToSelection?: (selection: { text: string; messageIndex: number; blockId?: string }) => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onSubmitAskUserQuestion?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  askUserQuestionDisplayMode?: 'inline' | 'composer';
  onResumeConversation?: () => Promise<void> | void;
  resumeConversationBusy?: boolean;
  resumeConversationTitle?: string | null;
  resumeConversationLabel?: string;
  windowingBadgeTopOffset?: number;
}

export const ChatView = memo(function ChatView({
  messages,
  messageIndexOffset = 0,
  scrollContainerRef,
  focusMessageIndex = null,
  isStreaming = false,
  isCompacting = false,
  pendingStatusLabel = null,
  performanceMode = 'default',
  layout = 'default',
  onForkMessage,
  onRewindMessage,
  onReplyToSelection,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenArtifact,
  activeArtifactId,
  onOpenCheckpoint,
  activeCheckpointId,
  onOpenFilePath,
  onSubmitAskUserQuestion,
  askUserQuestionDisplayMode = 'inline',
  onResumeConversation,
  resumeConversationBusy = false,
  resumeConversationTitle,
  resumeConversationLabel = 'continue',
  windowingBadgeTopOffset = CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX,
}: ChatViewProps) {
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const [expandedInlineRunKeys, setExpandedInlineRunKeys] = useState<ReadonlySet<string>>(() => new Set());
  const visibleInlineRunKeySet = useMemo(() => {
    const next = new Set<string>();

    for (const item of renderItems) {
      if (item.type !== 'trace_cluster') {
        continue;
      }

      for (const run of collectTraceClusterLinkedRuns(item.blocks)) {
        next.add(buildInlineRunExpansionKey(item.startIndex, run.runId));
      }
    }

    return next;
  }, [renderItems]);

  useEffect(() => {
    setExpandedInlineRunKeys((current) => {
      if (current.size === 0) {
        return current;
      }

      let changed = false;
      const next = new Set<string>();
      for (const inlineRunKey of current) {
        if (visibleInlineRunKeySet.has(inlineRunKey)) {
          next.add(inlineRunKey);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [visibleInlineRunKeySet]);

  const isInlineRunExpanded = useCallback(
    (inlineRunKey: string) => expandedInlineRunKeys.has(inlineRunKey),
    [expandedInlineRunKeys],
  );

  const toggleInlineRun = useCallback((inlineRunKey: string) => {
    setExpandedInlineRunKeys((current) => {
      const next = new Set(current);
      if (next.has(inlineRunKey)) {
        next.delete(inlineRunKey);
      } else {
        next.add(inlineRunKey);
      }
      return next;
    });
  }, []);

  const streamingStatusLabel = isCompacting
    ? 'Compacting context…'
    : pendingStatusLabel ?? getStreamingStatusLabel(messages, isStreaming);
  const renderingProfile = CHAT_VIEW_RENDERING_PROFILE[performanceMode];
  const lastBlock = messages[messages.length - 1];
  const showStreamingIndicator = !!streamingStatusLabel
    && (isCompacting || Boolean(pendingStatusLabel) || !lastBlock || lastBlock.type === 'user');
  const shouldUseContentVisibility = renderItems.length >= renderingProfile.contentVisibilityThreshold;
  const [contentVisibilityReady, setContentVisibilityReady] = useState(false);

  useEffect(() => {
    if (!shouldUseContentVisibility) {
      setContentVisibilityReady(false);
      return;
    }

    // Let the transcript fully lay out once before enabling content-visibility.
    // Initial scroll-to-bottom logic depends on an accurate scrollHeight.
    const animationFrame = window.requestAnimationFrame(() => {
      setContentVisibilityReady(true);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [shouldUseContentVisibility]);

  const contentVisibilityStyle = useMemo<React.CSSProperties | undefined>(
    () => (shouldUseContentVisibility && contentVisibilityReady ? { contentVisibility: 'auto' } : undefined),
    [contentVisibilityReady, shouldUseContentVisibility],
  );

  const shouldWindowTranscript = Boolean(scrollContainerRef) && renderItems.length >= renderingProfile.windowingThreshold;
  const renderChunks = useMemo(
    () => (shouldWindowTranscript ? buildChatRenderChunks(renderItems, messageIndexOffset, renderingProfile.windowingChunkSize) : []),
    [messageIndexOffset, renderItems, renderingProfile.windowingChunkSize, shouldWindowTranscript],
  );
  const [viewport, setViewport] = useState<{ scrollTop: number; clientHeight: number } | null>(null);
  const [chunkHeights, setChunkHeights] = useState<Record<string, number>>({});
  const [replySelection, setReplySelection] = useState<ReplySelectionState | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<ReplySelectionContextMenuState | null>(null);
  const [selectedImage, setSelectedImage] = useState<InspectableImage | null>(null);
  const replySelectionSyncFrameRef = useRef<number | null>(null);
  const replySelectionSyncTimeoutRefs = useRef<number[]>([]);
  const replySelectionClearTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedImage || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedImage]);

  useEffect(() => {
    if (!shouldWindowTranscript) {
      setViewport(null);
      return;
    }

    const scrollEl = scrollContainerRef?.current;
    if (!scrollEl) {
      return;
    }

    let frame = 0;
    const sync = () => {
      frame = 0;
      const next = {
        scrollTop: scrollEl.scrollTop,
        clientHeight: scrollEl.clientHeight,
      };
      setViewport((current) => (
        current && current.scrollTop === next.scrollTop && current.clientHeight === next.clientHeight
          ? current
          : next
      ));
    };
    const scheduleSync = () => {
      if (frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(sync);
    };

    scheduleSync();
    scrollEl.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);

    return () => {
      scrollEl.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [shouldWindowTranscript, scrollContainerRef]);

  const averageSpanHeight = useMemo(() => {
    const measurements = renderChunks
      .map((chunk) => ({ height: chunkHeights[chunk.key], spanCount: chunk.spanCount }))
      .filter((entry): entry is { height: number; spanCount: number } => typeof entry.height === 'number' && entry.height > 0 && entry.spanCount > 0);

    if (measurements.length === 0) {
      return CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
    }

    const totalHeight = measurements.reduce((sum, entry) => sum + entry.height, 0);
    const totalSpans = measurements.reduce((sum, entry) => sum + entry.spanCount, 0);
    return totalSpans > 0 ? totalHeight / totalSpans : CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
  }, [chunkHeights, renderChunks]);

  const chunkLayouts = useMemo(() => {
    let top = 0;
    return renderChunks.map((chunk) => {
      const estimatedHeight = Math.max(1, chunk.spanCount * averageSpanHeight);
      const height = chunkHeights[chunk.key] ?? estimatedHeight;
      const layout = {
        ...chunk,
        top,
        height,
        bottom: top + height,
      };
      top += height;
      return layout;
    });
  }, [averageSpanHeight, chunkHeights, renderChunks]);

  const updateChunkHeight = useCallback((chunkKey: string, height: number) => {
    setChunkHeights((current) => (current[chunkKey] === height ? current : { ...current, [chunkKey]: height }));
  }, []);

  const selectionContextMenuRef = useRef<HTMLDivElement | null>(null);

  const clearScheduledReplySelectionSync = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(replySelectionSyncFrameRef.current);
      replySelectionSyncFrameRef.current = null;
    }

    if (replySelectionSyncTimeoutRefs.current.length > 0) {
      for (const timeoutId of replySelectionSyncTimeoutRefs.current) {
        window.clearTimeout(timeoutId);
      }
      replySelectionSyncTimeoutRefs.current = [];
    }
  }, []);

  const cancelReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionClearTimeoutRef.current !== null) {
      window.clearTimeout(replySelectionClearTimeoutRef.current);
      replySelectionClearTimeoutRef.current = null;
    }
  }, []);

  const lastReplySelectionScopeRef = useRef<HTMLElement | null>(null);

  const closeSelectionContextMenu = useCallback(() => {
    setSelectionContextMenu((current) => (current ? null : current));
  }, []);

  const clearReplySelection = useCallback(() => {
    lastReplySelectionScopeRef.current = null;
    setReplySelection((current) => (current ? null : current));
  }, []);

  const scheduleReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      clearReplySelection();
      return;
    }

    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      return;
    }

    cancelReplySelectionClear();
    replySelectionClearTimeoutRef.current = window.setTimeout(() => {
      replySelectionClearTimeoutRef.current = null;
      clearReplySelection();
    }, 140);
  }, [cancelReplySelectionClear, clearReplySelection]);

  const resolveReplySelectionFromSelection = useCallback((scopeHint?: HTMLElement | null): { scopeElement: HTMLElement; selection: ReplySelectionState } | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const { startScope, endScope } = findSelectionReplyScopeElements(selection, range);
    const commonScope = findSelectionReplyScopeElement(range.commonAncestorContainer);
    const candidates = [scopeHint ?? null, startScope, endScope, commonScope, lastReplySelectionScopeRef.current]
      .filter((scope): scope is HTMLElement => Boolean(scope))
      .filter((scope, index, list) => list.indexOf(scope) === index);

    const matches = candidates.filter((scope) => readSelectedTextWithinElement(scope, range).length > 0);
    if (matches.length !== 1) {
      return null;
    }

    const scopeElement = matches[0];
    const text = readSelectedTextWithinElement(scopeElement, range);
    if (!text) {
      return null;
    }

    const messageIndex = Number.parseInt(scopeElement.dataset.messageIndex ?? '', 10);
    if (!Number.isFinite(messageIndex)) {
      return null;
    }

    return {
      scopeElement,
      selection: {
        text,
        messageIndex,
        blockId: scopeElement.dataset.blockId?.trim() || undefined,
      },
    };
  }, []);

  const applyResolvedReplySelection = useCallback((resolvedSelection: { scopeElement: HTMLElement; selection: ReplySelectionState } | null) => {
    if (!resolvedSelection) {
      scheduleReplySelectionClear();
      return;
    }

    cancelReplySelectionClear();
    lastReplySelectionScopeRef.current = resolvedSelection.scopeElement;

    setReplySelection((current) => {
      if (
        current
        && current.text === resolvedSelection.selection.text
        && current.messageIndex === resolvedSelection.selection.messageIndex
        && current.blockId === resolvedSelection.selection.blockId
      ) {
        return current;
      }

      return resolvedSelection.selection;
    });
  }, [cancelReplySelectionClear, scheduleReplySelectionClear]);

  const syncReplySelectionFromSelection = useCallback((scopeHint?: HTMLElement | null) => {
    applyResolvedReplySelection(resolveReplySelectionFromSelection(scopeHint));
  }, [applyResolvedReplySelection, resolveReplySelectionFromSelection]);

  const scheduleReplySelectionSync = useCallback((scopeElement?: HTMLElement | null) => {
    if (typeof window === 'undefined' || !onReplyToSelection) {
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
      clearReplySelection();
      return;
    }

    const sync = () => {
      syncReplySelectionFromSelection(scopeElement);
    };

    clearScheduledReplySelectionSync();

    replySelectionSyncFrameRef.current = window.requestAnimationFrame(() => {
      replySelectionSyncFrameRef.current = null;
      sync();
    });

    // Electron selection updates can land a little after the initial event, but
    // a permanent polling loop made large transcripts do steady background work.
    for (const delayMs of [40, 120, 240, 480]) {
      const timeoutId = window.setTimeout(() => {
        replySelectionSyncTimeoutRefs.current = replySelectionSyncTimeoutRefs.current.filter((currentId) => currentId !== timeoutId);
        sync();
      }, delayMs);
      replySelectionSyncTimeoutRefs.current.push(timeoutId);
    }
  }, [cancelReplySelectionClear, clearReplySelection, clearScheduledReplySelectionSync, onReplyToSelection, syncReplySelectionFromSelection]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !onReplyToSelection) {
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
      clearReplySelection();
      return;
    }

    const handleDocumentReplySelectionSync = () => {
      scheduleReplySelectionSync();
    };
    const handleFocus = () => {
      scheduleReplySelectionSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleReplySelectionSync();
      }
    };

    document.addEventListener('selectionchange', handleDocumentReplySelectionSync);
    document.addEventListener('mouseup', handleDocumentReplySelectionSync);
    document.addEventListener('pointerup', handleDocumentReplySelectionSync);
    document.addEventListener('keyup', handleDocumentReplySelectionSync);
    document.addEventListener('touchend', handleDocumentReplySelectionSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);

    return () => {
      document.removeEventListener('selectionchange', handleDocumentReplySelectionSync);
      document.removeEventListener('mouseup', handleDocumentReplySelectionSync);
      document.removeEventListener('pointerup', handleDocumentReplySelectionSync);
      document.removeEventListener('keyup', handleDocumentReplySelectionSync);
      document.removeEventListener('touchend', handleDocumentReplySelectionSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
    };
  }, [cancelReplySelectionClear, clearReplySelection, clearScheduledReplySelectionSync, onReplyToSelection, scheduleReplySelectionSync]);

  useEffect(() => {
    if (!replySelection || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const element = target instanceof HTMLElement ? target : target.parentElement;
      if (
        element?.closest('[data-selection-context-menu="true"]')
        || element?.closest('[data-selection-reply-scope="assistant-message"]')
      ) {
        return;
      }

      cancelReplySelectionClear();
      clearReplySelection();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      cancelReplySelectionClear();
      clearReplySelection();
      clearWindowSelection();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cancelReplySelectionClear, clearReplySelection, replySelection]);

  useEffect(() => {
    if (!selectionContextMenu || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const closeMenu = () => {
      closeSelectionContextMenu();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeMenu();
        return;
      }

      const element = target instanceof HTMLElement ? target : target.parentElement;
      if (element?.closest('[data-selection-context-menu="true"]')) {
        return;
      }

      closeMenu();
    };
    const handleSelectionChange = () => {
      const selectionText = window.getSelection()?.toString().trim() ?? '';
      if (!selectionText) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    const scrollEl = scrollContainerRef?.current;

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    scrollEl?.addEventListener('scroll', closeMenu, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
      scrollEl?.removeEventListener('scroll', closeMenu);
    };
  }, [closeSelectionContextMenu, scrollContainerRef, selectionContextMenu]);

  const handleReplySelection = useCallback(async (selectionOverride?: ReplySelectionState | null) => {
    const activeSelection = selectionOverride ?? replySelection;
    if (!activeSelection || !onReplyToSelection) {
      return;
    }

    closeSelectionContextMenu();
    clearReplySelection();
    clearWindowSelection();
    await onReplyToSelection({
      text: activeSelection.text,
      messageIndex: activeSelection.messageIndex,
      blockId: activeSelection.blockId,
    });
  }, [clearReplySelection, closeSelectionContextMenu, onReplyToSelection, replySelection]);

  const copySelectedTranscriptText = useCallback(async (text: string | null | undefined) => {
    const nextText = typeof text === 'string' ? text.trim() : '';

    closeSelectionContextMenu();
    if (!nextText || typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      clearReplySelection();
      clearWindowSelection();
      return;
    }

    try {
      await navigator.clipboard.writeText(nextText);
    } finally {
      clearWindowSelection();
      clearReplySelection();
    }
  }, [clearReplySelection, closeSelectionContextMenu]);

  const openDomSelectionContextMenu = useCallback((menuState: ReplySelectionContextMenuState) => {
    const menuWidth = 224;
    const menuItemCount = 1 + Number(Boolean(menuState.replySelection));
    const menuHeight = menuItemCount * 33 + (menuItemCount > 1 ? 11 : 10);
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const edgePadding = 12;

    setSelectionContextMenu({
      ...menuState,
      x: Math.max(edgePadding, Math.min(menuState.x, viewportWidth - menuWidth - edgePadding)),
      y: Math.max(edgePadding, Math.min(menuState.y, viewportHeight - menuHeight - edgePadding)),
    });
  }, []);

  const runSelectionContextMenuAction = useCallback(async (
    action: 'reply' | 'copy' | null,
    menuState?: ReplySelectionContextMenuState | null,
  ) => {
    const activeMenuState = menuState ?? selectionContextMenu;
    if (!action || !activeMenuState) {
      closeSelectionContextMenu();
      return;
    }

    switch (action) {
      case 'reply':
        await handleReplySelection(activeMenuState.replySelection);
        return;
      case 'copy':
        await copySelectedTranscriptText(activeMenuState.text);
        return;
    }
  }, [closeSelectionContextMenu, copySelectedTranscriptText, handleReplySelection, selectionContextMenu]);

  const renderChatItem = useCallback((item: ChatRenderItem, itemIndex: number) => {
    const isTailItem = itemIndex === renderItems.length - 1;

    if (item.type === 'trace_cluster') {
      const live = isStreaming && isTailItem;

      return (
        <div
          key={`trace-${messageIndexOffset + item.startIndex}-${messageIndexOffset + item.endIndex}`}
          data-chat-tail={isTailItem ? '1' : undefined}
          style={contentVisibilityStyle}
        >
          {item.blocks.map((_, offset) => {
            const absoluteIndex = messageIndexOffset + item.startIndex + offset;
            return <span key={`anchor-${absoluteIndex}`} id={`msg-${absoluteIndex}`} className="block h-0 overflow-hidden" aria-hidden />;
          })}
          <TraceClusterBlock
            clusterStartIndex={item.startIndex}
            blocks={item.blocks}
            summary={item.summary}
            live={live}
            onOpenArtifact={onOpenArtifact}
            activeArtifactId={activeArtifactId}
            onOpenCheckpoint={onOpenCheckpoint}
            activeCheckpointId={activeCheckpointId}
            onOpenFilePath={onOpenFilePath}
            onResume={isTailItem ? onResumeConversation : undefined}
            resumeBusy={resumeConversationBusy}
            resumeTitle={resumeConversationTitle}
            resumeLabel={resumeConversationLabel}
            isInlineRunExpanded={isInlineRunExpanded}
            onToggleInlineRun={toggleInlineRun}
          />
        </div>
      );
    }

    const block = item.block;
    const markerKind = block.type === 'user'
      ? 'user'
      : block.type === 'text' || (block.type === 'tool_use' && block.tool === 'ask_user_question')
        ? 'assistant'
        : undefined;
    const absoluteIndex = messageIndexOffset + item.index;
    const autoOpen = shouldAutoOpenConversationBlock(block, item.index, messages.length, isStreaming);
    const showStreamingCursor = isStreaming && block.type === 'text' && item.index === messages.length - 1;

    const el = (() => {
      switch (block.type) {
        case 'user':
          return (
            <UserMessage
              block={block}
              messageIndex={absoluteIndex}
              onRewindMessage={onRewindMessage}
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
              onOpenFilePath={onOpenFilePath}
              onOpenCheckpoint={onOpenCheckpoint}
              onInspectImage={setSelectedImage}
              layout={layout}
            />
          );
        case 'text':
          return (
            <AssistantMessage
              block={block}
              messageIndex={absoluteIndex}
              showCursor={showStreamingCursor}
              onRewindMessage={onRewindMessage}
              onForkMessage={onForkMessage}
              onOpenFilePath={onOpenFilePath}
              onOpenCheckpoint={onOpenCheckpoint}
              onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined}
              layout={layout}
            />
          );
        case 'context':
          return <ContextMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onOpenCheckpoint={onOpenCheckpoint} onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined} />;
        case 'summary':
          return <SummaryMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onOpenCheckpoint={onOpenCheckpoint} onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined} />;
        case 'thinking':
          return <ThinkingBlock block={block} autoOpen={autoOpen} />;
        case 'tool_use':
          return (
            <ToolBlock
              block={block}
              autoOpen={autoOpen}
              onOpenArtifact={onOpenArtifact}
              activeArtifactId={activeArtifactId}
              onOpenCheckpoint={onOpenCheckpoint}
              activeCheckpointId={activeCheckpointId}
              onOpenFilePath={onOpenFilePath}
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
              messages={messages}
              messageIndex={item.index}
              onSubmitAskUserQuestion={onSubmitAskUserQuestion}
              askUserQuestionDisplayMode={askUserQuestionDisplayMode}
            />
          );
        case 'subagent':
          return <SubagentBlock block={block} />;
        case 'image':
          return <ImageBlock block={block} onHydrateMessage={onHydrateMessage} hydratingMessageBlockIds={hydratingMessageBlockIds} onInspectImage={setSelectedImage} />;
        case 'error':
          return (
            <ErrorBlock
              block={block}
              messageIndex={absoluteIndex}
              onResume={isTailItem ? onResumeConversation : undefined}
              resumeBusy={resumeConversationBusy}
              resumeTitle={resumeConversationTitle}
              resumeLabel={resumeConversationLabel}
              onOpenFilePath={onOpenFilePath}
              onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined}
            />
          );
        default:
          return null;
      }
    })();

    return el ? (
      <div
        key={absoluteIndex}
        id={`msg-${absoluteIndex}`}
        data-message-index={absoluteIndex}
        data-chat-tail={isTailItem ? '1' : undefined}
        data-conversation-rail-kind={markerKind}
        style={contentVisibilityStyle}
      >
        {el}
      </div>
    ) : null;
  }, [activeArtifactId, activeCheckpointId, askUserQuestionDisplayMode, contentVisibilityStyle, hydratingMessageBlockIds, isInlineRunExpanded, isStreaming, layout, messageIndexOffset, messages, messages.length, onForkMessage, onHydrateMessage, onOpenArtifact, onOpenCheckpoint, onOpenFilePath, onReplyToSelection, onSubmitAskUserQuestion, onResumeConversation, onRewindMessage, renderItems.length, resumeConversationBusy, resumeConversationLabel, resumeConversationTitle, scheduleReplySelectionSync, toggleInlineRun]);

  const visibleChunkRange = useMemo(() => {
    if (!shouldWindowTranscript || chunkLayouts.length === 0) {
      return null;
    }

    const totalHeight = chunkLayouts[chunkLayouts.length - 1]?.bottom ?? 0;
    const tops = chunkLayouts.map((chunk) => chunk.top);
    const heights = chunkLayouts.map((chunk) => chunk.height);
    const focusChunkIndex = focusMessageIndex === null
      ? -1
      : chunkLayouts.findIndex((chunk) => focusMessageIndex >= chunk.startMessageIndex && focusMessageIndex <= chunk.endMessageIndex);

    let startChunkIndex: number;
    let endChunkIndex: number;

    if (viewport === null) {
      const anchorChunkIndex = focusChunkIndex >= 0 ? focusChunkIndex : chunkLayouts.length - 1;
      startChunkIndex = Math.max(0, anchorChunkIndex - renderingProfile.windowingOverscanChunks);
      endChunkIndex = Math.min(chunkLayouts.length - 1, anchorChunkIndex + renderingProfile.windowingOverscanChunks);
    } else {
      const viewportTop = Math.max(0, viewport.scrollTop);
      const viewportBottom = viewportTop + Math.max(1, viewport.clientHeight);
      const firstVisibleChunkIndex = resolveChunkIndexForOffset(viewportTop, tops, heights);
      const lastVisibleChunkIndex = resolveChunkIndexForOffset(viewportBottom, tops, heights);
      startChunkIndex = Math.max(0, firstVisibleChunkIndex - renderingProfile.windowingOverscanChunks);
      endChunkIndex = Math.min(chunkLayouts.length - 1, lastVisibleChunkIndex + renderingProfile.windowingOverscanChunks);

      if (focusChunkIndex >= 0 && (focusChunkIndex < startChunkIndex || focusChunkIndex > endChunkIndex)) {
        startChunkIndex = Math.max(0, focusChunkIndex - renderingProfile.windowingOverscanChunks);
        endChunkIndex = Math.min(chunkLayouts.length - 1, focusChunkIndex + renderingProfile.windowingOverscanChunks);
      }
    }

    const topSpacerHeight = startChunkIndex > 0 ? chunkLayouts[startChunkIndex].top : 0;
    const bottomSpacerHeight = endChunkIndex < chunkLayouts.length - 1
      ? Math.max(0, totalHeight - chunkLayouts[endChunkIndex].bottom)
      : 0;

    return {
      chunks: chunkLayouts.slice(startChunkIndex, endChunkIndex + 1),
      topSpacerHeight,
      bottomSpacerHeight,
    };
  }, [chunkLayouts, focusMessageIndex, renderingProfile.windowingOverscanChunks, shouldWindowTranscript, viewport]);

  const fullTranscript = (
    <div className="space-y-4">
      {renderItems.map((item, itemIndex) => renderChatItem(item, itemIndex))}
    </div>
  );

  const windowedTranscript = visibleChunkRange ? (
    <>
      {visibleChunkRange.topSpacerHeight > 0 && <div style={{ height: visibleChunkRange.topSpacerHeight }} aria-hidden />}
      {visibleChunkRange.chunks.map((chunk) => (
        <WindowedChatChunk
          key={chunk.key}
          chunk={chunk}
          renderItem={renderChatItem}
          onHeightChange={updateChunkHeight}
          includeTrailingGap={chunk.endItemIndex < renderItems.length - 1 || showStreamingIndicator}
        />
      ))}
      {visibleChunkRange.bottomSpacerHeight > 0 && <div style={{ height: visibleChunkRange.bottomSpacerHeight }} aria-hidden />}
    </>
  ) : fullTranscript;
  const mountedMessageCount = visibleChunkRange
    ? visibleChunkRange.chunks.reduce((sum, chunk) => sum + chunk.spanCount, 0)
    : messages.length;
  const handleTranscriptContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (typeof window === 'undefined') {
      return;
    }

    const scopeHint = event.target instanceof Node ? findSelectionReplyScopeElement(event.target) : null;
    const resolvedReplySelection = onReplyToSelection ? resolveReplySelectionFromSelection(scopeHint) : null;
    if (onReplyToSelection) {
      applyResolvedReplySelection(resolvedReplySelection);
    }

    const selectionText = resolvedReplySelection?.selection.text ?? window.getSelection()?.toString().trim() ?? '';
    if (!selectionText) {
      closeSelectionContextMenu();
      return;
    }

    event.preventDefault();
    const menuState: ReplySelectionContextMenuState = {
      x: event.clientX,
      y: event.clientY,
      text: selectionText,
      replySelection: resolvedReplySelection?.selection ?? null,
    };
    const desktopBridge = shouldUseNativeAppContextMenus() ? getDesktopBridge() : null;

    if (desktopBridge?.showSelectionContextMenu) {
      closeSelectionContextMenu();
      void desktopBridge.showSelectionContextMenu({
        x: menuState.x,
        y: menuState.y,
        canReply: Boolean(menuState.replySelection),
        canCopy: true,
      })
        .then(({ action }) => runSelectionContextMenuAction(action, menuState))
        .catch(() => {
          openDomSelectionContextMenu(menuState);
        });
      return;
    }

    openDomSelectionContextMenu(menuState);
  }, [applyResolvedReplySelection, closeSelectionContextMenu, onReplyToSelection, openDomSelectionContextMenu, resolveReplySelectionFromSelection, runSelectionContextMenuAction]);
  const mountedChunkCount = visibleChunkRange?.chunks.length ?? renderChunks.length;
  const selectionContextMenuItemClass = 'ui-context-menu-item';
  const windowingBadge = shouldWindowTranscript ? (
    <div
      className="sticky z-10 mb-3 flex justify-end pointer-events-none"
      style={{ top: `${Math.max(0, windowingBadgeTopOffset)}px` }}
    >
      <div className="inline-flex min-h-[2rem] items-center gap-2 rounded-lg border border-border-subtle bg-surface/88 px-3 py-1.5 text-[10px] text-secondary shadow-sm backdrop-blur">
        <span className="font-medium uppercase tracking-[0.16em] text-primary/85">windowing</span>
        <span>{formatWindowingCount(messages.length)} loaded</span>
        <span className="text-dim">·</span>
        <span>{formatWindowingCount(mountedMessageCount)} mounted</span>
        <span className="text-dim">·</span>
        <span>{mountedChunkCount}/{renderChunks.length} chunks</span>
      </div>
    </div>
  ) : null;
  return (
    <>
      <style>{`@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      <div
        data-chat-transcript-panel="1"
        onContextMenu={handleTranscriptContextMenu}
        className={layout === 'compact' ? 'px-2.5 py-3 sm:px-4 sm:py-4' : 'mx-auto w-full max-w-6xl pl-6 pr-10 pt-5 pb-24'}
      >
        {/* Bottom padding (pb-24) keeps the last message clear of the input area
            when the user is scrolled to the bottom and the textarea grows
            while typing (e.g. multi-line input). */}
        {windowingBadge}
        {shouldWindowTranscript ? windowedTranscript : fullTranscript}
        {showStreamingIndicator && (
          <div className={shouldWindowTranscript && visibleChunkRange?.chunks.length ? '' : 'mt-4'}>
            <StreamingIndicator label={streamingStatusLabel ?? 'Working…'} />
          </div>
        )}
      </div>
      {selectionContextMenu ? (
        <div
          ref={selectionContextMenuRef}
          className="ui-menu-shell ui-context-menu-shell fixed bottom-auto left-auto right-auto top-auto mb-0 min-w-[224px]"
          style={{ left: selectionContextMenu.x, top: selectionContextMenu.y }}
          role="menu"
          aria-label="Selected transcript text actions"
          data-selection-context-menu="true"
        >
          <div className="space-y-px">
            {selectionContextMenu.replySelection ? (
              <>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={() => { void runSelectionContextMenuAction('reply'); }}
                  className={selectionContextMenuItemClass}
                  role="menuitem"
                >
                  Reply with Selection
                </button>
                <div className="mx-1 my-1 h-px bg-border-subtle" role="separator" />
              </>
            ) : null}
            <button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => { void runSelectionContextMenuAction('copy'); }}
              className={selectionContextMenuItemClass}
              role="menuitem"
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
      {selectedImage && <ImageInspectModal image={selectedImage} onClose={() => setSelectedImage(null)} />}
    </>
  );
});

import { type PointerEventHandler, useEffect, useState } from 'react';

import { formatComposerActionLabel } from '../../conversation/conversationComposerPresentation';
import { cx } from '../ui';
import { ComposerActionIcon } from './ConversationComposerChrome';

export type ConversationComposerSubmitLabel = 'Send' | 'Steer' | 'Follow up' | 'Parallel';

export function ConversationComposerActions({
  dictationState,
  dictationLevelSamples,
  dictationStartedAt,
  composerDisabled,
  streamIsStreaming,
  conversationNeedsTakeover,
  composerHasContent,
  composerShowsQuestionSubmit,
  composerQuestionCanSubmit,
  composerQuestionRemainingCount,
  composerQuestionSubmitting,
  composerSubmitLabel,
  composerAltHeld,
  composerParallelHeld,
  onDictationPointerDown,
  onDictationPointerUp,
  onDictationPointerCancel,
  onSubmitComposerQuestion,
  onSubmitComposerActionForModifiers,
  onAbortStream,
}: {
  dictationState: 'idle' | 'recording' | 'transcribing';
  dictationLevelSamples?: number[];
  dictationStartedAt?: number | null;
  composerDisabled: boolean;
  streamIsStreaming: boolean;
  conversationNeedsTakeover: boolean;
  composerHasContent: boolean;
  composerShowsQuestionSubmit: boolean;
  composerQuestionCanSubmit: boolean;
  composerQuestionRemainingCount: number;
  composerQuestionSubmitting: boolean;
  composerSubmitLabel: ConversationComposerSubmitLabel;
  composerAltHeld: boolean;
  composerParallelHeld: boolean;
  onDictationPointerDown: PointerEventHandler<HTMLButtonElement>;
  onDictationPointerUp: PointerEventHandler<HTMLButtonElement>;
  onDictationPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onSubmitComposerQuestion: () => void;
  onSubmitComposerActionForModifiers: (altKeyHeld: boolean, parallelKeyHeld: boolean) => void;
  onAbortStream: () => void;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {dictationState === 'recording' ? (
        <DictationWaveform samples={dictationLevelSamples ?? []} startedAt={dictationStartedAt ?? null} />
      ) : null}
      <button
        type="button"
        onPointerDown={onDictationPointerDown}
        onPointerUp={onDictationPointerUp}
        onPointerCancel={onDictationPointerCancel}
        disabled={composerDisabled || dictationState === 'transcribing'}
        className={cx(
          'flex h-8 w-8 shrink-0 touch-none items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-40',
          dictationState === 'recording'
            ? 'bg-danger/15 text-danger hover:bg-danger/25'
            : dictationState === 'transcribing'
              ? 'bg-elevated text-accent'
              : 'text-secondary hover:bg-elevated/60 hover:text-primary',
        )}
        title={
          dictationState === 'recording'
            ? 'Recording dictation — release after a hold to stop, or click again to toggle off'
            : dictationState === 'transcribing'
              ? 'Transcribing…'
              : 'Dictate. Hold to record while held, or click to toggle.'
        }
        aria-label={dictationState === 'recording' ? 'Stop dictation' : 'Start dictation'}
      >
        {dictationState === 'transcribing' ? (
          <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
            <path d="M19 11a7 7 0 0 1-14 0" />
            <path d="M12 18v3" />
            <path d="M8 21h8" />
          </svg>
        )}
      </button>
      {streamIsStreaming ? (
        <>
          {composerHasContent ? (
            <button
              type="button"
              onClick={(event) => {
                onSubmitComposerActionForModifiers(composerAltHeld || event.altKey, composerParallelHeld || event.ctrlKey || event.metaKey);
              }}
              disabled={composerDisabled}
              className={cx(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-40',
                composerSubmitLabel === 'Parallel'
                  ? 'bg-steel/12 text-steel hover:bg-steel/20'
                  : composerSubmitLabel === 'Follow up'
                    ? 'bg-elevated text-primary hover:bg-elevated/80'
                    : 'bg-warning/15 text-warning hover:bg-warning/25',
              )}
              title={composerSubmitLabel === 'Parallel' ? 'Parallel (Ctrl/⌘+Enter)' : composerSubmitLabel}
              aria-label={composerSubmitLabel}
            >
              {composerSubmitLabel !== 'Send' ? (
                <>
                  <ComposerActionIcon label={composerSubmitLabel} className="shrink-0" />
                  <span>{formatComposerActionLabel(composerSubmitLabel)}</span>
                </>
              ) : null}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAbortStream}
            disabled={conversationNeedsTakeover}
            className={cx(
              'group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-60',
              'bg-danger/15 text-danger hover:bg-danger/25',
            )}
            title={conversationNeedsTakeover ? 'Take over this conversation before stopping' : 'Stop'}
            aria-label="Stop"
          >
            <span
              className="absolute inset-0 rounded-full bg-danger/10 opacity-0 transition-opacity group-hover:opacity-0"
              aria-hidden="true"
            >
              <span className="absolute inset-1.5 rounded-full bg-danger/15 animate-ping" />
            </span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.2" />
            </svg>
          </button>
        </>
      ) : composerShowsQuestionSubmit ? (
        <button
          type="button"
          onClick={onSubmitComposerQuestion}
          disabled={composerDisabled || !composerQuestionCanSubmit || composerQuestionSubmitting}
          className={cx(
            'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors disabled:cursor-default',
            composerQuestionCanSubmit && !composerQuestionSubmitting ? 'bg-accent text-white hover:bg-accent/90' : 'bg-elevated text-dim',
          )}
          title={
            composerQuestionCanSubmit
              ? 'Submit answers'
              : `Answer ${composerQuestionRemainingCount} more ${composerQuestionRemainingCount === 1 ? 'question' : 'questions'} to submit`
          }
          aria-label="Submit answers"
        >
          <span aria-hidden="true">✓</span>
          <span>
            {composerQuestionSubmitting ? 'Submitting…' : composerQuestionCanSubmit ? 'Submit' : `${composerQuestionRemainingCount} left`}
          </span>
        </button>
      ) : composerHasContent ? (
        <button
          type="button"
          onClick={(event) => {
            onSubmitComposerActionForModifiers(composerAltHeld || event.altKey, composerParallelHeld || event.ctrlKey || event.metaKey);
          }}
          disabled={composerDisabled}
          className={cx(
            'flex shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-40',
            composerSubmitLabel === 'Send' ? 'h-8 w-8 bg-accent text-white hover:bg-accent/90' : 'h-9 gap-1.5 px-3 text-[11px] font-medium',
            composerSubmitLabel === 'Steer'
              ? 'bg-warning/15 text-warning hover:bg-warning/25'
              : composerSubmitLabel === 'Follow up'
                ? 'bg-elevated text-primary hover:bg-elevated/80'
                : composerSubmitLabel === 'Parallel'
                  ? 'bg-steel/12 text-steel hover:bg-steel/20'
                  : '',
          )}
          title={composerSubmitLabel === 'Parallel' ? 'Parallel (Ctrl/⌘+Enter)' : composerSubmitLabel}
          aria-label={composerSubmitLabel}
        >
          {composerSubmitLabel === 'Send' ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          ) : (
            <>
              <ComposerActionIcon label={composerSubmitLabel} className="shrink-0" />
              <span>{formatComposerActionLabel(composerSubmitLabel)}</span>
            </>
          )}
        </button>
      ) : (
        <button
          type="button"
          disabled={true}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-default/70 bg-surface/65 text-dim/70"
          title="Send"
          aria-label="Send"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

function formatDictationElapsed(startedAt: number | null, now: number): string {
  if (!startedAt) {
    return '0:00';
  }

  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function DictationWaveform({ samples, startedAt }: { samples: number[]; startedAt: number | null }) {
  const [now, setNow] = useState(() => performance.now());
  const visibleSamples = samples.length > 0 ? samples : Array.from({ length: 44 }, () => 0.04);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(performance.now());
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex min-w-[9rem] max-w-[16rem] items-center gap-2 text-secondary" aria-label="Recording dictation">
      <div className="flex min-w-0 flex-1 items-center justify-end gap-[2px]" aria-hidden="true">
        {visibleSamples.slice(-52).map((sample, index) => {
          const height = Math.max(2, Math.round(3 + sample * 22));
          const opacity = 0.28 + Math.min(0.72, sample * 1.4);
          return <span key={index} className="w-[2px] shrink-0 rounded-full bg-current" style={{ height: `${height}px`, opacity }} />;
        })}
      </div>
      <span className="shrink-0 font-mono text-[12px] text-secondary">{formatDictationElapsed(startedAt, now)}</span>
    </div>
  );
}

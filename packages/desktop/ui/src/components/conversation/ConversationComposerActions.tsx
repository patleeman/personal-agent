import { type PointerEventHandler, useEffect, useMemo, useRef, useState } from 'react';

import { formatComposerActionLabel } from '../../conversation/conversationComposerPresentation';
import { createNativeExtensionClient } from '../../extensions/nativePaClient';
import { useExtensionRegistry } from '../../extensions/useExtensionRegistry';
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
  const { toolbarActions } = useExtensionRegistry();
  const visibleToolbarActions = useMemo(
    () =>
      toolbarActions.filter((action) => {
        const expr = action.when;
        if (!expr) return true;
        const clauses = expr.split(/\s*&&\s*/).filter(Boolean);
        for (const clause of clauses) {
          const trimmed = clause.trim();
          if (trimmed === 'composerHasContent' && !composerHasContent) return false;
          if (trimmed === 'streamIsStreaming' && !streamIsStreaming) return false;
          if (trimmed === '!streamIsStreaming' && streamIsStreaming) return false;
        }
        return true;
      }),
    [toolbarActions, composerHasContent, streamIsStreaming],
  );

  const paClientByExtension = useRef<Map<string, ReturnType<typeof createNativeExtensionClient>>>(new Map());
  function getPaClient(extensionId: string) {
    let client = paClientByExtension.current.get(extensionId);
    if (!client) {
      client = createNativeExtensionClient(extensionId);
      paClientByExtension.current.set(extensionId, client);
    }
    return client;
  }

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {visibleToolbarActions.length > 0 && (
        <div className="flex items-center gap-0.5 mr-1">
          {visibleToolbarActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                void getPaClient(action.extensionId).extension.invoke(action.action, {});
              }}
              disabled={composerDisabled}
              className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-surface/45 hover:text-primary disabled:opacity-40"
              title={action.title}
              aria-label={action.title}
            >
              <ToolbarActionIcon icon={action.icon} />
            </button>
          ))}
        </div>
      )}
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

function ToolbarActionIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'app':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>;
    case 'automation':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>;
    case 'browser':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>;
    case 'database':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>;
    case 'diff':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6h8" /><path d="M8 12h6" /><path d="M8 18h4" /></svg>;
    case 'file':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>;
    case 'gear':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
    case 'graph':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><path d="M6 9v3a3 3 0 0 0 3 3h3" /><path d="M18 9v3a3 3 0 0 1-3 3h-3" /></svg>;
    case 'kanban':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="4" height="18" rx="1" /><rect x="10" y="3" width="4" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></svg>;
    case 'play':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" /></svg>;
    case 'sparkle':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c.5 2.5 2.5 4.5 5 5-2.5.5-4.5 2.5-5 5-.5-2.5-2.5-4.5-5-5 2.5-.5 4.5-2.5 5-5z" /><path d="M19 17c-.7 1.2-2 2-3.5 2 1.5.7 2.5 2 2.5 3.5.7-1.5 2-2.5 3.5-2.5-1.5-.7-2.5-2-2.5-3.5z" /></svg>;
    case 'terminal':
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
    default:
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>;
  }
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

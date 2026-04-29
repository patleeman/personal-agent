import { cx } from '../ui';
import type { DeferredResumeSummary, DurableRunRecord } from '../../shared/types';
import {
  formatConversationBackgroundRunStatusLabel,
} from '../../conversation/conversationPageState';
import {
  describeDeferredResumeStatus,
  formatDeferredResumeWhen,
} from '../../deferred-resume/deferredResumeIndicator';
import { getRunHeadline, type RunPresentationLookups } from '../../automation/runPresentation';

export function ConversationActivityShelf({
  backgroundRuns,
  backgroundRunIndicatorText,
  showBackgroundRunDetails,
  runLookups,
  onToggleBackgroundRunDetails,
  deferredResumes,
  deferredResumeIndicatorText,
  deferredResumeNowMs,
  hasReadyDeferredResumes,
  isLiveSession,
  deferredResumesBusy,
  showDeferredResumeDetails,
  onContinueDeferredResumesNow,
  onToggleDeferredResumeDetails,
  onFireDeferredResumeNow,
  onCancelDeferredResume,
}: {
  backgroundRuns: DurableRunRecord[];
  backgroundRunIndicatorText: string;
  showBackgroundRunDetails: boolean;
  runLookups: RunPresentationLookups;
  onToggleBackgroundRunDetails: () => void;
  deferredResumes: DeferredResumeSummary[];
  deferredResumeIndicatorText: string;
  deferredResumeNowMs: number;
  hasReadyDeferredResumes: boolean;
  isLiveSession: boolean;
  deferredResumesBusy: boolean;
  showDeferredResumeDetails: boolean;
  onContinueDeferredResumesNow: () => void;
  onToggleDeferredResumeDetails: () => void;
  onFireDeferredResumeNow: (resumeId: string) => void;
  onCancelDeferredResume: (resumeId: string) => void;
}) {
  return (
    <>
      {backgroundRuns.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 text-[11px]">
            <div className="min-w-0 flex items-center gap-2">
              <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-accent" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
              </span>
              <span className="shrink-0 text-secondary">Background Work</span>
              <span className="truncate text-dim">{backgroundRunIndicatorText}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[11px]">
              <button
                type="button"
                onClick={onToggleBackgroundRunDetails}
                className="text-dim transition-colors hover:text-primary"
              >
                {showBackgroundRunDetails ? 'hide' : 'details'}
              </button>
            </div>
          </div>

          {showBackgroundRunDetails && (
            <div className="flex flex-col gap-2 border-b border-border-subtle px-3 pt-2.5 pb-2.5">
              {backgroundRuns.map((run) => {
                const headline = getRunHeadline(run, runLookups);
                const summary = headline.summary === 'Agent task' || headline.summary === 'Shell command'
                  ? `Run ${run.runId}`
                  : headline.summary;
                const statusLabel = formatConversationBackgroundRunStatusLabel(run.status?.status);
                const statusClass = run.status?.status === 'recovering'
                  ? 'text-warning'
                  : run.status?.status === 'queued' || run.status?.status === 'waiting'
                    ? 'text-dim'
                    : 'text-accent';

                return (
                  <div key={run.runId} className="flex items-start gap-3 text-[12px]">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cx('shrink-0 font-medium', statusClass)}>{statusLabel}</span>
                        <span className="truncate text-primary">{headline.title}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-dim">{summary}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {deferredResumes.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 text-[11px]">
            <div className="min-w-0 flex items-center gap-2">
              <span className={cx(
                'shrink-0',
                hasReadyDeferredResumes ? 'text-warning' : 'text-dim',
              )}>
                ⏰
              </span>
              <span className="shrink-0 text-secondary">Wakeups</span>
              <span className="truncate text-dim">{deferredResumeIndicatorText}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[11px]">
              {hasReadyDeferredResumes && !isLiveSession && (
                <button
                  type="button"
                  onClick={onContinueDeferredResumesNow}
                  className="text-accent transition-colors hover:text-accent/80"
                >
                  continue now
                </button>
              )}
              {deferredResumesBusy && <span className="text-dim">updating…</span>}
              <button
                type="button"
                onClick={onToggleDeferredResumeDetails}
                className="text-dim transition-colors hover:text-primary"
              >
                {showDeferredResumeDetails ? 'hide' : 'details'}
              </button>
            </div>
          </div>

          {showDeferredResumeDetails && (
            <div className="flex flex-col gap-2 border-b border-border-subtle px-3 pt-2.5 pb-2.5">
              {deferredResumes.map((resume) => (
                <div key={resume.id} className="flex items-start gap-3 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cx(
                        'shrink-0 font-medium',
                        resume.status === 'ready' ? 'text-warning' : 'text-secondary',
                      )}>
                        {describeDeferredResumeStatus(resume, deferredResumeNowMs)}
                      </span>
                      <span className="truncate text-primary">{resume.title ?? resume.prompt}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-dim">
                      {resume.kind === 'reminder' ? 'Reminder' : resume.kind === 'task-callback' ? 'Task callback' : 'Wakeup'}
                      {resume.behavior === 'followUp' ? ' · follow-up' : ''} · {resume.status === 'ready' ? 'Ready' : 'Due'} {formatDeferredResumeWhen(resume)}
                      {resume.attempts > 0 ? ` · retries ${resume.attempts}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {resume.status === 'scheduled' && (
                      <button
                        type="button"
                        onClick={() => { onFireDeferredResumeNow(resume.id); }}
                        className="text-[11px] text-accent transition-colors hover:text-accent/80 disabled:opacity-40"
                        disabled={deferredResumesBusy}
                      >
                        fire now
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { onCancelDeferredResume(resume.id); }}
                      className="text-[11px] text-dim transition-colors hover:text-danger disabled:opacity-40"
                      disabled={deferredResumesBusy}
                    >
                      cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

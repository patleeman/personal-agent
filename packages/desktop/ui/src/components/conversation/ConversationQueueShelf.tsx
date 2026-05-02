import { Pill } from '../ui';
import type { ParallelPromptPreview } from '../../shared/types';
import {
  formatParallelJobContextSummary,
  formatParallelJobStatusLabel,
  formatQueuedPromptImageSummary,
  formatQueuedPromptShelfText,
  truncateConversationShelfText,
} from '../../conversation/conversationComposerPresentation';

export interface ConversationPendingQueueItem {
  id: string;
  text: string;
  imageCount: number;
  restorable: boolean;
  type: 'steer' | 'followUp';
  queueIndex: number;
}

export function ConversationQueueShelf({
  pendingQueue,
  parallelJobs,
  conversationNeedsTakeover,
  onRestoreQueuedPrompt,
  onManageParallelJob,
  onOpenConversation,
}: {
  pendingQueue: ConversationPendingQueueItem[];
  parallelJobs: ParallelPromptPreview[];
  conversationNeedsTakeover: boolean;
  onRestoreQueuedPrompt: (behavior: 'steer' | 'followUp', queueIndex: number, previewId?: string) => void;
  onManageParallelJob: (jobId: string, action: 'importNow' | 'skip' | 'cancel') => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  return (
    <>
      {pendingQueue.length > 0 && (
        <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle flex flex-col gap-1.5">
          <span className="ui-section-label">Queued</span>
          {pendingQueue.map((message) => (
            <div key={message.id} className="grid min-w-0 grid-cols-[auto,minmax(0,1fr),auto] items-start gap-x-2 gap-y-1">
              <Pill tone={message.type === 'steer' ? 'warning' : 'teal'} className="mt-0.5">
                {message.type === 'steer' ? '⤵ steer' : '↷ followup'}
              </Pill>
              <div className="min-w-0">
                <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-secondary">
                  {truncateConversationShelfText(formatQueuedPromptShelfText(message.text, message.imageCount))}
                </p>
                {formatQueuedPromptImageSummary(message.imageCount) ? (
                  <p className="mt-0.5 text-[11px] text-dim">{formatQueuedPromptImageSummary(message.imageCount)}</p>
                ) : null}
              </div>
              {message.restorable !== false ? (
                <button
                  type="button"
                  onClick={() => { onRestoreQueuedPrompt(message.type, message.queueIndex, message.id); }}
                  disabled={conversationNeedsTakeover}
                  className="shrink-0 pt-0.5 text-[11px] text-dim transition-colors hover:text-primary disabled:cursor-default disabled:opacity-50"
                  title={conversationNeedsTakeover ? 'Take over this conversation before restoring queued prompts' : 'Restore this queued prompt to the composer'}
                  aria-label="Restore queued prompt to the composer"
                >
                  restore
                </button>
              ) : (
                <span className="shrink-0 pt-0.5 text-[11px] text-dim/70">remote</span>
              )}
            </div>
          ))}
        </div>
      )}

      {parallelJobs.length > 0 && (
        <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle flex flex-col gap-1.5">
          <span className="ui-section-label">Parallel</span>
          {parallelJobs.map((job) => {
            const contextSummary = formatParallelJobContextSummary({
              imageCount: job.imageCount,
              attachmentRefs: job.attachmentRefs,
            });
            const attachmentSummary = job.attachmentRefs.length > 0
              ? truncateConversationShelfText(job.attachmentRefs.join(', '), { maxChars: 140, maxLines: 2 })
              : null;
            const touchedFileSummary = job.touchedFiles.length > 0
              ? truncateConversationShelfText(job.touchedFiles.join(', '), { maxChars: 180, maxLines: 2 })
              : null;
            const parentTouchedSummary = job.parentTouchedFiles.length > 0
              ? truncateConversationShelfText(job.parentTouchedFiles.join(', '), { maxChars: 180, maxLines: 2 })
              : null;
            const overlapSummary = job.overlapFiles.length > 0
              ? truncateConversationShelfText(job.overlapFiles.join(', '), { maxChars: 180, maxLines: 2 })
              : null;
            const sideEffectSummary = job.sideEffects.length > 0
              ? truncateConversationShelfText(job.sideEffects.join(' · '), { maxChars: 180, maxLines: 3 })
              : null;

            return (
              <div key={job.id} className="grid min-w-0 grid-cols-[auto,minmax(0,1fr),auto] items-start gap-x-2 gap-y-1">
                <Pill tone={job.status === 'failed' ? 'danger' : job.status === 'running' ? 'steel' : 'accent'} className="mt-0.5">
                  ⇄ {formatParallelJobStatusLabel(job.status)}
                </Pill>
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-secondary">
                    {truncateConversationShelfText(job.prompt || '(empty prompt)')}
                  </p>
                  {contextSummary ? <p className="mt-0.5 text-[11px] text-dim">{contextSummary}</p> : null}
                  {attachmentSummary ? <p className="mt-0.5 text-[11px] text-dim">attachments: {attachmentSummary}</p> : null}
                  {touchedFileSummary ? <p className="mt-0.5 text-[11px] text-dim">files: {touchedFileSummary}</p> : null}
                  {parentTouchedSummary ? <p className="mt-0.5 text-[11px] text-dim">parent: {parentTouchedSummary}</p> : null}
                  {overlapSummary ? <p className="mt-0.5 text-[11px] text-warning">overlap: {overlapSummary}</p> : null}
                  {sideEffectSummary ? <p className="mt-0.5 text-[11px] text-dim">effects: {sideEffectSummary}</p> : null}
                  {job.status === 'failed' && job.error ? (
                    <p className="mt-0.5 text-[11px] text-danger">{truncateConversationShelfText(job.error, { maxChars: 140, maxLines: 2 })}</p>
                  ) : job.resultPreview ? (
                    <p className="mt-0.5 text-[11px] text-dim">{truncateConversationShelfText(job.resultPreview, { maxChars: 140, maxLines: 2 })}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 pt-0.5 text-[11px]">
                  {(job.status === 'ready' || job.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => { onManageParallelJob(job.id, 'importNow'); }}
                      className="text-dim transition-colors hover:text-primary"
                      title="Append this parallel response to the main thread next"
                      aria-label="Import parallel response now"
                    >
                      import
                    </button>
                  )}
                  {job.status === 'running' ? (
                    <button
                      type="button"
                      onClick={() => { onManageParallelJob(job.id, 'cancel'); }}
                      className="text-dim transition-colors hover:text-primary"
                      title="Cancel this running parallel prompt"
                      aria-label="Cancel running parallel prompt"
                    >
                      cancel
                    </button>
                  ) : job.status !== 'importing' ? (
                    <button
                      type="button"
                      onClick={() => { onManageParallelJob(job.id, 'skip'); }}
                      className="text-dim transition-colors hover:text-primary"
                      title="Drop this parallel response without importing it"
                      aria-label="Skip parallel response"
                    >
                      skip
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => { onOpenConversation(job.childConversationId); }}
                    className="text-dim transition-colors hover:text-primary"
                    title="Open side thread"
                    aria-label="Open side thread"
                  >
                    open
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

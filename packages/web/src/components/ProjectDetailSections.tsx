import { type FormEventHandler, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { formatProjectStatus } from '../contextRailProject';
import type { ProjectBrief, ProjectFile, ProjectNote } from '../types';
import { timeAgo } from '../utils';
import { InlineMarkdownCode } from './MarkdownInlineCode';
import { summarizeActivityPreview, type ProjectActivityItemShape } from './projectDetailState';
import { ProjectFileRow, ProjectNoteRow } from './ProjectDetailForms';
import { EmptyState, Pill, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-default bg-base px-4 py-3 text-[15px] leading-relaxed text-primary focus:outline-none focus:border-accent/60';

function ProjectMarkdown({ body, className }: { body: string; className?: string }) {
  return (
    <div className={className ?? 'ui-markdown max-w-none text-[14px]'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          code: ({ className: codeClassName, children }) => <InlineMarkdownCode className={codeClassName}>{children}</InlineMarkdownCode>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export function ProjectRequirementsContent({
  goal,
  fallbackContent,
  acceptanceCriteria,
}: {
  goal: string;
  fallbackContent: string;
  acceptanceCriteria: string[];
}) {
  return (
    <div className="max-w-5xl space-y-6">
      {goal.length > 0 ? (
        <div className="space-y-1.5">
          <p className="ui-card-meta">Goal</p>
          <ProjectMarkdown body={goal} className="ui-markdown max-w-none" />
        </div>
      ) : fallbackContent.length > 0 ? (
        <ProjectMarkdown body={fallbackContent} className="ui-markdown max-w-none" />
      ) : (
        <EmptyState
          title="No requirements yet."
          body="Add a goal and acceptance criteria so the project has a clear definition of done."
          className="max-w-3xl py-8"
        />
      )}

      {acceptanceCriteria.length > 0 && (
        <div className="space-y-2">
          <p className="ui-card-meta">Acceptance criteria</p>
          <ul className="space-y-1.5">
            {acceptanceCriteria.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[14px] leading-relaxed text-secondary">
                <span className="mt-[2px] shrink-0 text-success">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ProjectPlanOverview({
  planContent,
  currentFocus,
  blockers,
  recentProgress,
  pct,
}: {
  planContent: string;
  currentFocus: string;
  blockers: string[];
  recentProgress: string[];
  pct: number;
}) {
  return (
    <>
      {planContent.length > 0 && (
        <ProjectMarkdown body={planContent} className="ui-markdown max-w-none" />
      )}

      {(currentFocus || blockers.length > 0 || recentProgress.length > 0) && (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-5">
            {currentFocus && (
              <div className="space-y-1.5">
                <p className="ui-card-meta">Current focus</p>
                <p className="ui-card-body">{currentFocus}</p>
              </div>
            )}

            {blockers.length > 0 && (
              <div className="space-y-2">
                <p className="ui-card-meta">Blockers</p>
                <ul className="space-y-1.5">
                  {blockers.map((blocker) => (
                    <li key={blocker} className="flex items-start gap-2 text-[14px] leading-relaxed text-warning">
                      <span className="mt-[2px] shrink-0">⚠</span>
                      <span>{blocker}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {recentProgress.length > 0 && (
            <div className="space-y-2">
              <p className="ui-card-meta">Recent progress</p>
              <ul className="space-y-1.5">
                {recentProgress.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[14px] leading-relaxed text-secondary">
                    <span className="mt-[2px] shrink-0 text-success">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="h-1 rounded-full bg-base overflow-hidden">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

export function ProjectCompletionContent({
  status,
  content,
}: {
  status: string;
  content: string;
}) {
  if (content.length > 0) {
    return (
      <div className="max-w-5xl space-y-5">
        <ProjectMarkdown body={content} className="ui-markdown max-w-none" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <EmptyState
        title="No completion summary yet."
        body={status === 'completed'
          ? 'Capture what shipped, what changed, and any follow-up work.'
          : 'Use this section once the project is done to summarize the outcome.'}
        className="max-w-3xl py-8"
      />
    </div>
  );
}

const TIMELINE_DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const TIMELINE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function parseTimelineDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimelineDay(value: string | undefined): string | null {
  const parsed = parseTimelineDate(value);
  return parsed ? TIMELINE_DAY_FORMAT.format(parsed) : null;
}

function formatTimelineTime(value: string | undefined): string | null {
  const parsed = parseTimelineDate(value);
  return parsed ? TIMELINE_TIME_FORMAT.format(parsed) : null;
}

function timelineTimestamp(item: ProjectActivityItemShape): string | undefined {
  return item.kind === 'conversation' ? item.conversation.lastActivityAt : item.entry.createdAt;
}

function timelineMarkerClass(item: ProjectActivityItemShape): string {
  if (item.kind === 'conversation') {
    return 'bg-teal';
  }

  switch (item.entry.kind) {
    case 'brief':
      return 'bg-accent';
    case 'artifact':
      return 'bg-steel';
    case 'attachment':
      return 'bg-secondary';
    case 'activity':
      return 'bg-warning';
    default:
      return 'bg-border-default';
  }
}

function timelinePreview(item: ProjectActivityItemShape): string | undefined {
  return item.kind === 'conversation'
    ? summarizeActivityPreview(item.conversation.snippet, 180)
    : summarizeActivityPreview(item.entry.description, 180);
}

export function ProjectActivityContent({
  items,
}: {
  items: ProjectActivityItemShape[];
}) {
  if (items.length === 0) {
    return (
      <div className="max-w-5xl py-4">
        <EmptyState
          title="No project timeline yet."
          body="Conversations, notes, brief updates, and uploaded resources will collect here as the project moves forward."
          className="max-w-3xl py-8"
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl relative">
      <div className="pointer-events-none absolute bottom-4 left-[7.25rem] top-4 hidden w-px -translate-x-1/2 bg-border-subtle sm:block" aria-hidden="true" />
      <div>
        {items.map((item) => {
          const at = timelineTimestamp(item);
          const dayLabel = formatTimelineDay(at);
          const timeLabel = formatTimelineTime(at);
          const preview = timelinePreview(item);

          if (item.kind === 'conversation') {
            const conversation = item.conversation;
            return (
              <article key={item.id} className="grid gap-2 py-4 sm:grid-cols-[5.5rem_1.5rem_minmax(0,1fr)] sm:gap-4">
                <div className="hidden pt-0.5 text-right sm:block">
                  <p className="text-[11px] font-mono text-secondary">{timeLabel ?? '—'}</p>
                  {dayLabel && <p className="mt-1 text-[11px] text-dim">{dayLabel}</p>}
                </div>
                <div className="hidden justify-center sm:flex">
                  <span className={`relative z-10 mt-1.5 h-3 w-3 rounded-full border-2 border-base ${timelineMarkerClass(item)}`} />
                </div>
                <div className="min-w-0 space-y-1.5 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/conversations/${encodeURIComponent(conversation.conversationId)}`} className="text-[15px] font-medium text-accent hover:text-accent/75 transition-colors">
                      {conversation.title}
                    </a>
                    <Pill tone="muted">conversation</Pill>
                    {conversation.isRunning && <Pill tone="accent">live</Pill>}
                    {conversation.needsAttention && <Pill tone="warning">attention</Pill>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                    <span className="font-mono">{conversation.conversationId}</span>
                    {conversation.lastActivityAt && <span>{timeAgo(conversation.lastActivityAt)}</span>}
                  </div>
                  {preview && <p className="max-w-3xl text-[13px] leading-relaxed text-secondary">{preview}</p>}
                </div>
              </article>
            );
          }

          const entry = item.entry;
          return (
            <article key={item.id} className="grid gap-2 py-4 sm:grid-cols-[5.5rem_1.5rem_minmax(0,1fr)] sm:gap-4">
              <div className="hidden pt-0.5 text-right sm:block">
                <p className="text-[11px] font-mono text-secondary">{timeLabel ?? '—'}</p>
                {dayLabel && <p className="mt-1 text-[11px] text-dim">{dayLabel}</p>}
              </div>
              <div className="hidden justify-center sm:flex">
                <span className={`relative z-10 mt-1.5 h-3 w-3 rounded-full border-2 border-base ${timelineMarkerClass(item)}`} />
              </div>
              <div className="min-w-0 space-y-1.5 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  {entry.href ? (
                    <a href={entry.href} className="text-[14px] font-medium text-accent hover:text-accent/75 transition-colors">
                      {entry.title}
                    </a>
                  ) : (
                    <p className="text-[14px] font-medium text-primary">{entry.title}</p>
                  )}
                  <Pill tone="muted">{formatProjectStatus(entry.kind)}</Pill>
                </div>
                <p className="ui-card-meta">{timeAgo(entry.createdAt)}</p>
                {preview && <p className="max-w-3xl text-[13px] leading-relaxed text-secondary">{preview}</p>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectHandoffDocContent({
  brief,
  editing,
  content,
  busy,
  error,
  onChange,
  onSubmit,
}: {
  brief: ProjectBrief | null;
  editing: boolean;
  content: string;
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <div className="max-w-5xl space-y-4">
      {editing ? (
        <form onSubmit={onSubmit} className="space-y-4 border-t border-border-subtle pt-4">
          <textarea
            value={content}
            onChange={(event) => onChange(event.target.value)}
            className={`${INPUT_CLASS} min-h-[18rem] resize-y font-mono text-[13px] leading-[1.7]`}
            spellCheck={false}
          />
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex items-center gap-3">
            <ToolbarButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save doc'}</ToolbarButton>
          </div>
        </form>
      ) : brief ? (
        <ProjectMarkdown body={brief.content} className="ui-markdown max-w-none" />
      ) : (
        <EmptyState
          title="No handoff doc yet."
          body="Use this as the human-readable handoff layer if the structured project fields are not enough."
          className="max-w-3xl py-8"
        />
      )}
    </div>
  );
}

export function ProjectRecordViewer({
  repoRoot,
  summary,
  rawProjectOpen,
  rawProjectContent,
  rawProjectBusy,
  rawProjectError,
  onRawProjectContentChange,
  onRawProjectSubmit,
  showSummary = true,
}: {
  repoRoot?: string;
  summary: string;
  rawProjectOpen: boolean;
  rawProjectContent: string;
  rawProjectBusy: boolean;
  rawProjectError: string | null;
  onRawProjectContentChange: (value: string) => void;
  onRawProjectSubmit: FormEventHandler<HTMLFormElement>;
  showSummary?: boolean;
}) {
  return (
    <>
      {showSummary && (
        <div className="max-w-4xl space-y-5">
          {repoRoot && (
            <div className="space-y-1.5">
              <p className="ui-card-meta">Repo root</p>
              <p className="ui-card-body font-mono break-all">{repoRoot}</p>
            </div>
          )}

          {summary.trim().length > 0 && (
            <div className="space-y-1.5">
              <p className="ui-card-meta">List summary</p>
              <p className="ui-card-body">{summary}</p>
            </div>
          )}
        </div>
      )}

      {rawProjectOpen && (
        <form onSubmit={onRawProjectSubmit} className="max-w-5xl space-y-4 border-t border-border-subtle pt-6">
          <p className="ui-card-meta">PROJECT.yaml</p>
          <textarea
            value={rawProjectContent}
            onChange={(event) => onRawProjectContentChange(event.target.value)}
            className={`${INPUT_CLASS} min-h-[20rem] resize-y font-mono text-[12px] leading-[1.6]`}
            spellCheck={false}
          />
          {rawProjectError && <p className="text-[12px] text-danger">{rawProjectError}</p>}
          <div className="flex items-center gap-3">
            <ToolbarButton type="submit" disabled={rawProjectBusy}>{rawProjectBusy ? 'Saving…' : 'Save YAML'}</ToolbarButton>
          </div>
        </form>
      )}
    </>
  );
}

export function ProjectNotesContent({
  notes,
  noteEditor,
  noteEditorForm,
  noteBusy,
  noteError,
  onEditNote,
  onDeleteNote,
}: {
  notes: ProjectNote[];
  noteEditor: { mode: 'add' } | { mode: 'edit'; noteId: string } | null;
  noteEditorForm: ReactNode;
  noteBusy: boolean;
  noteError: string | null;
  onEditNote: (note: ProjectNote) => void;
  onDeleteNote: (noteId: string) => void;
}) {
  return (
    <div className="max-w-5xl space-y-5">
      {noteEditor?.mode === 'add' && noteEditorForm}

      {notes.length === 0 && !noteEditor ? (
        <EmptyState
          title="No notes yet."
          body="Append notes, decisions, questions, or checkpoints so the project keeps useful context between conversations."
          className="border border-dashed border-border-subtle rounded-xl max-w-3xl"
        />
      ) : (
        <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
          {notes.map((note) => {
            const isEditing = noteEditor?.mode === 'edit' && noteEditor.noteId === note.id;
            if (isEditing) {
              return (
                <div key={note.id} id={`project-note-${note.id}`} className="py-4 scroll-mt-6">
                  {noteEditorForm}
                </div>
              );
            }

            return (
              <ProjectNoteRow
                key={note.id}
                note={note}
                busy={noteBusy}
                onEdit={() => onEditNote(note)}
                onDelete={() => onDeleteNote(note.id)}
              >
                {note.body.length > 0 ? <ProjectMarkdown body={note.body} /> : null}
              </ProjectNoteRow>
            );
          })}
        </div>
      )}

      {noteError && !noteEditor && <p className="text-[12px] text-danger">{noteError}</p>}
    </div>
  );
}

export function ProjectFilesContent({
  uploadForm,
  attachments,
  artifacts,
  fileBusy,
  onDeleteFile,
}: {
  uploadForm: ReactNode;
  attachments: ProjectFile[];
  artifacts: ProjectFile[];
  fileBusy: boolean;
  onDeleteFile: (file: ProjectFile) => void;
}) {
  return (
    <div className="max-w-5xl space-y-7">
      {uploadForm}

      <div className="space-y-7">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="ui-card-meta">Attachments</p>
            <p className="ui-card-meta">{attachments.length}</p>
          </div>
          <div className="divide-y divide-border-subtle border-t border-border-subtle">
            {attachments.length > 0 ? attachments.map((file) => (
              <ProjectFileRow key={file.id} file={file} busy={fileBusy} onDelete={() => onDeleteFile(file)} />
            )) : (
              <div className="py-4"><p className="ui-card-meta">No attachments yet.</p></div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="ui-card-meta">Artifacts</p>
            <p className="ui-card-meta">{artifacts.length}</p>
          </div>
          <div className="divide-y divide-border-subtle border-t border-border-subtle">
            {artifacts.length > 0 ? artifacts.map((file) => (
              <ProjectFileRow key={file.id} file={file} busy={fileBusy} onDelete={() => onDeleteFile(file)} />
            )) : (
              <div className="py-4"><p className="ui-card-meta">No project artifacts yet.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import type { FormEventHandler, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { formatProjectStatus } from '../contextRailProject';
import type {
  ProjectBrief,
  ProjectFile,
  ProjectLinkedConversation,
  ProjectNote,
  ProjectTimelineEntry,
} from '../types';
import { timeAgo } from '../utils';
import { ProjectFileRow, ProjectNoteRow } from './ProjectDetailForms';
import { EmptyState, Pill, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-default bg-base px-4 py-3 text-[15px] leading-relaxed text-primary focus:outline-none focus:border-accent/60';

export type ProjectActivityItemShape =
  | {
      id: string;
      kind: 'conversation';
      conversation: ProjectLinkedConversation;
    }
  | {
      id: string;
      kind: 'timeline';
      entry: ProjectTimelineEntry;
    };

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
          <div className="ui-markdown max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{goal}</ReactMarkdown>
          </div>
        </div>
      ) : fallbackContent.length > 0 ? (
        <div className="ui-markdown max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{fallbackContent}</ReactMarkdown>
        </div>
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
        <div className="ui-markdown max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{planContent}</ReactMarkdown>
        </div>
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
        <div className="ui-markdown max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
        </div>
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

export function ProjectActivityContent({
  items,
}: {
  items: ProjectActivityItemShape[];
}) {
  return (
    <div className="max-w-5xl space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
      {items.length === 0 ? (
        <div className="py-4">
          <EmptyState
            title="No project activity yet."
            body="Conversations, notes, brief updates, and uploaded resources will collect here as the project moves forward."
            className="max-w-3xl py-8"
          />
        </div>
      ) : items.map((item) => {
        if (item.kind === 'conversation') {
          const conversation = item.conversation;
          return (
            <article key={item.id} className="py-4 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/conversations/${encodeURIComponent(conversation.conversationId)}`} className="text-[15px] font-medium text-accent hover:text-accent/75 transition-colors">
                      {conversation.title}
                    </a>
                    <Pill tone="muted">conversation</Pill>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-dim">
                    <span className="font-mono">{conversation.conversationId}</span>
                    {conversation.lastActivityAt && <span>updated {timeAgo(conversation.lastActivityAt)}</span>}
                    {conversation.cwd && <span className="font-mono break-all">{conversation.cwd}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {conversation.isRunning && <Pill tone="accent">live</Pill>}
                  {conversation.needsAttention && <Pill tone="warning">attention</Pill>}
                </div>
              </div>
              {conversation.snippet && <p className="text-[13px] leading-relaxed text-secondary">{conversation.snippet}</p>}
            </article>
          );
        }

        const entry = item.entry;
        return (
          <article key={item.id} className="py-4 flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
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
              {entry.description && <p className="text-[13px] leading-relaxed text-secondary">{entry.description}</p>}
            </div>
            <span className="ui-card-meta shrink-0">{timeAgo(entry.createdAt)}</span>
          </article>
        );
      })}
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
        <div className="ui-markdown max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{brief.content}</ReactMarkdown>
        </div>
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
                {note.body.length > 0 ? (
                  <div className="ui-markdown max-w-none text-[14px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.body}</ReactMarkdown>
                  </div>
                ) : null}
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
    <div className="max-w-5xl space-y-6">
      {uploadForm}

      <div className="space-y-5">
        <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
          <div className="py-3"><p className="ui-card-meta">Attachments</p></div>
          {attachments.length > 0 ? attachments.map((file) => (
            <ProjectFileRow key={file.id} file={file} busy={fileBusy} onDelete={() => onDeleteFile(file)} />
          )) : (
            <div className="py-4"><p className="ui-card-meta">No attachments yet.</p></div>
          )}
        </div>

        <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
          <div className="py-3"><p className="ui-card-meta">Artifacts</p></div>
          {artifacts.length > 0 ? artifacts.map((file) => (
            <ProjectFileRow key={file.id} file={file} busy={fileBusy} onDelete={() => onDeleteFile(file)} />
          )) : (
            <div className="py-4"><p className="ui-card-meta">No project artifacts yet.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

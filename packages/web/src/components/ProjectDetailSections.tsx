import { useState, type ReactNode } from 'react';
import type { ProjectFile, ProjectNote } from '../types';
import { ProjectFileRow, ProjectNoteRow } from './ProjectDetailForms';
import { EmptyState, ToolbarButton } from './ui';
import { NoteEditorDocument } from './NoteEditorDocument';
import { RichMarkdownRenderer } from './editor/RichMarkdownRenderer';
import { NodeLinkList, UnresolvedNodeLinks } from './NodeLinksSection';
import type { ProjectActivityItemShape } from './projectDetailState';

const INPUT_CLASS = 'w-full rounded-xl border border-border-default bg-base px-4 py-3 text-[15px] leading-relaxed text-primary focus:outline-none focus:border-accent/60';


function normalizeHeadingValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function projectDocumentStartsWithTitleHeading(body: string, heading: string): boolean {
  const normalizedHeading = normalizeHeadingValue(heading);
  if (normalizedHeading.length === 0) {
    return false;
  }

  const lines = body.split('\n');
  let firstContentIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim().length > 0) {
      firstContentIndex = index;
      break;
    }
  }

  if (firstContentIndex < 0) {
    return false;
  }

  const firstLine = (lines[firstContentIndex] ?? '').trim();
  const match = firstLine.match(/^#\s+(.+)$/);
  return Boolean(match && normalizeHeadingValue(match[1] ?? '') === normalizedHeading);
}

export function stripMatchingLeadingHeading(body: string, heading: string): string {
  const normalizedHeading = normalizeHeadingValue(heading);
  if (normalizedHeading.length === 0) {
    return body;
  }

  const lines = body.split('\n');
  let firstContentIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim().length > 0) {
      firstContentIndex = index;
      break;
    }
  }

  if (firstContentIndex < 0) {
    return body;
  }

  if (!projectDocumentStartsWithTitleHeading(body, heading)) {
    return body;
  }

  let bodyStart = firstContentIndex + 1;
  while (bodyStart < lines.length && (lines[bodyStart] ?? '').trim().length === 0) {
    bodyStart += 1;
  }

  const stripped = lines.slice(bodyStart).join('\n').trim();
  return stripped.length > 0 ? stripped : body;
}

export function composeProjectDocumentContent(body: string, heading: string, preserveTitleHeading: boolean): string {
  if (!preserveTitleHeading || body.trim().length === 0) {
    return body;
  }

  return `# ${heading.trim() || 'Project'}\n\n${body.trim()}`;
}

function ProjectMarkdown({ body, className }: { body: string; className?: string }) {
  return <RichMarkdownRenderer content={body} className={className ?? 'ui-markdown max-w-none text-[14px]'} />;
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
  const content = goal.trim() || fallbackContent.trim();
  if (!content && acceptanceCriteria.length === 0) {
    return (
      <EmptyState
        title="No project doc yet."
        body="Write a short project note so future work has durable context."
        className="max-w-3xl py-8"
      />
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      {content && <ProjectMarkdown body={content} className="ui-markdown max-w-none" />}
      {acceptanceCriteria.length > 0 && (
        <ul className="space-y-1.5">
          {acceptanceCriteria.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[14px] leading-relaxed text-secondary">
              <span className="mt-[2px] shrink-0 text-success">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProjectPlanOverview({
  planContent,
  currentFocus,
  blockers,
  recentProgress,
}: {
  planContent: string;
  currentFocus: string;
  blockers: string[];
  recentProgress: string[];
  pct?: number;
}) {
  return (
    <div className="max-w-5xl space-y-5">
      {planContent.trim() && <ProjectMarkdown body={planContent} className="ui-markdown max-w-none" />}
      {currentFocus.trim() && (
        <div className="space-y-1.5">
          <p className="ui-card-meta">Current focus</p>
          <p className="ui-card-body">{currentFocus}</p>
        </div>
      )}
      {blockers.length > 0 && (
        <ul className="space-y-1.5">
          {blockers.map((item) => <li key={item} className="text-[14px] text-warning">{item}</li>)}
        </ul>
      )}
      {recentProgress.length > 0 && (
        <ul className="space-y-1.5">
          {recentProgress.map((item) => <li key={item} className="text-[14px] text-secondary">{item}</li>)}
        </ul>
      )}
    </div>
  );
}

export function ProjectCompletionContent({
  status,
  content,
}: {
  status: string;
  content: string;
}) {
  if (content.trim()) {
    return <ProjectMarkdown body={content} className="ui-markdown max-w-none" />;
  }

  return (
    <EmptyState
      title="No completion notes yet."
      body={status === 'done' || status === 'completed' ? 'Capture what shipped and any follow-up context.' : 'Use this area later if you want to summarize the outcome.'}
      className="max-w-3xl py-8"
    />
  );
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayLabel(value: string | undefined): string | null {
  const parsed = parseDate(value);
  return parsed ? DAY_FORMAT.format(parsed) : null;
}

function timeLabel(value: string | undefined): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return '—';
  }

  const hours = parsed.getHours();
  const hour12 = hours % 12 || 12;
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'p' : 'a';
  return `${hour12}:${minutes}${suffix}`;
}

function itemTimestamp(item: ProjectActivityItemShape): string | undefined {
  return item.kind === 'conversation' ? item.conversation.lastActivityAt : item.entry.createdAt;
}

function itemTitle(item: ProjectActivityItemShape): string {
  return item.kind === 'conversation' ? item.conversation.title : item.entry.title;
}

function itemHref(item: ProjectActivityItemShape): string | undefined {
  return item.kind === 'conversation'
    ? `/conversations/${encodeURIComponent(item.conversation.conversationId)}`
    : item.entry.href;
}

function itemKindLabel(item: ProjectActivityItemShape): string {
  if (item.kind === 'conversation') {
    return 'Conversation';
  }

  const normalized = item.entry.kind.replace(/[-_]+/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function itemSummary(item: ProjectActivityItemShape): string | null {
  if (item.kind === 'conversation') {
    return item.conversation.snippet?.trim() || item.conversation.cwd?.trim() || null;
  }

  return null;
}

const INITIAL_ACTIVITY_ITEMS = 6;

export function ProjectActivityContent({
  items,
}: {
  items: ProjectActivityItemShape[];
}) {
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) {
    return (
      <div className="max-w-5xl py-4">
        <EmptyState
          title="No activity yet."
          body="Notes, files, document edits, and linked conversations will show up here."
          className="max-w-3xl py-8"
        />
      </div>
    );
  }

  const visibleItems = showAll ? items : items.slice(0, INITIAL_ACTIVITY_ITEMS);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="max-w-5xl space-y-2.5">
      <div className="space-y-1.5">
        {visibleItems.map((item, index) => {
          const at = itemTimestamp(item);
          const href = itemHref(item);
          const title = itemTitle(item);
          const summary = itemSummary(item);
          const timestamp = `${timeLabel(at)}${dayLabel(at) ? ` · ${dayLabel(at)}` : ''}`;

          return (
            <div key={item.id} className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-2.5 py-1.5">
              <div className="flex flex-col items-center">
                <span className={index === 0 ? 'mt-1.5 h-1.5 w-1.5 rounded-full bg-accent' : 'mt-1.5 h-1.5 w-1.5 rounded-full bg-border-default'} />
                {index < visibleItems.length - 1 ? <span className="mt-1 w-px flex-1 bg-border-subtle" /> : null}
              </div>

              <div className="min-w-0 space-y-0.5">
                {href ? (
                  <a href={href} className="block min-w-0 truncate text-[13px] font-medium text-accent transition-colors hover:text-accent/75">
                    {title}
                  </a>
                ) : (
                  <p className="min-w-0 truncate text-[13px] font-medium text-primary">{title}</p>
                )}
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-dim">
                  <span className="shrink-0">{itemKindLabel(item)}</span>
                  {summary ? (
                    <>
                      <span className="shrink-0 opacity-40">·</span>
                      <span className="min-w-0 truncate text-secondary">{summary}</span>
                    </>
                  ) : null}
                  <span className="shrink-0 opacity-40">·</span>
                  <span className="shrink-0 text-[10px] text-dim">{timestamp}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {items.length > INITIAL_ACTIVITY_ITEMS ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="text-[12px] font-medium text-accent transition-colors hover:text-accent/75"
        >
          {showAll ? 'Show less activity' : `Show ${hiddenCount} older ${hiddenCount === 1 ? 'event' : 'events'}`}
        </button>
      ) : null}
    </div>
  );
}

export function ProjectDocumentContent({
  content,
  onChange,
}: {
  content: string;
  busy: boolean;
  dirty: boolean;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <NoteEditorDocument
      title=""
      onTitleChange={() => undefined}
      description=""
      onDescriptionChange={() => undefined}
      body={content}
      onBodyChange={onChange}
      showTitle={false}
      showDescription={false}
      frameClassName="ui-note-editor-frame-embedded"
      documentClassName="ui-note-editor-doc-embedded gap-0"
      bodyPlaceholder="Start writing…"
    />
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
              <p className="ui-card-meta">Summary</p>
              <p className="ui-card-body">{summary}</p>
            </div>
          )}
        </div>
      )}

      {rawProjectOpen && (
        <form onSubmit={onRawProjectSubmit} className="max-w-5xl space-y-4 border-t border-border-subtle pt-6">
          <p className="ui-card-meta">state.yaml</p>
          <textarea
            value={rawProjectContent}
            onChange={(event) => onRawProjectContentChange(event.target.value)}
            className={`${INPUT_CLASS} min-h-[20rem] resize-y font-mono text-[12px] leading-[1.6]`}
            spellCheck={false}
          />
          {rawProjectError && <p className="text-[12px] text-danger">{rawProjectError}</p>}
          <div className="flex items-center gap-3">
            <ToolbarButton type="submit" disabled={rawProjectBusy}>{rawProjectBusy ? 'Saving…' : 'Save state'}</ToolbarButton>
          </div>
        </form>
      )}
    </>
  );
}

export function ProjectNodeLinksContent({
  links,
}: {
  links?: { outgoing: Array<{ kind: 'note' | 'project' | 'skill'; id: string; title: string; summary?: string }>; incoming: Array<{ kind: 'note' | 'project' | 'skill'; id: string; title: string; summary?: string }>; unresolved: string[] };
}) {
  return (
    <div className="max-w-5xl space-y-5">
      <NodeLinkList
        title="Links to"
        items={links?.outgoing}
        surface="main"
        emptyText="This project does not reference other nodes yet."
      />
      <NodeLinkList
        title="Linked from"
        items={links?.incoming}
        surface="main"
        emptyText="No other nodes link to this project yet."
      />
      <UnresolvedNodeLinks ids={links?.unresolved} />
    </div>
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
          body="Add running notes, decisions, and questions as the project evolves."
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
  files,
  fileBusy,
  onDeleteFile,
}: {
  uploadForm: ReactNode;
  files: ProjectFile[];
  fileBusy: boolean;
  onDeleteFile: (file: ProjectFile) => void;
}) {
  return (
    <div className="max-w-5xl space-y-6">
      {uploadForm}
      <div className="divide-y divide-border-subtle border-y border-border-subtle">
        {files.length > 0 ? files.map((file) => (
          <ProjectFileRow key={file.id} file={file} busy={fileBusy} onDelete={() => onDeleteFile(file)} />
        )) : (
          <div className="py-4"><p className="ui-card-meta">No files yet.</p></div>
        )}
      </div>
    </div>
  );
}

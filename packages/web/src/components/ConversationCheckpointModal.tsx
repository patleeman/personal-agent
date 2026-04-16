import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  getConversationCheckpointFileFromSearch,
  setConversationCheckpointFileInSearch,
  setConversationCheckpointIdInSearch,
} from '../conversationCheckpoints';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type { ConversationCheckpointStructuralDiffResult, ConversationCommitCheckpointComment, ConversationCommitCheckpointFile } from '../types';
import { formatDate } from '../utils';
import { ErrorState, LoadingState, cx } from './ui';

type ParsedPatchLine = {
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'del';
  oldNumber?: number | null;
  newNumber?: number | null;
  text: string;
};

type SplitDiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'context'; line: ParsedPatchLine }
  | { kind: 'change'; left: ParsedPatchLine | null; right: ParsedPatchLine | null };

type DiffViewMode = 'unified' | 'split' | 'structural';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function parsePatchLines(patch: string): ParsedPatchLine[] {
  const output: ParsedPatchLine[] = [];
  let oldLineNumber: number | null = null;
  let newLineNumber: number | null = null;

  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.length === 0 && output.length > 0 && output[output.length - 1]?.text === '') {
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLineNumber = Number.parseInt(hunkMatch[1] as string, 10);
      newLineNumber = Number.parseInt(hunkMatch[2] as string, 10);
      output.push({ kind: 'hunk', text: line });
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      output.push({ kind: 'add', oldNumber: null, newNumber: newLineNumber, text: line });
      newLineNumber = (newLineNumber ?? 0) + 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      output.push({ kind: 'del', oldNumber: oldLineNumber, newNumber: null, text: line });
      oldLineNumber = (oldLineNumber ?? 0) + 1;
      continue;
    }

    if (line.startsWith(' ')) {
      output.push({ kind: 'context', oldNumber: oldLineNumber, newNumber: newLineNumber, text: line });
      oldLineNumber = (oldLineNumber ?? 0) + 1;
      newLineNumber = (newLineNumber ?? 0) + 1;
      continue;
    }

    output.push({ kind: 'meta', text: line });
  }

  return output;
}

function buildSplitDiffRows(lines: ParsedPatchLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let pendingDeletes: ParsedPatchLine[] = [];
  let pendingAdds: ParsedPatchLine[] = [];

  const flushPendingChanges = () => {
    if (pendingDeletes.length === 0 && pendingAdds.length === 0) {
      return;
    }

    const rowCount = Math.max(pendingDeletes.length, pendingAdds.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        kind: 'change',
        left: pendingDeletes[index] ?? null,
        right: pendingAdds[index] ?? null,
      });
    }

    pendingDeletes = [];
    pendingAdds = [];
  };

  for (const line of lines) {
    if (line.kind === 'meta') {
      continue;
    }

    if (line.kind === 'del') {
      pendingDeletes.push(line);
      continue;
    }

    if (line.kind === 'add') {
      pendingAdds.push(line);
      continue;
    }

    flushPendingChanges();

    if (line.kind === 'hunk') {
      rows.push({ kind: 'hunk', text: line.text });
      continue;
    }

    rows.push({ kind: 'context', line });
  }

  flushPendingChanges();
  return rows;
}

function displayPatchLineText(line: ParsedPatchLine): string {
  if ((line.kind === 'context' || line.kind === 'add' || line.kind === 'del') && line.text.length > 0) {
    return line.text.slice(1);
  }

  return line.text;
}

function statusLabel(file: ConversationCommitCheckpointFile): string {
  switch (file.status) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'typechange':
      return 'Type change';
    case 'unmerged':
      return 'Unmerged';
    case 'modified':
      return 'Modified';
    default:
      return 'Changed';
  }
}

function fileDisplayPath(file: ConversationCommitCheckpointFile): string {
  return file.previousPath && file.previousPath !== file.path
    ? `${file.previousPath} → ${file.path}`
    : file.path;
}

function DiffViewToggle({
  currentView,
  onChange,
  structuralDiffAvailable,
}: {
  currentView: DiffViewMode;
  onChange: (nextView: DiffViewMode) => void;
  structuralDiffAvailable: boolean;
}) {
  return (
    <div className="ui-segmented-control" role="tablist" aria-label="Diff view">
      {([
        ['split', 'Split'],
        ['unified', 'Unified'],
        ...(structuralDiffAvailable ? [['structural', 'Structural']] : []),
      ] as Array<[DiffViewMode, string]>).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={currentView === value}
          onClick={() => onChange(value)}
          className={cx('ui-segmented-button', currentView === value && 'ui-segmented-button-active')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function StructuralDisplayToggle({
  display,
  onChange,
}: {
  display: 'inline' | 'side-by-side';
  onChange: (nextDisplay: 'inline' | 'side-by-side') => void;
}) {
  return (
    <div className="ui-segmented-control" role="tablist" aria-label="Structural diff layout">
      {([
        ['side-by-side', 'Side by side'],
        ['inline', 'Inline'],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={display === value}
          onClick={() => onChange(value)}
          className={cx('ui-segmented-button', display === value && 'ui-segmented-button-active')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function UnifiedDiffTable({ lines, filePath }: { lines: ParsedPatchLine[]; filePath: string }) {
  const visibleLines = lines.filter((line) => line.kind !== 'meta');

  return (
    <table className="min-w-full border-collapse font-mono text-[11px] leading-5 text-primary">
      <tbody>
        {visibleLines.map((line, index) => {
          const toneClass = line.kind === 'add'
            ? 'bg-success/8 text-success'
            : line.kind === 'del'
              ? 'bg-danger/8 text-danger'
              : line.kind === 'hunk'
                ? 'bg-accent/8 text-accent'
                : '';

          return (
            <tr key={`${filePath}:unified:${index}`} className={cx('border-b border-border-subtle/60 align-top', toneClass)}>
              <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{line.oldNumber ?? ''}</td>
              <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{line.newNumber ?? ''}</td>
              <td className="whitespace-pre-wrap break-all px-3 py-1">{displayPatchLineText(line) || ' '}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SplitDiffTable({ rows, filePath }: { rows: SplitDiffRow[]; filePath: string }) {
  return (
    <table className="min-w-full border-collapse font-mono text-[11px] leading-5 text-primary">
      <tbody>
        {rows.map((row, index) => {
          if (row.kind === 'hunk') {
            return (
              <tr key={`${filePath}:hunk:${index}`} className="border-b border-border-subtle/60 bg-accent/8 text-accent">
                <td colSpan={4} className="px-3 py-1 whitespace-pre-wrap break-all">{row.text}</td>
              </tr>
            );
          }

          if (row.kind === 'context') {
            return (
              <tr key={`${filePath}:context:${index}`} className="border-b border-border-subtle/60 align-top">
                <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{row.line.oldNumber ?? ''}</td>
                <td className="w-1/2 px-3 py-1 whitespace-pre-wrap break-all">{displayPatchLineText(row.line) || ' '}</td>
                <td className="w-14 select-none px-3 py-1 text-right text-dim/80 border-l border-border-subtle/60">{row.line.newNumber ?? ''}</td>
                <td className="w-1/2 px-3 py-1 whitespace-pre-wrap break-all">{displayPatchLineText(row.line) || ' '}</td>
              </tr>
            );
          }

          const leftToneClass = row.left?.kind === 'del' ? 'bg-danger/8 text-danger' : 'bg-base/30 text-dim/70';
          const rightToneClass = row.right?.kind === 'add' ? 'bg-success/8 text-success' : 'bg-base/30 text-dim/70';

          return (
            <tr key={`${filePath}:change:${index}`} className="border-b border-border-subtle/60 align-top">
              <td className={cx('w-14 select-none px-3 py-1 text-right text-dim/80', leftToneClass)}>{row.left?.oldNumber ?? ''}</td>
              <td className={cx('w-1/2 px-3 py-1 whitespace-pre-wrap break-all', leftToneClass)}>{row.left ? displayPatchLineText(row.left) : ' '}</td>
              <td className={cx('w-14 select-none border-l border-border-subtle/60 px-3 py-1 text-right text-dim/80', rightToneClass)}>{row.right?.newNumber ?? ''}</td>
              <td className={cx('w-1/2 px-3 py-1 whitespace-pre-wrap break-all', rightToneClass)}>{row.right ? displayPatchLineText(row.right) : ' '}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CheckpointDiffSection({
  file,
  active,
  view,
  registerSection,
}: {
  file: ConversationCommitCheckpointFile;
  active: boolean;
  view: 'unified' | 'split';
  registerSection: (node: HTMLDivElement | null) => void;
}) {
  const patchLines = useMemo(() => parsePatchLines(file.patch), [file.patch]);
  const splitRows = useMemo(() => buildSplitDiffRows(patchLines), [patchLines]);

  return (
    <section
      ref={registerSection}
      data-checkpoint-file-path={file.path}
      className={cx('scroll-mt-4 border-b border-border-subtle/80', active && 'bg-accent/3')}
    >
      <div className="border-b border-border-subtle/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-primary" title={fileDisplayPath(file)}>{fileDisplayPath(file)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-secondary">
              <span>{statusLabel(file)}</span>
              <span className="font-mono tabular-nums"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
            </p>
          </div>
          {active ? <span className="text-[10px] uppercase tracking-[0.14em] text-accent">Current</span> : null}
        </div>
      </div>
      <div className="overflow-hidden bg-elevated/10">
        {view === 'split'
          ? <SplitDiffTable rows={splitRows} filePath={file.path} />
          : <UnifiedDiffTable lines={patchLines} filePath={file.path} />}
      </div>
    </section>
  );
}

function CheckpointCommentList({ comments }: { comments: ConversationCommitCheckpointComment[] }) {
  if (comments.length === 0) {
    return <p className="rounded-xl bg-elevated/25 px-3 py-2.5 text-[12px] text-dim">No comments yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {comments.map((comment) => (
        <div key={comment.id} className="rounded-xl bg-elevated/25 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="font-medium text-primary">{comment.authorName}</span>
            <span className="text-dim">{formatDate(comment.updatedAt)}</span>
            {comment.filePath ? <span className="font-mono text-dim">{comment.filePath}</span> : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-secondary">{comment.body}</p>
        </div>
      ))}
    </div>
  );
}

function StructuralDiffContent({
  state,
}: {
  state: {
    loading: boolean;
    error: string | null;
    data: ConversationCheckpointStructuralDiffResult | null;
  };
}) {
  if (state.loading) {
    return <LoadingState label="Loading structural diff…" className="justify-center h-full" />;
  }

  if (state.error) {
    return <ErrorState message={state.error} className="px-4 py-4" />;
  }

  if (!state.data?.available) {
    return <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">Structural diff isn’t available for this file on this machine.</div>;
  }

  return (
    <pre className="min-h-full whitespace-pre overflow-x-auto px-4 py-3 font-mono text-[11px] leading-5 text-primary">
      {state.data.content}
    </pre>
  );
}

const COMMENT_TEXTAREA_CLASS = 'w-full rounded-xl border border-border-subtle bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-primary outline-none transition-colors focus:border-accent/50 focus:bg-surface focus-visible:ring-2 focus-visible:ring-accent/20';

export function ConversationCheckpointModal({
  conversationId,
  checkpointId,
}: {
  conversationId: string;
  checkpointId: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { versions } = useAppEvents();
  const [copied, setCopied] = useState(false);
  const [diffView, setDiffView] = useState<DiffViewMode>('split');
  const [structuralDisplay, setStructuralDisplay] = useState<'inline' | 'side-by-side'>('side-by-side');
  const [structuralState, setStructuralState] = useState<{
    loading: boolean;
    error: string | null;
    data: ConversationCheckpointStructuralDiffResult | null;
  }>({ loading: false, error: null, data: null });
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSaveState, setCommentSaveState] = useState<SaveState>('idle');
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  const fileSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const checkpointFetcher = useCallback(() => api.conversationCheckpoint(conversationId, checkpointId), [checkpointId, conversationId]);
  const reviewContextFetcher = useCallback(() => api.conversationCheckpointReviewContext(conversationId, checkpointId), [checkpointId, conversationId]);
  const {
    data,
    loading,
    error,
    refetch,
    replaceData,
  } = useApi(checkpointFetcher, `${conversationId}:checkpoint:${checkpointId}`);
  const {
    data: reviewContext,
    error: reviewContextError,
    refetch: refetchReviewContext,
  } = useApi(reviewContextFetcher, `${conversationId}:checkpoint-review:${checkpointId}`);

  useEffect(() => {
    setCopied(false);
    setDiffView('split');
    setStructuralDisplay('side-by-side');
    setStructuralState({ loading: false, error: null, data: null });
    setCommentDraft('');
    setCommentSaveState('idle');
  }, [checkpointId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const closeCheckpoint = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: setConversationCheckpointIdInSearch(location.search, null),
    });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeCheckpoint();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeCheckpoint]);

  useEffect(() => {
    void refetch({ resetLoading: false });
    void refetchReviewContext({ resetLoading: false });
  }, [refetch, refetchReviewContext, versions.checkpoints]);

  const checkpoint = data?.checkpoint ?? null;
  const commentable = checkpoint?.commentable !== false;
  const isReadOnlyCommit = checkpoint?.sourceKind === 'git' || !commentable;
  const reviewLabel = isReadOnlyCommit ? 'Commit' : 'Checkpoint';
  const selectedFilePath = getConversationCheckpointFileFromSearch(location.search);
  const resolvedFilePath = selectedFilePath ?? activeFilePath ?? checkpoint?.files[0]?.path ?? null;
  const selectedFile = checkpoint?.files.find((file) => file.path === resolvedFilePath)
    ?? checkpoint?.files[0]
    ?? null;
  const structuralDiffAvailable = reviewContext?.structuralDiff.available === true;
  const sidebarSelectedFilePath = diffView === 'structural'
    ? selectedFile?.path ?? null
    : activeFilePath ?? selectedFile?.path ?? null;

  useEffect(() => {
    if (!structuralDiffAvailable && diffView === 'structural') {
      setDiffView('split');
    }
  }, [diffView, structuralDiffAvailable]);

  useEffect(() => {
    if (selectedFilePath) {
      setActiveFilePath(selectedFilePath);
      return;
    }

    setActiveFilePath((current) => current ?? checkpoint?.files[0]?.path ?? null);
  }, [checkpoint?.files, selectedFilePath]);

  useEffect(() => {
    if (diffView !== 'structural' || !selectedFile || !structuralDiffAvailable) {
      setStructuralState((current) => current.loading || current.error || current.data
        ? { loading: false, error: null, data: null }
        : current);
      return;
    }

    let cancelled = false;
    setStructuralState({ loading: true, error: null, data: null });

    void api.conversationCheckpointStructuralDiff(conversationId, checkpointId, {
      path: selectedFile.path,
      display: structuralDisplay,
    }).then((nextData) => {
      if (cancelled) {
        return;
      }

      setStructuralState({ loading: false, error: null, data: nextData });
    }).catch((fetchError) => {
      if (cancelled) {
        return;
      }

      setStructuralState({
        loading: false,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        data: null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [checkpointId, conversationId, diffView, selectedFile, structuralDiffAvailable, structuralDisplay]);

  useEffect(() => {
    if (diffView === 'structural' || !selectedFilePath) {
      return;
    }

    const element = fileSectionRefs.current[selectedFilePath];
    if (!element) {
      return;
    }

    element.scrollIntoView({ block: 'start' });
  }, [diffView, selectedFilePath, checkpoint?.id]);

  useEffect(() => {
    if (diffView === 'structural' || !checkpoint?.files.length) {
      return;
    }

    const container = viewerScrollRef.current;
    if (!container) {
      return;
    }

    let frameId = 0;

    const updateActiveSection = () => {
      frameId = 0;
      const containerTop = container.getBoundingClientRect().top + 24;
      let nextPath = checkpoint.files[0]?.path ?? null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const file of checkpoint.files) {
        const section = fileSectionRefs.current[file.path];
        if (!section) {
          continue;
        }

        const rect = section.getBoundingClientRect();
        if (rect.bottom < containerTop) {
          continue;
        }

        const distance = Math.abs(rect.top - containerTop);
        if (distance < bestDistance) {
          bestDistance = distance;
          nextPath = file.path;
        }
      }

      if (nextPath) {
        setActiveFilePath((current) => current === nextPath ? current : nextPath);
      }
    };

    const handleScroll = () => {
      if (frameId !== 0) {
        return;
      }

      frameId = window.requestAnimationFrame(updateActiveSection);
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [checkpoint?.files, diffView]);

  async function copyCommitSha() {
    if (!checkpoint) {
      return;
    }

    await navigator.clipboard.writeText(checkpoint.commitSha);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function saveComment() {
    if (!checkpoint) {
      return;
    }

    const body = commentDraft.trim();
    if (!body) {
      return;
    }

    setCommentSaveState('saving');
    try {
      const updated = await api.createConversationCheckpointComment(conversationId, checkpoint.id, {
        body,
      });
      replaceData(updated);
      setCommentDraft('');
      setCommentSaveState('saved');
      window.setTimeout(() => setCommentSaveState((current) => current === 'saved' ? 'idle' : current), 1400);
    } catch {
      setCommentSaveState('error');
    }
  }

  const openFile = useCallback((filePath: string) => {
    setActiveFilePath(filePath);
    navigate({
      pathname: location.pathname,
      search: setConversationCheckpointFileInSearch(location.search, filePath),
    });

    if (diffView !== 'structural') {
      const element = fileSectionRefs.current[filePath];
      element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [diffView, location.pathname, location.search, navigate]);

  const githubInfo = reviewContext?.github ?? null;

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeCheckpoint();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isReadOnlyCommit ? 'Local git commit review' : 'Conversation checkpoint review'}
        className="ui-dialog-shell"
        style={{ width: 'min(1440px, calc(100vw - 3rem))', height: 'min(90vh, 980px)', maxHeight: 'calc(100vh - 3rem)' }}
      >
        <div className="border-b border-border-subtle px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim/80">
                <span>{reviewLabel}</span>
                {checkpoint ? <span className="rounded-full bg-success/12 px-2 py-0.5 font-mono text-success normal-case tracking-normal">{checkpoint.shortSha}</span> : null}
              </div>
              <h2 className="mt-1 text-pretty text-[16px] font-semibold text-primary" title={checkpoint?.subject ?? checkpointId}>
                {checkpoint?.subject ?? checkpointId}
              </h2>
              {checkpoint ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-secondary">
                  <span>{checkpoint.fileCount} file{checkpoint.fileCount === 1 ? '' : 's'}</span>
                  <span className="font-mono tabular-nums"><span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span></span>
                  {commentable ? <span>{checkpoint.commentCount} comment{checkpoint.commentCount === 1 ? '' : 's'}</span> : null}
                  <span>committed {formatDate(checkpoint.committedAt)}</span>
                  {reviewContextError ? <span className="text-dim">GitHub info unavailable</span> : null}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {checkpoint ? (
                <button type="button" onClick={() => { void copyCommitSha(); }} className="ui-toolbar-button px-2 py-1 text-[10px]" title={checkpoint.commitSha}>
                  {copied ? 'Copied' : 'Copy SHA'}
                </button>
              ) : null}
              {githubInfo ? (
                <a href={githubInfo.commitUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button px-2 py-1 text-[10px]">
                  GitHub
                </a>
              ) : null}
              {githubInfo?.pullRequestUrl ? (
                <a href={githubInfo.pullRequestUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button px-2 py-1 text-[10px]" title={githubInfo.pullRequestTitle}>
                  PR{typeof githubInfo.pullRequestNumber === 'number' ? ` #${githubInfo.pullRequestNumber}` : ''}
                </a>
              ) : null}
              <button type="button" onClick={closeCheckpoint} className="ui-toolbar-button px-2 py-1 text-[10px]">Close</button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DiffViewToggle currentView={diffView} onChange={setDiffView} structuralDiffAvailable={structuralDiffAvailable} />
            {diffView === 'structural' ? (
              <StructuralDisplayToggle display={structuralDisplay} onChange={setStructuralDisplay} />
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex flex-1 overflow-hidden bg-base">
          <aside className="flex w-80 shrink-0 flex-col border-r border-border-subtle bg-base/50">
            <div className="border-b border-border-subtle px-4 py-3">
              <p className="ui-section-label">Files</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {checkpoint?.files.length ? checkpoint.files.map((file) => {
                const selected = sidebarSelectedFilePath === file.path;
                return (
                  <button
                    key={`${file.path}:${file.previousPath ?? ''}`}
                    type="button"
                    onClick={() => openFile(file.path)}
                    className={cx(
                      'w-full rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
                      selected ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium" title={fileDisplayPath(file)}>{fileDisplayPath(file)}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-dim/80">{statusLabel(file)}</p>
                      </div>
                      <div className="shrink-0 text-right text-[10px] font-mono tabular-nums">
                        <div className="text-success">+{file.additions}</div>
                        <div className="text-danger">-{file.deletions}</div>
                      </div>
                    </div>
                  </button>
                );
              }) : (
                <p className="px-2 py-3 text-[12px] text-dim">No changed files were captured for this checkpoint.</p>
              )}
            </div>
          </aside>

          <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
            {loading && !checkpoint ? (
              <LoadingState label="Loading checkpoint…" className="justify-center h-full" />
            ) : error || !checkpoint ? (
              <ErrorState message={error || 'Checkpoint not found.'} className="px-4 py-4" />
            ) : (
              <>
                <div className="border-b border-border-subtle px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      {diffView === 'structural' && selectedFile ? (
                        <>
                          <p className="truncate text-[13px] font-medium text-primary" title={fileDisplayPath(selectedFile)}>{fileDisplayPath(selectedFile)}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-secondary">
                            <span>{statusLabel(selectedFile)}</span>
                            <span className="font-mono tabular-nums"><span className="text-success">+{selectedFile.additions}</span> <span className="text-danger">-{selectedFile.deletions}</span></span>
                            {reviewContext?.structuralDiff.command ? <span className="text-dim">via {reviewContext.structuralDiff.command}</span> : null}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-[13px] font-medium text-primary">All diffs</p>
                          <p className="mt-0.5 text-[11px] text-secondary">Scroll continuously or jump between files from the sidebar.</p>
                        </>
                      )}
                    </div>
                    <p className="text-[11px] text-dim">{checkpoint.authorName}{checkpoint.authorEmail ? ` · ${checkpoint.authorEmail}` : ''}</p>
                  </div>
                </div>
                <div ref={viewerScrollRef} className="min-h-0 flex-1 overflow-auto bg-elevated/20">
                  {diffView === 'structural' ? (
                    selectedFile ? (
                      <StructuralDiffContent state={structuralState} />
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">Select a file from the sidebar.</div>
                    )
                  ) : checkpoint.files.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">No changed files were captured for this checkpoint.</div>
                  ) : (
                    <div>
                      {checkpoint.files.map((file) => (
                        <CheckpointDiffSection
                          key={`${file.path}:${file.previousPath ?? ''}`}
                          file={file}
                          active={sidebarSelectedFilePath === file.path}
                          view={diffView}
                          registerSection={(node) => {
                            fileSectionRefs.current[file.path] = node;
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t border-border-subtle px-4 py-3">
                  {commentable ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="ui-section-label">Comments</p>
                          <p className="mt-1 text-[11px] text-dim">
                            {checkpoint.commentCount > 0 ? `${checkpoint.commentCount} saved` : 'Add review notes to this checkpoint.'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-[11px]">
                          {commentSaveState === 'saved' ? <span className="text-success">Added</span> : null}
                          {commentSaveState === 'error' ? <span className="text-danger">Couldn’t save</span> : null}
                          {commentDraft.trim().length > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCommentDraft('');
                                setCommentSaveState('idle');
                              }}
                              className="ui-toolbar-button px-2 py-1 text-[10px]"
                              disabled={commentSaveState === 'saving'}
                            >
                              Clear
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => { void saveComment(); }}
                            className="ui-toolbar-button px-2 py-1 text-[10px] text-accent"
                            disabled={commentDraft.trim().length === 0 || commentSaveState === 'saving'}
                          >
                            {commentSaveState === 'saving' ? 'Adding…' : 'Add comment'}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 max-h-44 overflow-y-auto pr-1">
                        <CheckpointCommentList comments={checkpoint.comments} />
                      </div>
                      <textarea
                        value={commentDraft}
                        onChange={(event) => {
                          setCommentDraft(event.target.value);
                          setCommentSaveState((current) => current === 'saving' ? current : 'idle');
                        }}
                        rows={3}
                        name="checkpointComment"
                        aria-label="Checkpoint comment"
                        placeholder="Add a checkpoint comment…"
                        autoComplete="off"
                        className={cx(COMMENT_TEXTAREA_CLASS, 'mt-3 resize-y')}
                      />
                    </>
                  ) : (
                    <div>
                      <p className="ui-section-label">Review</p>
                      <p className="mt-1 text-[11px] text-dim">Local git commit review is read-only. Save a checkpoint if you want comments attached to the conversation.</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

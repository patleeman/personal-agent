import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../client/api';
import { useAppEvents } from '../app/contexts';
import type { ConversationCommitCheckpointRecord, ConversationCommitCheckpointSummary, UncommittedDiffResult } from '../shared/types';
import { formatDate } from '../shared/utils';
import { CheckpointDiffSection, fileDisplayPath } from './checkpoints/CheckpointDiffView';
import { ErrorState, LoadingState, cx } from './ui';

type DiffViewMode = 'unified' | 'split';

type DiffRailFile = Pick<ConversationCommitCheckpointRecord['files'][number], 'path' | 'previousPath' | 'status' | 'additions' | 'deletions'>;

function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function DiffViewToggle({
  currentView,
  onChange,
}: {
  currentView: DiffViewMode;
  onChange: (nextView: DiffViewMode) => void;
}) {
  return (
    <div className="ui-segmented-control" role="tablist" aria-label="Diff view">
      {([
        ['split', 'Split'],
        ['unified', 'Unified'],
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

const UNCOMMITTED_SENTINEL = '__uncommitted__';

function useUncommittedDiff(cwd: string | null | undefined) {
  const { versions } = useAppEvents();
  const [result, setResult] = useState<UncommittedDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.workspaceUncommittedDiff(cwd)
      .then((data) => {
        if (!cancelled) {
          setResult(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult(null);
          setError(err instanceof Error ? err.message : 'Failed to load uncommitted changes.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, versions.workspace]);

  return { result, loading, error };
}

export function useConversationCheckpointSummaries(conversationId: string | null | undefined) {
  const { versions } = useAppEvents();
  const [checkpoints, setCheckpoints] = useState<ConversationCommitCheckpointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setCheckpoints([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.conversationCheckpoints(conversationId)
      .then((result) => {
        if (!cancelled) {
          setCheckpoints([...result.checkpoints].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCheckpoints([]);
          setError(err instanceof Error ? err.message : 'Failed to load diffs.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, versions.checkpoints]);

  return { checkpoints, loading, error };
}

export function ConversationDiffRailContent({
  checkpoints,
  activeCheckpointId,
  loading,
  error,
  onOpenCheckpoint,
  onScrollToFile,
  workspaceCwd,
}: {
  checkpoints: ConversationCommitCheckpointSummary[];
  activeCheckpointId: string | null;
  loading: boolean;
  error: string | null;
  onOpenCheckpoint: (checkpointId: string) => void;
  onScrollToFile?: (filePath: string) => void;
  workspaceCwd?: string | null;
}) {
  const [filesByCheckpoint, setFilesByCheckpoint] = useState<Record<string, DiffRailFile[]>>({});
  const { result: uncommitted, loading: uncommittedLoading } = useUncommittedDiff(workspaceCwd);
  const uncommittedSelected = activeCheckpointId === UNCOMMITTED_SENTINEL;

  useEffect(() => {
    let cancelled = false;
    const missing = checkpoints.filter((checkpoint) => !filesByCheckpoint[checkpoint.id]);
    if (missing.length === 0) {
      return;
    }

    Promise.all(missing.map(async (checkpoint) => {
      try {
        const result = await api.conversationCheckpoint(checkpoint.conversationId, checkpoint.id);
        return [checkpoint.id, result.checkpoint.files.map(({ patch: _patch, ...file }) => file)] as const;
      } catch {
        return [checkpoint.id, []] as const;
      }
    })).then((entries) => {
      if (cancelled) {
        return;
      }
      setFilesByCheckpoint((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });

    return () => {
      cancelled = true;
    };
  }, [checkpoints, filesByCheckpoint]);

  if (loading && checkpoints.length === 0 && !uncommittedLoading) {
    return <LoadingState label="Loading diffs…" className="justify-center h-full" />;
  }

  if (error && checkpoints.length === 0 && !uncommitted) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  if (checkpoints.length === 0 && !uncommitted) {
    if (activeCheckpointId && activeCheckpointId !== UNCOMMITTED_SENTINEL) {
      const shortId = activeCheckpointId.slice(0, 12);
      return (
        <div className="h-full min-h-0 overflow-y-auto px-2 py-2">
          <button
            type="button"
            onClick={() => onOpenCheckpoint(activeCheckpointId)}
            className="w-full rounded-xl bg-elevated px-3 py-2.5 text-left text-primary transition-colors"
            title={activeCheckpointId}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">Opened commit</p>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-dim">Loaded from local git history</p>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-dim">{shortId}</span>
            </div>
          </button>
        </div>
      );
    }

    if (!workspaceCwd) {
      return <div className="px-4 py-5 text-[12px] text-dim">No diffs in this conversation.</div>;
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-1.5 py-2">
      <div className="flex flex-col gap-1">
        {/* Uncommitted entry */}
        {uncommitted ? (
          <UncommittedRailEntry
            result={uncommitted}
            loading={uncommittedLoading}
            selected={uncommittedSelected}
            onSelect={() => onOpenCheckpoint(UNCOMMITTED_SENTINEL)}
            showFiles={uncommittedSelected}
            onFileClick={(filePath) => {
              if (uncommittedSelected && onScrollToFile) {
                onScrollToFile(filePath);
              }
            }}
          />
        ) : workspaceCwd && uncommittedLoading ? (
          <div className="rounded-lg px-2.5 py-2">
            <p className="text-[11px] text-dim">Checking uncommitted changes…</p>
          </div>
        ) : null}

        {/* Checkpoint entries */}
        {checkpoints.map((checkpoint) => {
          const selected = checkpoint.id === activeCheckpointId;
          const files = filesByCheckpoint[checkpoint.id];
          return (
            <div key={checkpoint.id} className={cx('rounded-lg', selected && 'bg-elevated/70')}>
              <button
                type="button"
                onClick={() => onOpenCheckpoint(checkpoint.id)}
                className={cx(
                  'flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
                  selected ? 'text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                )}
                title={checkpoint.shortSha}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-dim" aria-hidden="true">
                  <path d="m8.5 5.5 5 6.5-5 6.5" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-[11px] text-steel">{checkpoint.shortSha}</span>
                    <span className="shrink-0 text-[10px] text-dim">{checkpoint.fileCount} file{checkpoint.fileCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-dim">
                    <span className="font-mono tabular-nums"><span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span></span>
                  </div>
                </div>
              </button>
              <div className="pb-1 pl-7 pr-1">
                {files ? files.slice(0, 12).map((file) => (
                  <button
                    key={`${checkpoint.id}:${file.path}:${file.previousPath ?? ''}`}
                    type="button"
                    onClick={() => {
                      if (checkpoint.id === activeCheckpointId && onScrollToFile) {
                        onScrollToFile(file.path);
                      } else {
                        onOpenCheckpoint(checkpoint.id);
                      }
                    }}
                    className="group flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-secondary transition-colors hover:bg-elevated/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
                    title={fileDisplayPath(file as ConversationCommitCheckpointRecord['files'][number])}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim group-hover:text-secondary" aria-hidden="true">
                      <path d="M14.25 3.75H6.75v16.5h10.5V6.75l-3-3Z" />
                      <path d="M14.25 3.75V6.75h3" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate">{fileName(file.path)}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-[10px] text-dim xl:block">{parentPath(file.path)}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
                  </button>
                )) : (
                  <div className="px-2 py-1.5 text-[11px] text-dim">Loading files…</div>
                )}
                {files && files.length > 12 ? <div className="px-2 py-1 text-[10px] text-dim">+{files.length - 12} more files</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UncommittedRailEntry({
  result,
  loading,
  selected,
  onSelect,
  showFiles,
  onFileClick,
}: {
  result: UncommittedDiffResult;
  loading: boolean;
  selected: boolean;
  onSelect: () => void;
  showFiles: boolean;
  onFileClick?: (filePath: string) => void;
}) {
  const files = result.files;
  return (
    <div className={cx('rounded-lg', selected && 'bg-elevated/70')}>
      <button
        type="button"
        onClick={onSelect}
        className={cx(
          'flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
          selected ? 'text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
        )}
        title={result.branch ?? 'Uncommitted changes'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-dim" aria-hidden="true">
          <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 1 1 3.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cx(
              'shrink-0 text-[11px] font-medium',
              selected ? 'text-accent' : 'text-secondary',
            )}>Uncommitted</span>
            <span className="shrink-0 text-[10px] text-dim">{result.changeCount} file{result.changeCount === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-dim">
            {result.branch ? <span className="truncate">{result.branch}</span> : null}
            <span className="font-mono tabular-nums"><span className="text-success">+{result.linesAdded}</span> <span className="text-danger">-{result.linesDeleted}</span></span>
          </div>
        </div>
      </button>
      {showFiles && files.length > 0 ? (
        <div className="pb-1 pl-7 pr-1">
          {files.slice(0, 12).map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onFileClick?.(file.path)}
              className="group flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-secondary transition-colors hover:bg-elevated/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
              title={fileDisplayPath(file as ConversationCommitCheckpointRecord['files'][number])}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim group-hover:text-secondary" aria-hidden="true">
                <path d="M14.25 3.75H6.75v16.5h10.5V6.75l-3-3Z" />
                <path d="M14.25 3.75V6.75h3" />
              </svg>
              <span className="min-w-0 flex-1 truncate">{fileName(file.path)}</span>
              <span className="hidden min-w-0 flex-1 truncate text-[10px] text-dim xl:block">{parentPath(file.path)}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
            </button>
          ))}
          {files.length > 12 ? <div className="px-2 py-1 text-[10px] text-dim">+{files.length - 12} more files</div> : null}
        </div>
      ) : null}
      {showFiles && loading && files.length === 0 ? (
        <div className="pb-1 pl-7 pr-1">
          <div className="px-2 py-1.5 text-[11px] text-dim">Loading files…</div>
        </div>
      ) : null}
    </div>
  );
}

export function ConversationCheckpointWorkbenchPane({
  conversationId,
  checkpointId,
  onMissingCheckpoint,
  scrollToFile,
  workspaceCwd,
}: {
  conversationId: string;
  checkpointId: string | null;
  onMissingCheckpoint?: () => void;
  scrollToFile?: string | null;
  workspaceCwd?: string | null;
}) {
  const { versions } = useAppEvents();
  const [checkpoint, setCheckpoint] = useState<ConversationCommitCheckpointRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffView, setDiffView] = useState<DiffViewMode>('split');
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  const fileSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setDiffView('split');
    setActiveFilePath(null);
    fileSectionRefs.current = {};
  }, [checkpointId]);

  useEffect(() => {
    if (!checkpointId) {
      setCheckpoint(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.conversationCheckpoint(conversationId, checkpointId)
      .then((result) => {
        if (!cancelled) {
          setCheckpoint(result.checkpoint);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCheckpoint(null);
          setError(err instanceof Error ? err.message : 'Diff not found.');
          onMissingCheckpoint?.();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [checkpointId, conversationId, onMissingCheckpoint, versions.checkpoints]);

  const selectedFilePath = activeFilePath ?? checkpoint?.files[0]?.path ?? null;

  const checkpointSubtitle = useMemo(() => {
    if (!checkpoint) {
      return null;
    }
    return `${checkpoint.fileCount} file${checkpoint.fileCount === 1 ? '' : 's'} changed · ${formatDate(checkpoint.committedAt)}`;
  }, [checkpoint]);

  useEffect(() => {
    setActiveFilePath((current) => current ?? checkpoint?.files[0]?.path ?? null);
  }, [checkpoint?.files]);

  useEffect(() => {
    if (!checkpoint?.files.length) {
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

  useEffect(() => {
    if (!scrollToFile || !checkpoint) {
      return;
    }

    const section = fileSectionRefs.current[scrollToFile];
    if (!section || !viewerScrollRef.current) {
      return;
    }

    const container = viewerScrollRef.current;
    const containerRect = container.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const offset = sectionRect.top - containerRect.top + container.scrollTop - 20;
    container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    setActiveFilePath(scrollToFile);
  }, [scrollToFile, checkpoint]);

  if (!checkpointId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Diffs</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Select a diff</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">Pick a saved conversation diff from the right rail.</p>
        </div>
      </div>
    );
  }

  // Uncommitted mode — show working tree diffs
  if (checkpointId === UNCOMMITTED_SENTINEL) {
    return (
      <UncommittedDiffPaneView workspaceCwd={workspaceCwd} diffView={diffView} onDiffViewChange={setDiffView} scrollToFile={scrollToFile} />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base">
      <div className="shrink-0 border-b border-border-subtle bg-base/95 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-secondary">
              {checkpoint ? <span className="font-mono text-steel">{checkpoint.shortSha}</span> : <span className="ui-section-label">Diff</span>}
              {checkpointSubtitle ? <span className="truncate">{checkpointSubtitle}</span> : null}
              {checkpoint ? <span className="font-mono tabular-nums"><span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span></span> : null}
            </div>
            <h2 className="mt-1 truncate text-[17px] font-semibold text-primary" title={checkpoint?.subject ?? checkpointId}>{checkpoint?.subject ?? checkpointId}</h2>
          </div>
          <DiffViewToggle currentView={diffView} onChange={setDiffView} />
        </div>
      </div>

      <div className="min-h-0 flex flex-1 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && !checkpoint ? (
            <LoadingState label="Loading diff…" className="justify-center h-full" />
          ) : error || !checkpoint ? (
            <ErrorState message={error || 'Diff not found.'} className="px-4 py-4" />
          ) : (
            <div ref={viewerScrollRef} className="h-full overflow-auto overscroll-contain bg-base">
              {checkpoint.files.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">No changed files were captured for this diff.</div>
              ) : (
                <div className="mx-auto max-w-[1500px] px-5 py-4">
                  {checkpoint.files.map((file) => (
                    <CheckpointDiffSection
                      key={`${file.path}:${file.previousPath ?? ''}`}
                      file={file}
                      active={selectedFilePath === file.path}
                      view={diffView}
                      stickyHeader
                      showActiveBadge
                      registerSection={(node) => {
                        fileSectionRefs.current[file.path] = node;
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UncommittedDiffPaneView({
  workspaceCwd,
  diffView,
  onDiffViewChange,
  scrollToFile,
}: {
  workspaceCwd?: string | null;
  diffView: DiffViewMode;
  onDiffViewChange: (view: DiffViewMode) => void;
  scrollToFile?: string | null;
}) {
  const { result, loading, error } = useUncommittedDiff(workspaceCwd);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  const fileSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const files = result?.files ?? [];
  const selectedFilePath = activeFilePath ?? files[0]?.path ?? null;

  useEffect(() => {
    setActiveFilePath(files[0]?.path ?? null);
  }, [files]);

  useEffect(() => {
    if (!files.length) {
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
      let nextPath = files[0]?.path ?? null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const file of files) {
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
  }, [files, diffView]);

  useEffect(() => {
    if (!scrollToFile || !result) {
      return;
    }

    const section = fileSectionRefs.current[scrollToFile];
    if (!section || !viewerScrollRef.current) {
      return;
    }

    const container = viewerScrollRef.current;
    const containerRect = container.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const offset = sectionRect.top - containerRect.top + container.scrollTop - 20;
    container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    setActiveFilePath(scrollToFile);
  }, [scrollToFile, result]);

  if (!workspaceCwd) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Uncommitted changes</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open a local conversation</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">Uncommitted changes are shown for local conversations with a git workspace.</p>
        </div>
      </div>
    );
  }

  if (loading && !result) {
    return <LoadingState label="Checking uncommitted changes…" className="justify-center h-full" />;
  }

  if (error && !result) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base">
      <div className="shrink-0 border-b border-border-subtle bg-base/95 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-secondary">
              <span className="ui-section-label">Uncommitted</span>
              {result?.branch ? <span className="truncate font-mono text-steel">{result.branch}</span> : null}
              {result ? <span className="font-mono tabular-nums"><span className="text-success">+{result.linesAdded}</span> <span className="text-danger">-{result.linesDeleted}</span></span> : null}
            </div>
            <h2 className="mt-1 text-[17px] font-semibold text-primary">Uncommitted changes</h2>
          </div>
          <DiffViewToggle currentView={diffView} onChange={onDiffViewChange} />
        </div>
      </div>

      <div className="min-h-0 flex flex-1 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          {files.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">No uncommitted changes.</div>
          ) : (
            <div ref={viewerScrollRef} className="h-full overflow-auto overscroll-contain bg-base">
              <div className="mx-auto max-w-[1500px] px-5 py-4">
                {files.map((file) => (
                  <CheckpointDiffSection
                    key={`${file.path}:${file.previousPath ?? ''}`}
                    file={file}
                    active={selectedFilePath === file.path}
                    view={diffView}
                    stickyHeader
                    showActiveBadge
                    registerSection={(node) => {
                      fileSectionRefs.current[file.path] = node;
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

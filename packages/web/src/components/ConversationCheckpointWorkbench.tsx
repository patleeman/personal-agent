import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../client/api';
import { useAppEvents } from '../app/contexts';
import type { ConversationCommitCheckpointRecord, ConversationCommitCheckpointSummary } from '../shared/types';
import { formatDate } from '../shared/utils';
import { CheckpointDiffSection, fileDisplayPath, statusLabel } from './checkpoints/CheckpointDiffView';
import { ErrorState, LoadingState, cx } from './ui';

type DiffViewMode = 'unified' | 'split';

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
}: {
  checkpoints: ConversationCommitCheckpointSummary[];
  activeCheckpointId: string | null;
  loading: boolean;
  error: string | null;
  onOpenCheckpoint: (checkpointId: string) => void;
}) {
  if (loading && checkpoints.length === 0) {
    return <LoadingState label="Loading diffs…" className="justify-center h-full" />;
  }

  if (error && checkpoints.length === 0) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  if (checkpoints.length === 0) {
    if (activeCheckpointId) {
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

    return <div className="px-4 py-5 text-[12px] text-dim">No diffs in this conversation.</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-2 py-2">
      <div className="flex flex-col gap-1.5">
        {checkpoints.map((checkpoint) => {
          const selected = checkpoint.id === activeCheckpointId;
          return (
            <button
              key={checkpoint.id}
              type="button"
              onClick={() => onOpenCheckpoint(checkpoint.id)}
              className={cx(
                'rounded-xl px-3 py-2.5 text-left transition-colors',
                selected ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
              )}
              title={`${checkpoint.subject} · ${checkpoint.shortSha}`}
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{checkpoint.title || checkpoint.subject}</p>
                  <p className="mt-0.5 truncate text-[11px] leading-4 text-dim">{checkpoint.subject}</p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-dim">{checkpoint.shortSha}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-dim">
                <span>{checkpoint.fileCount} file{checkpoint.fileCount === 1 ? '' : 's'}</span>
                <span className="font-mono tabular-nums"><span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span></span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ConversationCheckpointWorkbenchPane({
  conversationId,
  checkpointId,
  onMissingCheckpoint,
}: {
  conversationId: string;
  checkpointId: string | null;
  onMissingCheckpoint?: () => void;
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

  const openFile = useCallback((filePath: string) => {
    setActiveFilePath(filePath);
    const element = fileSectionRefs.current[filePath];
    element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base">
      <div className="shrink-0 border-b border-border-subtle px-4 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim/80">
              <span>Diff</span>
              {checkpoint ? <span className="rounded-full bg-success/12 px-2 py-0.5 font-mono text-success normal-case tracking-normal">{checkpoint.shortSha}</span> : null}
            </div>
            <h2 className="mt-1 truncate text-[15px] font-semibold text-primary" title={checkpoint?.subject ?? checkpointId}>{checkpoint?.subject ?? checkpointId}</h2>
            {checkpoint ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-secondary">
                <span>{checkpoint.fileCount} file{checkpoint.fileCount === 1 ? '' : 's'}</span>
                <span className="font-mono tabular-nums"><span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span></span>
                <span>{formatDate(checkpoint.committedAt)}</span>
              </div>
            ) : null}
          </div>
          <DiffViewToggle currentView={diffView} onChange={setDiffView} />
        </div>
      </div>

      <div className="min-h-0 flex flex-1 overflow-hidden">
        <aside className="hidden w-[clamp(13rem,18vw,17rem)] shrink-0 flex-col border-r border-border-subtle bg-base/50 lg:flex">
          <div className="border-b border-border-subtle px-3 py-2.5">
            <p className="ui-section-label">Files</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {checkpoint?.files.length ? checkpoint.files.map((file) => {
              const selected = selectedFilePath === file.path;
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
              <p className="px-2 py-3 text-[12px] text-dim">No changed files were captured for this diff.</p>
            )}
          </div>
        </aside>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && !checkpoint ? (
            <LoadingState label="Loading diff…" className="justify-center h-full" />
          ) : error || !checkpoint ? (
            <ErrorState message={error || 'Diff not found.'} className="px-4 py-4" />
          ) : (
            <div ref={viewerScrollRef} className="h-full overflow-auto overscroll-contain bg-elevated/20">
              {checkpoint.files.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">No changed files were captured for this diff.</div>
              ) : (
                <div>
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

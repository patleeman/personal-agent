import { useEffect, useMemo, useState } from 'react';
import { api } from '../client/api';
import type { DesktopRemoteDirectoryListing } from '../shared/types';
import { ToolbarButton, cx } from './ui';

function sortListing(listing: DesktopRemoteDirectoryListing): DesktopRemoteDirectoryListing {
  return {
    ...listing,
    entries: [...listing.entries].sort((left, right) => {
      if (left.isDir !== right.isDir) {
        return left.isDir ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    }),
  };
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
    </svg>
  );
}

function ParentDirectoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 14-5-5 5-5" />
      <path d="M20 20c0-6-4-11-11-11H4" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function splitPathSegments(path: string): Array<{ label: string; path: string }> {
  if (!path) {
    return [];
  }

  const isAbsolute = path.startsWith('/');
  const parts = path.split('/').filter(Boolean);
  const segments: Array<{ label: string; path: string }> = [];

  if (isAbsolute) {
    segments.push({ label: '/', path: '/' });
  }

  let current = isAbsolute ? '' : '';
  for (const part of parts) {
    current = isAbsolute ? `${current}/${part}` : current ? `${current}/${part}` : part;
    segments.push({ label: part, path: current || '/' });
  }

  return segments;
}

const BROWSER_ROW_CLASS = 'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-base';

export function RemoteDirectoryBrowserModal({
  hostId,
  hostLabel,
  initialPath,
  title = 'Choose remote directory',
  statusMessage,
  statusTone = 'accent',
  onSelect,
  onClose,
}: {
  hostId: string;
  hostLabel: string;
  initialPath?: string | null;
  title?: string;
  statusMessage?: string | null;
  statusTone?: 'accent' | 'danger';
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DesktopRemoteDirectoryListing | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const visibleListing = useMemo(() => (listing ? sortListing(listing) : null), [listing]);
  const directories = useMemo(() => visibleListing?.entries.filter((entry) => entry.isDir) ?? [], [visibleListing]);
  const pathSegments = useMemo(() => splitPathSegments(visibleListing?.path ?? selectedPath), [selectedPath, visibleListing?.path]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void api.remoteDirectory(hostId, initialPath ?? undefined)
      .then((nextListing) => {
        if (cancelled) {
          return;
        }

        setListing(nextListing);
        setSelectedPath(nextListing.path);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
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
  }, [hostId, initialPath]);

  const navigateTo = async (path: string | undefined) => {
    if (!path) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextListing = await api.remoteDirectory(hostId, path);
      setListing(nextListing);
      setSelectedPath(nextListing.path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const activeStatusMessage = statusMessage ?? (loading ? `Connecting to ${hostLabel}…` : null);
  const currentPath = visibleListing?.path ?? selectedPath;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border-subtle bg-base shadow-2xl">
        <div className="border-b border-border-subtle px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold text-primary">{title}</h2>
              <p className="mt-1 text-[12px] text-secondary">{hostLabel}</p>
            </div>
            <ToolbarButton onClick={() => { void navigateTo(currentPath || initialPath || undefined); }} disabled={loading}>
              Reload
            </ToolbarButton>
          </div>
          <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1 text-[12px] text-secondary">
            {pathSegments.length > 0 ? pathSegments.map((segment, index) => {
              const isLast = index === pathSegments.length - 1;
              return (
                <div key={`${segment.path}-${index}`} className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => { void navigateTo(segment.path); }}
                    disabled={loading || isLast}
                    className={cx(
                      'rounded-md px-2 py-1 transition-colors',
                      isLast ? 'bg-surface text-primary' : 'hover:bg-surface hover:text-primary',
                    )}
                  >
                    {segment.label}
                  </button>
                  {!isLast ? <span className="text-dim/70">/</span> : null}
                </div>
              );
            }) : (
              <span className="font-mono text-[11px] text-primary">{currentPath || 'Loading…'}</span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {activeStatusMessage ? <p className={cx('px-2 pb-2 text-[12px]', statusTone === 'danger' ? 'text-danger' : 'text-accent')}>{activeStatusMessage}</p> : null}
          {loading ? <p className="ui-card-meta px-2 pb-2">Loading remote directory…</p> : null}
          {error ? <p className="px-2 pb-2 text-[12px] text-danger">{error}</p> : null}
          {!loading && !error && visibleListing ? (
            <div className="space-y-1">
              {visibleListing.parent ? (
                <button
                  type="button"
                  onClick={() => { void navigateTo(visibleListing.parent); }}
                  className={cx(BROWSER_ROW_CLASS, 'text-secondary hover:bg-surface hover:text-primary')}
                >
                  <ParentDirectoryIcon className="shrink-0 text-dim/80" />
                  <span className="font-mono text-[13px] text-primary">..</span>
                </button>
              ) : null}

              {directories.length > 0 ? directories.map((entry) => {
                const selected = selectedPath === entry.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => setSelectedPath(entry.path)}
                    onDoubleClick={() => { void navigateTo(entry.path); }}
                    className={cx(
                      BROWSER_ROW_CLASS,
                      selected ? 'bg-accent/6 text-primary ring-1 ring-accent/15' : 'text-secondary hover:bg-surface hover:text-primary',
                    )}
                  >
                    <FolderIcon className={cx('shrink-0', selected ? 'text-accent' : 'text-dim/80 group-hover:text-accent')} />
                    <span className={cx('min-w-0 flex-1 truncate text-[13px] font-medium', selected ? 'text-primary' : 'text-primary/95')}>
                      {entry.name}
                    </span>
                    {entry.isHidden ? <span className="shrink-0 text-[11px] text-dim">Hidden</span> : null}
                    <ChevronRightIcon className="shrink-0 text-dim/70" />
                  </button>
                );
              }) : (
                <p className="ui-card-meta px-2 py-3">This folder has no subdirectories.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border-subtle px-6 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-dim/90">Selected folder</p>
            <p className="mt-1 truncate font-mono text-[11px] text-primary">{selectedPath || currentPath || '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
            <ToolbarButton onClick={() => { if (selectedPath) onSelect(selectedPath); }} disabled={!selectedPath || loading}>Choose</ToolbarButton>
          </div>
        </div>
      </div>
    </div>
  );
}

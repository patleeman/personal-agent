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

export function RemoteDirectoryBrowserModal({
  hostId,
  hostLabel,
  initialPath,
  title = 'Choose remote directory',
  onSelect,
  onClose,
}: {
  hostId: string;
  hostLabel: string;
  initialPath?: string | null;
  title?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DesktopRemoteDirectoryListing | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const visibleListing = useMemo(() => (listing ? sortListing(listing) : null), [listing]);

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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border-subtle bg-base shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-primary">{title}</h2>
            <p className="mt-1 text-[12px] text-secondary">Browsing {hostLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={() => { if (selectedPath) onSelect(selectedPath); }} disabled={!selectedPath || loading}>Choose</ToolbarButton>
            <ToolbarButton onClick={onClose}>Close</ToolbarButton>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-border-subtle px-6 py-3 text-[12px] text-secondary">
          <ToolbarButton onClick={() => { void navigateTo(visibleListing?.parent); }} disabled={!visibleListing?.parent || loading}>Up</ToolbarButton>
          <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-primary">{selectedPath || visibleListing?.path || 'Loading…'}</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? <p className="ui-card-meta px-2">Loading remote directory…</p> : null}
          {error ? <p className="px-2 text-[12px] text-danger">{error}</p> : null}
          {!loading && !error && visibleListing ? (
            <div className="space-y-px">
              {visibleListing.entries.filter((entry) => entry.isDir).length > 0 ? visibleListing.entries.filter((entry) => entry.isDir).map((entry) => {
                const selected = selectedPath === entry.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => setSelectedPath(entry.path)}
                    onDoubleClick={() => { void navigateTo(entry.path); }}
                    className={cx('ui-list-row flex w-full items-center justify-between px-3 py-3 text-left', selected && 'ui-list-row-selected')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-primary">{entry.name}</div>
                      <div className="mt-1 truncate font-mono text-[11px] text-secondary">{entry.path}</div>
                    </div>
                    <span className="text-[11px] text-secondary">dir</span>
                  </button>
                );
              }) : (
                <p className="ui-card-meta px-2">This directory has no subdirectories.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

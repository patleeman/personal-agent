import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import {
  buildInitialExpandedPaths,
  buildWorkspaceSearch,
  filterWorkspaceTree,
  parentPaths,
  readWorkspaceCwdFromSearch,
  readWorkspaceFileFromSearch,
  summarizeChanges,
  TreeRowChange,
  WorkspaceTreeView,
} from '../workspaceBrowser';
import { isWorkspaceEditorDirty, subscribeWorkspaceChanged, subscribeWorkspaceEditorDirty } from '../workspaceEvents';
import { ErrorState, LoadingState, Pill, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const ROW_CLASS = 'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors text-secondary hover:bg-surface hover:text-primary';

export function WorkspaceRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedCwd = useMemo(() => readWorkspaceCwdFromSearch(location.search), [location.search]);
  const selectedFilePath = useMemo(() => readWorkspaceFileFromSearch(location.search), [location.search]);
  const [treeQuery, setTreeQuery] = useState('');
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(() => isWorkspaceEditorDirty());

  const snapshotApi = useApi(() => api.workspaceSnapshot(requestedCwd ?? undefined), requestedCwd ?? 'default');
  const snapshot = snapshotApi.data;
  const refreshSnapshot = snapshotApi.refetch;

  useEffect(() => subscribeWorkspaceChanged(() => {
    void refreshSnapshot({ resetLoading: false });
  }), [refreshSnapshot]);

  useEffect(() => subscribeWorkspaceEditorDirty(setDirty), []);

  useEffect(() => {
    setExpandedPaths(buildInitialExpandedPaths(snapshot, selectedFilePath));
  }, [snapshot?.root, snapshot, selectedFilePath]);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const path of parentPaths(selectedFilePath)) {
        next.add(path);
      }
      return next;
    });
  }, [selectedFilePath]);

  const filteredTree = useMemo(
    () => filterWorkspaceTree(snapshot?.tree ?? [], { query: treeQuery, changedOnly: showChangedOnly }),
    [showChangedOnly, snapshot?.tree, treeQuery],
  );

  const visibleChanges = useMemo(() => {
    const normalizedQuery = treeQuery.trim().toLowerCase();
    return (snapshot?.changes ?? []).filter((entry) => !normalizedQuery || entry.relativePath.toLowerCase().includes(normalizedQuery));
  }, [snapshot?.changes, treeQuery]);

  const confirmDiscardIfNeeded = useCallback(() => {
    if (!isWorkspaceEditorDirty()) {
      return true;
    }

    return window.confirm('Discard unsaved changes in the current file?');
  }, []);

  const applySelection = useCallback((filePath: string) => {
    if (filePath === selectedFilePath) {
      return;
    }

    if (!confirmDiscardIfNeeded()) {
      return;
    }

    navigate(`/workspace${buildWorkspaceSearch(location.search, { file: filePath })}`);
  }, [confirmDiscardIfNeeded, location.search, navigate, selectedFilePath]);

  const handleToggleDirectory = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (snapshotApi.loading && !snapshot) {
    return <LoadingState label="Loading workspace tree…" className="h-full justify-center" />;
  }

  if (snapshotApi.error && !snapshot) {
    return <ErrorState className="m-4" message={`Unable to load workspace tree: ${snapshotApi.error}`} />;
  }

  if (!snapshot) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 py-4 space-y-3 border-b border-border-subtle">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="ui-card-title">Workspace tree</p>
            <Pill tone={snapshot.changedCount > 0 ? 'warning' : 'muted'}>{summarizeChanges(snapshot.changedCount)}</Pill>
            {dirty && <Pill tone="warning">unsaved</Pill>}
          </div>
          <p className="ui-card-meta break-all">{snapshot.root}</p>
        </div>

        <div className="space-y-2">
          <input
            value={treeQuery}
            onChange={(event) => setTreeQuery(event.target.value)}
            placeholder="Filter files by path"
            className={INPUT_CLASS}
            spellCheck={false}
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className={showChangedOnly ? 'ui-pill ui-pill-accent' : 'ui-pill ui-pill-muted'}
              onClick={() => setShowChangedOnly((value) => !value)}
            >
              {showChangedOnly ? 'Changed only' : 'All files'}
            </button>
            <ToolbarButton onClick={() => { void refreshSnapshot({ resetLoading: false }); }} disabled={snapshotApi.refreshing}>
              {snapshotApi.refreshing ? 'Refreshing…' : '↻ Refresh'}
            </ToolbarButton>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="ui-section-label">Changed files</p>
            <span className="text-[11px] text-dim">{snapshot.changedCount}</span>
          </div>
          {snapshot.changedCount === 0 ? (
            <p className="text-[12px] text-dim">No current git changes.</p>
          ) : visibleChanges.length === 0 ? (
            <p className="text-[12px] text-dim">No changed files match the current filter.</p>
          ) : (
            <div className="space-y-0.5">
              {visibleChanges.map((entry) => (
                <button
                  key={entry.relativePath}
                  type="button"
                  className={[
                    ROW_CLASS,
                    entry.relativePath === selectedFilePath && 'bg-accent/10 text-primary',
                    !entry.exists && 'opacity-70',
                  ].filter(Boolean).join(' ')}
                  onClick={() => applySelection(entry.relativePath)}
                  title={entry.path}
                >
                  <TreeRowChange change={entry.change} />
                  <span className={[
                    'flex-1 truncate font-mono',
                    !entry.exists && 'line-through',
                  ].filter(Boolean).join(' ')}>
                    {entry.relativePath}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="ui-section-label">File tree</p>
            <span className="text-[11px] text-dim">{filteredTree.length}</span>
          </div>
          {filteredTree.length === 0 ? (
            <p className="text-[12px] text-dim">No files match the current filter.</p>
          ) : (
            <WorkspaceTreeView
              nodes={filteredTree}
              selectedPath={selectedFilePath}
              expandedPaths={expandedPaths}
              onToggle={handleToggleDirectory}
              onSelect={applySelection}
            />
          )}
          {snapshot.truncated && (
            <p className="text-[11px] text-dim">Large folder view truncated after the first 3000 files.</p>
          )}
        </section>
      </div>
    </div>
  );
}

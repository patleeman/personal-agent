import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import {
  buildInitialExpandedPaths,
  buildWorkspaceSearch,
  collectDirectoryPaths,
  countVisibleTreeFiles,
  filterWorkspaceTree,
  parentPaths,
  readWorkspaceCwdFromSearch,
  readWorkspaceFileFromSearch,
  summarizeChanges,
  WorkspaceTreeView,
} from '../workspaceBrowser';
import { isWorkspaceEditorDirty, subscribeWorkspaceChanged, subscribeWorkspaceEditorDirty } from '../workspaceEvents';
import { ErrorState, LoadingState, Pill, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-md border border-border-default bg-base px-2.5 py-1.5 text-[11px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

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
  const visibleFileCount = useMemo(() => countVisibleTreeFiles(filteredTree), [filteredTree]);
  const visibleDirectoryPaths = useMemo(() => collectDirectoryPaths(filteredTree), [filteredTree]);

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

  const handleExpandAll = useCallback(() => {
    setExpandedPaths(new Set(visibleDirectoryPaths));
  }, [visibleDirectoryPaths]);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set(parentPaths(selectedFilePath)));
  }, [selectedFilePath]);

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
      <div className="shrink-0 border-b border-border-subtle px-3 py-3 space-y-2.5">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <p className="ui-card-title">Workspace tree</p>
            <Pill tone={snapshot.changedCount > 0 ? 'warning' : 'muted'}>{summarizeChanges(snapshot.changedCount)}</Pill>
            {dirty && <Pill tone="warning">unsaved</Pill>}
          </div>
          <p className="break-all text-[11px] text-dim">{snapshot.root}</p>
        </div>

        <input
          value={treeQuery}
          onChange={(event) => setTreeQuery(event.target.value)}
          placeholder="Filter files by path"
          className={INPUT_CLASS}
          spellCheck={false}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={showChangedOnly ? 'ui-pill ui-pill-accent' : 'ui-pill ui-pill-muted'}
            onClick={() => setShowChangedOnly((value) => !value)}
          >
            {showChangedOnly ? 'Changed only' : 'All files'}
          </button>
          <ToolbarButton onClick={handleExpandAll} disabled={visibleDirectoryPaths.length === 0}>
            Expand all
          </ToolbarButton>
          <ToolbarButton onClick={handleCollapseAll} disabled={visibleDirectoryPaths.length === 0}>
            Collapse
          </ToolbarButton>
          <ToolbarButton onClick={() => { void refreshSnapshot({ resetLoading: false }); }} disabled={snapshotApi.refreshing} className="ml-auto">
            {snapshotApi.refreshing ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border-subtle px-3 py-1.5 text-[10px] text-dim">
          <div className="flex items-center justify-between gap-3">
            <span>{visibleFileCount} visible {visibleFileCount === 1 ? 'file' : 'files'}</span>
            {selectedFilePath && (
              <span className="max-w-[12rem] truncate font-mono text-[10px]" title={selectedFilePath}>{selectedFilePath}</span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filteredTree.length === 0 ? (
            <p className="px-1 text-[11px] text-dim">No files match the current filter.</p>
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
            <p className="mt-2 px-1 text-[10px] text-dim">Large folder view truncated after the first 3000 files.</p>
          )}
        </div>
      </div>
    </div>
  );
}

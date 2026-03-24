import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
import {
  buildWorkspacePath,
  buildWorkspaceSearch,
  changeShortLabel,
  changeTone,
  collectDirectoryPaths,
  countVisibleTreeFiles,
  filterWorkspaceTree,
  normalizeWorkspaceRequestedFilePath,
  parentPaths,
  readWorkspaceChangeScopeFromSearch,
  readWorkspaceCwdFromSearch,
  readWorkspaceFileFromSearch,
  readWorkspaceModeFromPathname,
  summarizeChanges,
  syncWorkspaceExpandedPaths,
  WorkspaceTreeView,
} from '../workspaceBrowser';
import type { WorkspaceChangeKind, WorkspaceGitScope, WorkspaceGitStatusSummary } from '../types';
import { emitWorkspaceChanged, isWorkspaceEditorDirty, subscribeWorkspaceChanged, subscribeWorkspaceEditorDirty } from '../workspaceEvents';
import { ErrorState, LoadingState, Pill, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-md border border-border-default bg-base px-2.5 py-1.5 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const WORKSPACE_REFRESH_THROTTLE_MS = 1000;

interface WorkspaceGitRow {
  id: string;
  relativePath: string;
  scope: WorkspaceGitScope;
  change: WorkspaceChangeKind;
}

function buildGitRows(summary: WorkspaceGitStatusSummary | null | undefined): WorkspaceGitRow[] {
  if (!summary) {
    return [];
  }

  const rows: WorkspaceGitRow[] = [];
  for (const entry of summary.entries) {
    const conflicted = entry.stagedChange === 'conflicted' || entry.unstagedChange === 'conflicted';
    if (conflicted) {
      rows.push({ id: `conflicted:${entry.relativePath}`, relativePath: entry.relativePath, scope: 'conflicted', change: 'conflicted' });
      continue;
    }
    if (entry.stagedChange) {
      rows.push({ id: `staged:${entry.relativePath}`, relativePath: entry.relativePath, scope: 'staged', change: entry.stagedChange });
    }
    if (entry.unstagedChange === 'untracked') {
      rows.push({ id: `untracked:${entry.relativePath}`, relativePath: entry.relativePath, scope: 'untracked', change: 'untracked' });
      continue;
    }
    if (entry.unstagedChange) {
      rows.push({ id: `unstaged:${entry.relativePath}`, relativePath: entry.relativePath, scope: 'unstaged', change: entry.unstagedChange });
    }
  }

  return rows;
}

function filterGitRows(rows: WorkspaceGitRow[], query: string): WorkspaceGitRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => row.relativePath.toLowerCase().includes(normalizedQuery));
}

function groupGitRows(rows: WorkspaceGitRow[]): Array<{ key: WorkspaceGitScope; label: string; rows: WorkspaceGitRow[] }> {
  const conflicted = rows.filter((row) => row.scope === 'conflicted');
  const staged = rows.filter((row) => row.scope === 'staged');
  const unstaged = rows.filter((row) => row.scope === 'unstaged');
  const untracked = rows.filter((row) => row.scope === 'untracked');

  return [
    { key: 'conflicted' as const, label: 'Conflicted', rows: conflicted },
    { key: 'staged' as const, label: 'Staged', rows: staged },
    { key: 'unstaged' as const, label: 'Unstaged', rows: unstaged },
    { key: 'untracked' as const, label: 'Untracked', rows: untracked },
  ].filter((group) => group.rows.length > 0);
}

function stringSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function WorkspaceFilesRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedCwd = useMemo(() => readWorkspaceCwdFromSearch(location.search), [location.search]);
  const requestedFilePath = useMemo(() => readWorkspaceFileFromSearch(location.search), [location.search]);
  const [treeQuery, setTreeQuery] = useState('');
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(() => isWorkspaceEditorDirty());
  const lastWorkspaceRefreshAtRef = useRef(0);

  const snapshotApi = useApi(() => api.workspaceSnapshot(requestedCwd ?? undefined), requestedCwd ?? 'default');
  const snapshot = snapshotApi.data;
  const refreshSnapshot = snapshotApi.refetch;
  const selectedFilePath = useMemo(() => {
    if (!snapshot || !requestedFilePath) {
      return requestedFilePath;
    }

    return normalizeWorkspaceRequestedFilePath(snapshot.root, requestedFilePath);
  }, [requestedFilePath, snapshot?.root]);
  const expansionSeedRef = useRef<string | null>(null);

  useEffect(() => subscribeWorkspaceChanged(() => {
    void refreshSnapshot({ resetLoading: false });
  }), [refreshSnapshot]);

  const handleWorkspaceInvalidation = useCallback(async () => {
    const now = Date.now();
    if ((now - lastWorkspaceRefreshAtRef.current) < WORKSPACE_REFRESH_THROTTLE_MS) {
      return snapshot;
    }

    lastWorkspaceRefreshAtRef.current = now;
    return refreshSnapshot({ resetLoading: false });
  }, [refreshSnapshot, snapshot]);

  useInvalidateOnTopics(['workspace'], handleWorkspaceInvalidation);
  useEffect(() => subscribeWorkspaceEditorDirty(setDirty), []);

  useEffect(() => {
    const expansionSeed = snapshot ? `${snapshot.root}::${snapshot.focusPath ?? ''}` : null;
    const reset = expansionSeedRef.current !== expansionSeed;
    expansionSeedRef.current = expansionSeed;

    setExpandedPaths((prev) => {
      const next = syncWorkspaceExpandedPaths({
        previousPaths: prev,
        snapshot,
        selectedFilePath,
        reset,
      });

      return stringSetsEqual(prev, next) ? prev : next;
    });
  }, [selectedFilePath, snapshot]);

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

    navigate(buildWorkspacePath('files', buildWorkspaceSearch(location.search, { file: filePath, changeScope: null })));
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
          <p className="break-all text-[12px] text-dim">{snapshot.root}</p>
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
        <div className="shrink-0 border-b border-border-subtle px-3 py-1.5 text-[11px] text-dim">
          <div className="flex items-center justify-between gap-3">
            <span>{visibleFileCount} visible {visibleFileCount === 1 ? 'file' : 'files'}</span>
            {selectedFilePath && (
              <span className="max-w-[12rem] truncate text-[11px]" title={selectedFilePath}>{selectedFilePath}</span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filteredTree.length === 0 ? (
            <p className="px-1 text-[12px] text-dim">No files match the current filter.</p>
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
            <p className="mt-2 px-1 text-[11px] text-dim">Large folder view truncated after the first 3000 files.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceChangesRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedCwd = useMemo(() => readWorkspaceCwdFromSearch(location.search), [location.search]);
  const requestedFilePath = useMemo(() => readWorkspaceFileFromSearch(location.search), [location.search]);
  const requestedScope = useMemo(() => readWorkspaceChangeScopeFromSearch(location.search), [location.search]);
  const [query, setQuery] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationBusyId, setMutationBusyId] = useState<string | null>(null);
  const lastWorkspaceRefreshAtRef = useRef(0);

  const statusApi = useApi(() => api.workspaceGitStatus(requestedCwd ?? undefined), requestedCwd ?? 'default');
  const status = statusApi.data;
  const refreshStatus = statusApi.refetch;
  const rows = useMemo(() => buildGitRows(status), [status]);
  const filteredRows = useMemo(() => filterGitRows(rows, query), [query, rows]);
  const groupedRows = useMemo(() => groupGitRows(filteredRows), [filteredRows]);
  const selectedRowId = requestedFilePath && requestedScope ? `${requestedScope}:${requestedFilePath}` : null;

  useEffect(() => subscribeWorkspaceChanged(() => {
    void refreshStatus({ resetLoading: false });
  }), [refreshStatus]);

  const handleWorkspaceInvalidation = useCallback(async () => {
    const now = Date.now();
    if ((now - lastWorkspaceRefreshAtRef.current) < WORKSPACE_REFRESH_THROTTLE_MS) {
      return status;
    }

    lastWorkspaceRefreshAtRef.current = now;
    return refreshStatus({ resetLoading: false });
  }, [refreshStatus, status]);

  useInvalidateOnTopics(['workspace'], handleWorkspaceInvalidation);

  const applySelection = useCallback((row: WorkspaceGitRow) => {
    navigate(buildWorkspacePath('changes', buildWorkspaceSearch(location.search, {
      file: row.relativePath,
      changeScope: row.scope,
    })));
  }, [location.search, navigate]);

  const handleRowAction = useCallback(async (row: WorkspaceGitRow) => {
    if (row.scope === 'conflicted' || mutationBusyId) {
      return;
    }

    setMutationBusyId(row.id);
    setMutationError(null);
    try {
      if (row.scope === 'staged') {
        await api.workspaceGitUnstage(row.relativePath, status?.cwd ?? requestedCwd ?? undefined);
      } else {
        await api.workspaceGitStage(row.relativePath, status?.cwd ?? requestedCwd ?? undefined);
      }
      await refreshStatus({ resetLoading: false });
      emitWorkspaceChanged();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update git status.');
    } finally {
      setMutationBusyId(null);
    }
  }, [mutationBusyId, refreshStatus, requestedCwd, status?.cwd]);

  if (statusApi.loading && !status) {
    return <LoadingState label="Loading changes…" className="h-full justify-center" />;
  }

  if (statusApi.error && !status) {
    return <ErrorState className="m-4" message={`Unable to load changes: ${statusApi.error}`} />;
  }

  if (!status) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border-subtle px-3 py-3 space-y-2.5">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <p className="ui-card-title">Changes</p>
            {status.conflictedCount > 0 && <Pill tone="danger">{status.conflictedCount} conflicted</Pill>}
            <Pill tone={status.stagedCount > 0 ? 'accent' : 'muted'}>{status.stagedCount} staged</Pill>
          </div>
          <p className="break-all text-[12px] text-dim">{status.repoRoot ?? status.root}</p>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter changed files…"
          className={INPUT_CLASS}
          spellCheck={false}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={status.unstagedCount > 0 ? 'warning' : 'muted'}>{status.unstagedCount} unstaged</Pill>
          <Pill tone={status.untrackedCount > 0 ? 'teal' : 'muted'}>{status.untrackedCount} untracked</Pill>
          <ToolbarButton onClick={() => { void refreshStatus({ resetLoading: false }); }} disabled={statusApi.refreshing} className="ml-auto">
            {statusApi.refreshing ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        </div>
        {mutationError && <p className="text-[12px] text-danger">{mutationError}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border-subtle px-3 py-1.5 text-[11px] text-dim">
          <div className="flex items-center justify-between gap-3">
            <span>{filteredRows.length} visible {filteredRows.length === 1 ? 'change' : 'changes'}</span>
            {selectedRowId && (
              <span className="max-w-[12rem] truncate text-[11px]" title={selectedRowId}>{selectedRowId}</span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!status.repoRoot ? (
            <p className="px-1 text-[12px] text-dim">Open a git repository to review changes here.</p>
          ) : groupedRows.length === 0 ? (
            <p className="px-1 text-[12px] text-dim">No changed files match the current filter.</p>
          ) : (
            <div className="space-y-3">
              {groupedRows.map((group) => (
                <div key={group.key} className="space-y-1">
                  <div className="flex items-center gap-2 px-1 text-[11px] text-dim">
                    <span className="ui-section-label">{group.label}</span>
                    <span>{group.rows.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.rows.map((row) => {
                      const active = row.id === selectedRowId;
                      const actionLabel = row.scope === 'staged' ? 'Unstage' : row.scope === 'conflicted' ? null : 'Stage';
                      return (
                        <div key={row.id} className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => applySelection(row)}
                            className={[
                              'group flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] leading-5 transition-colors',
                              active ? 'bg-accent/10 text-primary' : 'text-secondary hover:bg-surface/80 hover:text-primary',
                            ].join(' ')}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold ${changeTone(row.change) === 'danger' ? 'bg-danger/12 text-danger' : changeTone(row.change) === 'teal' ? 'bg-teal/12 text-teal' : changeTone(row.change) === 'accent' ? 'bg-accent/12 text-accent' : 'bg-warning/12 text-warning'}`}>
                              {changeShortLabel(row.change)}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono" title={row.relativePath}>{row.relativePath}</span>
                            <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-dim">{row.scope}</span>
                          </button>
                          {actionLabel && (
                            <button
                              type="button"
                              aria-label={`${actionLabel} ${row.relativePath}`}
                              onClick={() => { void handleRowAction(row); }}
                              disabled={mutationBusyId !== null}
                              className="shrink-0 rounded-md px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {mutationBusyId === row.id ? '…' : actionLabel}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceRail() {
  const location = useLocation();
  const mode = useMemo(() => readWorkspaceModeFromPathname(location.pathname), [location.pathname]);
  return mode === 'changes' ? <WorkspaceChangesRail /> : <WorkspaceFilesRail />;
}

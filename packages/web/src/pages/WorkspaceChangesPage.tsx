import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BrowserSplitLayout } from '../components/BrowserSplitLayout';
import { useApi } from '../hooks';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
import { subscribeWorkspaceChanged, emitWorkspaceChanged } from '../workspaceEvents';
import {
  baseName,
  buildWorkspacePath,
  buildWorkspaceSearch,
  changeLabel,
  changeTone,
  readWorkspaceChangeScopeFromSearch,
  readWorkspaceCwdFromSearch,
  readWorkspaceFileFromSearch,
} from '../workspaceBrowser';
import { buildRailWidthStorageKey } from '../layoutSizing';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import type { WorkspaceChangeKind, WorkspaceCommitDraftResult, WorkspaceGitScope, WorkspaceGitStatusSummary } from '../types';
import { WorkspaceRail } from '../components/WorkspaceRail';
import { EmptyState, ErrorState, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] leading-6 text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const WORKSPACE_REFRESH_THROTTLE_MS = 1000;
const WORKSPACE_CHANGES_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('workspace-changes-browser');

interface WorkspaceGitRow {
  id: string;
  relativePath: string;
  scope: WorkspaceGitScope;
  change: WorkspaceChangeKind;
  exists: boolean;
  oldRelativePath: string | null;
}

function buildRows(summary: WorkspaceGitStatusSummary | null | undefined): WorkspaceGitRow[] {
  if (!summary) {
    return [];
  }

  const rows: WorkspaceGitRow[] = [];
  for (const entry of summary.entries) {
    const conflicted = entry.stagedChange === 'conflicted' || entry.unstagedChange === 'conflicted';
    if (conflicted) {
      rows.push({
        id: `conflicted:${entry.relativePath}`,
        relativePath: entry.relativePath,
        scope: 'conflicted',
        change: 'conflicted',
        exists: entry.exists,
        oldRelativePath: entry.oldRelativePath,
      });
      continue;
    }

    if (entry.stagedChange) {
      rows.push({
        id: `staged:${entry.relativePath}`,
        relativePath: entry.relativePath,
        scope: 'staged',
        change: entry.stagedChange,
        exists: entry.exists,
        oldRelativePath: entry.oldRelativePath,
      });
    }

    if (entry.unstagedChange === 'untracked') {
      rows.push({
        id: `untracked:${entry.relativePath}`,
        relativePath: entry.relativePath,
        scope: 'untracked',
        change: 'untracked',
        exists: entry.exists,
        oldRelativePath: entry.oldRelativePath,
      });
      continue;
    }

    if (entry.unstagedChange) {
      rows.push({
        id: `unstaged:${entry.relativePath}`,
        relativePath: entry.relativePath,
        scope: 'unstaged',
        change: entry.unstagedChange,
        exists: entry.exists,
        oldRelativePath: entry.oldRelativePath,
      });
    }
  }

  return rows;
}

function findSelectedRow(rows: WorkspaceGitRow[], requestedFilePath: string | null, requestedScope: WorkspaceGitScope | null): WorkspaceGitRow | null {
  if (!requestedFilePath) {
    return rows[0] ?? null;
  }

  if (requestedScope) {
    const exact = rows.find((row) => row.relativePath === requestedFilePath && row.scope === requestedScope) ?? null;
    if (exact) {
      return exact;
    }
  }

  return rows.find((row) => row.relativePath === requestedFilePath) ?? rows[0] ?? null;
}

function changeCountLabel(count: number, label: string): string {
  return `${count} ${label}`;
}

function rowActionLabel(scope: WorkspaceGitScope): string | null {
  if (scope === 'staged') {
    return 'Unstage';
  }

  if (scope === 'conflicted') {
    return null;
  }

  return 'Stage';
}

export function WorkspaceChangesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedCwd = useMemo(() => readWorkspaceCwdFromSearch(location.search), [location.search]);
  const requestedFilePath = useMemo(() => readWorkspaceFileFromSearch(location.search), [location.search]);
  const requestedScope = useMemo(() => readWorkspaceChangeScopeFromSearch(location.search), [location.search]);
  const [cwdDraft, setCwdDraft] = useState(requestedCwd ?? '');
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState(false);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSuggestion, setDraftSuggestion] = useState<WorkspaceCommitDraftResult | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitNotice, setCommitNotice] = useState<string | null>(null);
  const lastWorkspaceRefreshAtRef = useRef(0);

  const statusApi = useApi(() => api.workspaceGitStatus(requestedCwd ?? undefined), requestedCwd ?? 'default');
  const status = statusApi.data;
  const rows = useMemo(() => buildRows(status), [status]);
  const selectedRow = useMemo(
    () => findSelectedRow(rows, requestedFilePath, requestedScope),
    [requestedFilePath, requestedScope, rows],
  );
  const diffApi = useApi(
    () => (selectedRow ? api.workspaceGitDiff(selectedRow.relativePath, selectedRow.scope, status?.cwd ?? requestedCwd ?? undefined) : Promise.resolve(null)),
    `${status?.root ?? 'no-root'}::${selectedRow?.scope ?? 'none'}::${selectedRow?.relativePath ?? 'none'}`,
  );
  const diffDetail = diffApi.data;

  const openWorkspaceSearch = useCallback((patch: { cwd?: string | null; file?: string | null; changeScope?: WorkspaceGitScope | null }, replace = false) => {
    navigate(buildWorkspacePath('changes', buildWorkspaceSearch(location.search, patch)), { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    setCwdDraft(requestedCwd ?? status?.cwd ?? '');
  }, [requestedCwd, status?.cwd]);

  useEffect(() => {
    if (!status) {
      return;
    }

    if (!selectedRow) {
      if (requestedFilePath || requestedScope) {
        openWorkspaceSearch({ file: null, changeScope: null }, true);
      }
      return;
    }

    if (selectedRow.relativePath !== requestedFilePath || selectedRow.scope !== requestedScope) {
      openWorkspaceSearch({ file: selectedRow.relativePath, changeScope: selectedRow.scope }, true);
    }
  }, [openWorkspaceSearch, requestedFilePath, requestedScope, selectedRow, status]);

  const refreshStatusAndDiff = useCallback(async () => {
    const nextStatus = await statusApi.refetch({ resetLoading: false });
    const nextRows = buildRows(nextStatus ?? statusApi.data ?? null);
    const nextSelected = findSelectedRow(nextRows, requestedFilePath, requestedScope);
    if (!nextSelected) {
      return nextStatus;
    }

    await diffApi.refetch({ resetLoading: false });
    return nextStatus;
  }, [diffApi, requestedFilePath, requestedScope, statusApi]);

  useEffect(() => subscribeWorkspaceChanged(() => {
    void refreshStatusAndDiff();
  }), [refreshStatusAndDiff]);

  const handleWorkspaceInvalidation = useCallback(async () => {
    const now = Date.now();
    if ((now - lastWorkspaceRefreshAtRef.current) < WORKSPACE_REFRESH_THROTTLE_MS) {
      return status;
    }

    lastWorkspaceRefreshAtRef.current = now;
    return refreshStatusAndDiff();
  }, [refreshStatusAndDiff, status]);

  useInvalidateOnTopics(['workspace'], handleWorkspaceInvalidation);

  const handleWorkspaceSubmit = useCallback((event?: React.FormEvent) => {
    event?.preventDefault();
    const nextCwd = cwdDraft.trim();
    if (!nextCwd || nextCwd === requestedCwd) {
      return;
    }

    if (commitMessage.trim().length > 0 && !window.confirm('Discard the current commit draft and switch folders?')) {
      return;
    }

    setWorkspaceActionError(null);
    setCommitMessage('');
    setDraftSuggestion(null);
    openWorkspaceSearch({ cwd: nextCwd, file: null, changeScope: null });
  }, [commitMessage, cwdDraft, openWorkspaceSearch, requestedCwd]);

  const handleWorkspaceBrowse = useCallback(async () => {
    if (workspaceActionBusy) {
      return;
    }

    setWorkspaceActionBusy(true);
    setWorkspaceActionError(null);
    try {
      const result = await api.pickFolder(status?.cwd ?? requestedCwd ?? undefined);
      if (result.cancelled || !result.path) {
        return;
      }

      if (commitMessage.trim().length > 0 && !window.confirm('Discard the current commit draft and switch folders?')) {
        return;
      }

      setCommitMessage('');
      setDraftSuggestion(null);
      openWorkspaceSearch({ cwd: result.path, file: null, changeScope: null });
    } catch (error) {
      setWorkspaceActionError(error instanceof Error ? error.message : 'Could not choose a workspace.');
    } finally {
      setWorkspaceActionBusy(false);
    }
  }, [commitMessage, openWorkspaceSearch, requestedCwd, status?.cwd, workspaceActionBusy]);

  const runMutation = useCallback(async (action: () => Promise<unknown>) => {
    if (mutationBusy || commitBusy) {
      return;
    }

    setMutationBusy(true);
    setMutationError(null);
    setCommitNotice(null);
    try {
      await action();
      await refreshStatusAndDiff();
      emitWorkspaceChanged();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update git status.');
    } finally {
      setMutationBusy(false);
    }
  }, [commitBusy, mutationBusy, refreshStatusAndDiff]);

  const handleStageAll = useCallback(() => {
    void runMutation(() => api.workspaceGitStageAll(status?.cwd ?? requestedCwd ?? undefined));
  }, [requestedCwd, runMutation, status?.cwd]);

  const handleUnstageAll = useCallback(() => {
    void runMutation(() => api.workspaceGitUnstageAll(status?.cwd ?? requestedCwd ?? undefined));
  }, [requestedCwd, runMutation, status?.cwd]);

  const handleSelectedRowAction = useCallback(() => {
    if (!selectedRow || selectedRow.scope === 'conflicted') {
      return;
    }

    const request = selectedRow.scope === 'staged'
      ? () => api.workspaceGitUnstage(selectedRow.relativePath, status?.cwd ?? requestedCwd ?? undefined)
      : () => api.workspaceGitStage(selectedRow.relativePath, status?.cwd ?? requestedCwd ?? undefined);
    void runMutation(request);
  }, [requestedCwd, runMutation, selectedRow, status?.cwd]);

  const handleOpenInFiles = useCallback(() => {
    if (!selectedRow) {
      return;
    }

    navigate(buildWorkspacePath('files', buildWorkspaceSearch(location.search, {
      file: selectedRow.relativePath,
      changeScope: null,
    })));
  }, [location.search, navigate, selectedRow]);

  const handleDraftCommitMessage = useCallback(async () => {
    if (!status || status.stagedCount === 0 || draftBusy || commitBusy) {
      return;
    }

    setDraftBusy(true);
    setDraftError(null);
    setCommitNotice(null);
    try {
      const draft = await api.workspaceGitDraftCommitMessage(status.cwd);
      setDraftSuggestion(draft);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Could not draft a commit message.');
    } finally {
      setDraftBusy(false);
    }
  }, [commitBusy, draftBusy, status]);

  const handleCommit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!status || commitBusy || !message || status.stagedCount === 0 || status.conflictedCount > 0) {
      return;
    }

    setCommitBusy(true);
    setCommitError(null);
    setMutationError(null);
    try {
      const result = await api.workspaceGitCommit(message, status.cwd);
      setCommitNotice(`Committed ${result.commitSha.slice(0, 7)} — ${result.subject}`);
      setCommitMessage('');
      setDraftSuggestion(null);
      await refreshStatusAndDiff();
      emitWorkspaceChanged();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Could not create commit.');
    } finally {
      setCommitBusy(false);
    }
  }, [commitBusy, commitMessage, refreshStatusAndDiff, status]);

  useEffect(() => {
    if (!selectedRow) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLElement
        && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleCommit();
        return;
      }

      if (editing) {
        return;
      }

      const index = rows.findIndex((row) => row.id === selectedRow.id);
      if ((event.key === 'ArrowDown' || event.key === 'j') && index >= 0) {
        const next = rows[index + 1] ?? null;
        if (next) {
          event.preventDefault();
          openWorkspaceSearch({ file: next.relativePath, changeScope: next.scope });
        }
        return;
      }

      if ((event.key === 'ArrowUp' || event.key === 'k') && index >= 0) {
        const previous = rows[index - 1] ?? null;
        if (previous) {
          event.preventDefault();
          openWorkspaceSearch({ file: previous.relativePath, changeScope: previous.scope });
        }
        return;
      }

      if (event.key === 's') {
        event.preventDefault();
        handleSelectedRowAction();
        return;
      }

      if (event.key === 'e') {
        event.preventDefault();
        handleOpenInFiles();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCommit, handleOpenInFiles, handleSelectedRowAction, openWorkspaceSearch, rows, selectedRow]);

  const workspaceMeta = useMemo(() => {
    if (!status) {
      return 'Loading changes…';
    }

    if (!status.repoRoot) {
      return `${baseName(status.root)} · folder view`;
    }

    return [
      baseName(status.repoRoot),
      status.branch ? `branch ${status.branch}` : 'git status',
      changeCountLabel(status.stagedCount, status.stagedCount === 1 ? 'staged' : 'staged'),
      changeCountLabel(status.unstagedCount, status.unstagedCount === 1 ? 'unstaged' : 'unstaged'),
      changeCountLabel(status.untrackedCount, status.untrackedCount === 1 ? 'untracked' : 'untracked'),
    ].join(' · ');
  }, [status]);
  const workspaceShelfId = status?.repoRoot ?? status?.cwd ?? requestedCwd ?? null;

  useEffect(() => {
    if (!workspaceShelfId) {
      return;
    }

    ensureOpenResourceShelfItem('workspace', workspaceShelfId);
  }, [workspaceShelfId]);

  const selectedActionLabel = selectedRow ? rowActionLabel(selectedRow.scope) : null;

  return (
    <BrowserSplitLayout
      storageKey={WORKSPACE_CHANGES_BROWSER_WIDTH_STORAGE_KEY}
      initialWidth={352}
      minWidth={272}
      maxWidth={480}
      browser={<WorkspaceRail />}
      browserLabel="Workspace browser"
    >
      <div className="min-w-0 min-h-0 flex-1 flex flex-col">
        <PageHeader
          className="flex-wrap items-start gap-y-3"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <ToolbarButton onClick={() => navigate(buildWorkspacePath('files', buildWorkspaceSearch(location.search, { cwd: requestedCwd, file: requestedFilePath, changeScope: null })))}>
                Files
              </ToolbarButton>
              <ToolbarButton onClick={() => navigate(buildWorkspacePath('changes', buildWorkspaceSearch(location.search, { cwd: requestedCwd, file: requestedFilePath, changeScope: requestedScope })))}>
                Changes
              </ToolbarButton>
              <ToolbarButton onClick={() => { void refreshStatusAndDiff(); }} disabled={statusApi.refreshing || mutationBusy || commitBusy}>
                {statusApi.refreshing ? 'Refreshing…' : '↻ Refresh'}
              </ToolbarButton>
            </div>
          )}
        >
          <PageHeading title="Workspace" meta={workspaceMeta} />
        </PageHeader>

        <div className="border-b border-border-subtle px-6 py-3">
          <form className="flex flex-wrap items-center gap-2" onSubmit={handleWorkspaceSubmit}>
            <input
              value={cwdDraft}
              onChange={(event) => setCwdDraft(event.target.value)}
              placeholder={status?.cwd ?? 'Enter a folder path'}
              className={`${INPUT_CLASS} min-w-[18rem] flex-1 font-mono text-[12px]`}
              spellCheck={false}
            />
            <ToolbarButton type="button" onClick={() => { void handleWorkspaceBrowse(); }} disabled={workspaceActionBusy}>
              Browse…
            </ToolbarButton>
            <ToolbarButton type="submit" disabled={workspaceActionBusy || cwdDraft.trim().length === 0}>
              Open folder
            </ToolbarButton>
          </form>
          {status && (
            <p className="mt-2 text-[11px] text-dim">
              {status.repoRoot
                ? 'Review git changes for this workspace here while keeping the current CWD aligned. Use the browser on the left to switch files or jump back to Files.'
                : 'Changes are only available inside a git repository. Switch folders or use Files mode.'}
            </p>
          )}
          {workspaceActionError && <p className="mt-2 text-[12px] text-danger">{workspaceActionError}</p>}
        </div>

        {status && status.repoRoot && (
          <div className="border-b border-border-subtle px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {status.branch && <Pill tone="muted">{status.branch}</Pill>}
              <Pill tone={status.stagedCount > 0 ? 'accent' : 'muted'}>{status.stagedCount} staged</Pill>
              <Pill tone={status.unstagedCount > 0 ? 'warning' : 'muted'}>{status.unstagedCount} unstaged</Pill>
              <Pill tone={status.untrackedCount > 0 ? 'teal' : 'muted'}>{status.untrackedCount} untracked</Pill>
              {status.conflictedCount > 0 && <Pill tone="danger">{status.conflictedCount} conflicted</Pill>}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <ToolbarButton onClick={handleStageAll} disabled={mutationBusy || status.stagedCount + status.unstagedCount + status.untrackedCount === 0}>
                  Stage all
                </ToolbarButton>
                <ToolbarButton onClick={handleUnstageAll} disabled={mutationBusy || status.stagedCount === 0}>
                  Unstage all
                </ToolbarButton>
              </div>
            </div>
            {mutationError && <p className="mt-2 text-[12px] text-danger">{mutationError}</p>}
            {commitNotice && <p className="mt-2 text-[12px] text-teal">{commitNotice}</p>}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {statusApi.loading && !status && (
            <LoadingState label="Loading changes…" className="h-full justify-center" />
          )}

          {statusApi.error && !status && (
            <ErrorState className="m-6" message={`Unable to load changes: ${statusApi.error}`} />
          )}

          {status && !status.repoRoot && (
            <div className="flex h-full items-center justify-center px-8">
              <EmptyState title="Git repo required" body="Open a git repository to review changes, stage files, and create commits here." />
            </div>
          )}

          {status && status.repoRoot && rows.length === 0 && (
            <div className="flex h-full items-center justify-center px-8">
              <EmptyState title="Working tree clean" body="There are no staged, unstaged, or untracked changes to review right now." />
            </div>
          )}

          {status && status.repoRoot && rows.length > 0 && selectedRow && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 border-b border-border-subtle px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-mono text-[13px] text-primary" title={selectedRow.relativePath}>{selectedRow.relativePath}</p>
                      <Pill tone={changeTone(selectedRow.change)}>{changeLabel(selectedRow.change)}</Pill>
                      <Pill tone={selectedRow.scope === 'staged' ? 'accent' : selectedRow.scope === 'conflicted' ? 'danger' : selectedRow.scope === 'untracked' ? 'teal' : 'warning'}>{selectedRow.scope}</Pill>
                    </div>
                    <p className="text-[11px] text-dim">
                      {selectedRow.oldRelativePath ? `from ${selectedRow.oldRelativePath}` : selectedRow.exists ? 'File exists on disk' : 'Deleted from disk'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <ToolbarButton onClick={handleOpenInFiles}>Open in Files</ToolbarButton>
                    {selectedActionLabel && (
                      <ToolbarButton onClick={handleSelectedRowAction} disabled={mutationBusy || commitBusy}>
                        {selectedActionLabel}
                      </ToolbarButton>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden bg-panel">
                {diffApi.loading && !diffDetail ? (
                  <LoadingState label="Loading diff…" className="h-full justify-center" />
                ) : diffApi.error && !diffDetail ? (
                  <div className="p-6">
                    <ErrorState message={`Unable to load diff: ${diffApi.error}`} />
                  </div>
                ) : diffDetail ? (
                  diffDetail.diff.trim().length > 0 ? (
                    <pre className="h-full overflow-auto px-4 py-4 font-mono text-[12px] leading-6 text-secondary whitespace-pre-wrap break-words">{diffDetail.diff}</pre>
                  ) : (
                    <div className="flex h-full items-center justify-center px-8">
                      <EmptyState title="No diff output" body="Git returned no patch text for the selected change." />
                    </div>
                  )
                ) : null}
              </div>

              <div className="shrink-0 border-t border-border-subtle px-4 py-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="ui-section-label">Commit</p>
                    <p className="text-[11px] text-dim">Create a commit from the currently staged changes only.</p>
                  </div>
                  <p className="text-[11px] text-dim">Shortcuts: ↑/↓ or j/k · s stage toggle · e open in Files · ⌘/Ctrl+Enter commit</p>
                </div>

                <textarea
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Write a commit message…"
                  className={`${TEXTAREA_CLASS} min-h-[96px] font-mono text-[12px]`}
                  spellCheck={false}
                />

                {draftSuggestion && (
                  <div className="rounded-xl border border-border-subtle bg-surface/30 px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="ui-section-label">Suggested draft</p>
                      <Pill tone={draftSuggestion.source === 'ai' ? 'accent' : 'muted'}>{draftSuggestion.source === 'ai' ? 'AI' : 'fallback'}</Pill>
                    </div>
                    <pre className="font-mono text-[12px] leading-6 text-secondary whitespace-pre-wrap break-words">{draftSuggestion.message}</pre>
                    {draftSuggestion.notice && <p className="text-[11px] text-dim">{draftSuggestion.notice}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <ToolbarButton
                        onClick={() => {
                          setCommitMessage(draftSuggestion.message);
                          setCommitNotice(draftSuggestion.notice);
                          setDraftSuggestion(null);
                        }}
                      >
                        Use draft
                      </ToolbarButton>
                      <ToolbarButton onClick={() => setDraftSuggestion(null)}>Dismiss</ToolbarButton>
                    </div>
                  </div>
                )}

                {draftError && <p className="text-[12px] text-danger">{draftError}</p>}
                {commitError && <p className="text-[12px] text-danger">{commitError}</p>}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <ToolbarButton onClick={() => { void handleDraftCommitMessage(); }} disabled={draftBusy || commitBusy || status.stagedCount === 0}>
                    {draftBusy ? 'Drafting…' : 'Draft with AI'}
                  </ToolbarButton>
                  <ToolbarButton onClick={() => { void handleCommit(); }} disabled={commitBusy || status.stagedCount === 0 || status.conflictedCount > 0 || commitMessage.trim().length === 0}>
                    {commitBusy ? 'Committing…' : 'Commit'}
                  </ToolbarButton>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </BrowserSplitLayout>
  );
}

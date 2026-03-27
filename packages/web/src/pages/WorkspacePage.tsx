import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BrowserSplitLayout } from '../components/BrowserSplitLayout';
import { WorkspaceFileContent } from '../components/WorkspaceFileContent';
import { WorkspaceRail } from '../components/WorkspaceRail';
import { EmptyState, ErrorState, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton } from '../components/ui';
import { useApi } from '../hooks';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
import { buildRailWidthStorageKey } from '../layoutSizing';
import {
  baseName,
  buildWorkspacePath,
  buildWorkspaceSearch,
  changeLabel,
  changeTone,
  flattenFiles,
  formatFileSize,
  normalizeWorkspaceRequestedFilePath,
  readWorkspaceCwdFromSearch,
  readWorkspaceFileFromSearch,
  summarizeChanges,
  treeContainsPath,
} from '../workspaceBrowser';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import { emitWorkspaceChanged, setWorkspaceEditorDirty } from '../workspaceEvents';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const WORKSPACE_REFRESH_THROTTLE_MS = 1000;
const WORKSPACE_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('workspace-browser');

export function WorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();

  const requestedCwd = useMemo(() => readWorkspaceCwdFromSearch(location.search), [location.search]);
  const requestedFilePath = useMemo(() => readWorkspaceFileFromSearch(location.search), [location.search]);

  const snapshotApi = useApi(() => api.workspaceSnapshot(requestedCwd ?? undefined), requestedCwd ?? 'default');
  const snapshot = snapshotApi.data;
  const fileApi = useApi(
    async () => {
      if (!requestedFilePath) {
        return null;
      }

      const detail = await api.workspaceFile(requestedFilePath, snapshot?.cwd ?? requestedCwd ?? undefined);
      return { requestedFilePath, detail };
    },
    `${snapshot?.root ?? 'no-root'}::${requestedFilePath ?? 'no-file'}`,
  );
  const fileDetail = fileApi.data?.detail ?? null;
  const fileDetailMatchesRequest = fileApi.data?.requestedFilePath === requestedFilePath;

  const normalizedRequestedFilePath = useMemo(() => {
    if (!snapshot || !requestedFilePath) {
      return requestedFilePath;
    }

    return normalizeWorkspaceRequestedFilePath(snapshot.root, requestedFilePath);
  }, [requestedFilePath, snapshot?.root]);

  const selectedFilePath = useMemo(() => {
    if (normalizedRequestedFilePath && (!fileDetailMatchesRequest || fileDetail?.relativePath !== normalizedRequestedFilePath)) {
      return normalizedRequestedFilePath;
    }

    return fileDetail?.relativePath ?? normalizedRequestedFilePath;
  }, [fileDetail?.relativePath, fileDetailMatchesRequest, normalizedRequestedFilePath]);

  const [cwdDraft, setCwdDraft] = useState(requestedCwd ?? '');
  const [draftContent, setDraftContent] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalChangePending, setExternalChangePending] = useState(false);
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState(false);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null);
  const lastWorkspaceRefreshAtRef = useRef(0);

  const openWorkspaceSearch = useCallback((patch: { cwd?: string | null; file?: string | null }, replace = false) => {
    navigate(buildWorkspacePath('files', buildWorkspaceSearch(location.search, patch)), { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    setCwdDraft(requestedCwd ?? snapshot?.cwd ?? '');
  }, [requestedCwd, snapshot?.cwd]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (requestedFilePath && fileApi.loading && !fileDetail) {
      return;
    }

    if (selectedFilePath && treeContainsPath(snapshot.tree, selectedFilePath)) {
      return;
    }

    const fallbackPath = snapshot.changes[0]?.relativePath ?? flattenFiles(snapshot.tree)[0]?.relativePath ?? null;
    if (fallbackPath) {
      openWorkspaceSearch({ file: fallbackPath }, true);
      return;
    }

    if (requestedFilePath) {
      openWorkspaceSearch({ file: null }, true);
    }
  }, [fileApi.loading, fileDetail, openWorkspaceSearch, requestedFilePath, selectedFilePath, snapshot]);

  useEffect(() => {
    if (fileApi.loading || !fileDetailMatchesRequest || !fileDetail?.relativePath || !normalizedRequestedFilePath) {
      return;
    }

    if (fileDetail.relativePath !== normalizedRequestedFilePath) {
      openWorkspaceSearch({ file: fileDetail.relativePath }, true);
    }
  }, [fileApi.loading, fileDetail?.relativePath, fileDetailMatchesRequest, normalizedRequestedFilePath, openWorkspaceSearch]);

  useEffect(() => {
    if (fileDetail?.content !== null && fileDetail?.content !== undefined) {
      setDraftContent(fileDetail.content);
      setSaveError(null);
      setExternalChangePending(false);
      return;
    }

    setDraftContent('');
    setSaveError(null);
    setExternalChangePending(false);
  }, [fileDetail?.path, fileDetail?.content]);

  const draftDirty = useMemo(
    () => fileDetail?.content !== null && fileDetail?.content !== undefined && draftContent !== fileDetail.content,
    [draftContent, fileDetail],
  );

  useEffect(() => {
    setWorkspaceEditorDirty(draftDirty);
    return () => {
      setWorkspaceEditorDirty(false);
    };
  }, [draftDirty]);

  useEffect(() => {
    if (!draftDirty) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftDirty]);

  const handleSave = useCallback(async () => {
    if (!fileDetail || fileDetail.content === null || !selectedFilePath || saveBusy || !draftDirty) {
      return;
    }

    setSaveBusy(true);
    setSaveError(null);
    try {
      const saved = await api.workspaceFileSave(selectedFilePath, draftContent, snapshot?.cwd ?? requestedCwd ?? undefined);
      fileApi.replaceData({ requestedFilePath: requestedFilePath ?? selectedFilePath, detail: saved });
      await snapshotApi.refetch({ resetLoading: false });
      emitWorkspaceChanged();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the file.');
    } finally {
      setSaveBusy(false);
    }
  }, [draftContent, draftDirty, fileApi, fileDetail, requestedCwd, saveBusy, selectedFilePath, snapshot?.cwd, snapshotApi]);

  const handleRevert = useCallback(async () => {
    if (!selectedFilePath || !snapshot || saveBusy) {
      return;
    }

    if (draftDirty && !window.confirm('Discard your unsaved changes and reload this file from disk?')) {
      return;
    }

    setSaveError(null);
    await fileApi.refetch({ resetLoading: true });
    await snapshotApi.refetch({ resetLoading: false });
    emitWorkspaceChanged();
  }, [draftDirty, fileApi, saveBusy, selectedFilePath, snapshot, snapshotApi]);

  useEffect(() => {
    if (!selectedFilePath || !fileDetail) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fileDetail, handleSave, selectedFilePath]);

  const workspaceMeta = useMemo(() => {
    if (!snapshot) {
      return 'Loading workspace…';
    }

    return [
      snapshot.repoRoot ? baseName(snapshot.repoRoot) : baseName(snapshot.root),
      snapshot.branch ? `branch ${snapshot.branch}` : 'folder view',
      `${snapshot.fileCount} ${snapshot.fileCount === 1 ? 'file' : 'files'}`,
      summarizeChanges(snapshot.changedCount),
    ].join(' · ');
  }, [snapshot]);
  const workspaceShelfId = snapshot?.repoRoot ?? snapshot?.cwd ?? requestedCwd ?? null;

  useEffect(() => {
    if (!workspaceShelfId) {
      return;
    }

    ensureOpenResourceShelfItem('workspace', workspaceShelfId);
  }, [workspaceShelfId]);

  const showingFileLoadingState = Boolean(
    normalizedRequestedFilePath
      && (!fileDetailMatchesRequest || fileApi.loading || fileDetail?.relativePath !== normalizedRequestedFilePath),
  );

  const handleWorkspaceInvalidation = useCallback(async () => {
    const now = Date.now();
    if ((now - lastWorkspaceRefreshAtRef.current) < WORKSPACE_REFRESH_THROTTLE_MS) {
      return null;
    }

    lastWorkspaceRefreshAtRef.current = now;

    if (draftDirty) {
      setExternalChangePending(true);
      await snapshotApi.refetch({ resetLoading: false });
      return null;
    }

    const snapshotPromise = snapshotApi.refetch({ resetLoading: false });
    if (!selectedFilePath) {
      setExternalChangePending(false);
      return snapshotPromise;
    }

    const [, nextFile] = await Promise.all([
      snapshotPromise,
      fileApi.refetch({ resetLoading: false }),
    ]);
    if (nextFile) {
      setExternalChangePending(false);
    }
    return nextFile;
  }, [draftDirty, fileApi, selectedFilePath, snapshotApi]);

  useInvalidateOnTopics(['workspace'], handleWorkspaceInvalidation);

  const handleWorkspaceSubmit = useCallback((event?: React.FormEvent) => {
    event?.preventDefault();
    const nextCwd = cwdDraft.trim();
    if (!nextCwd || nextCwd === requestedCwd) {
      return;
    }

    if (draftDirty && !window.confirm('Discard unsaved changes in the current file and switch folders?')) {
      return;
    }

    setWorkspaceActionError(null);
    openWorkspaceSearch({ cwd: nextCwd, file: null });
  }, [cwdDraft, draftDirty, openWorkspaceSearch, requestedCwd]);

  const handleWorkspaceBrowse = useCallback(async () => {
    if (workspaceActionBusy) {
      return;
    }

    setWorkspaceActionBusy(true);
    setWorkspaceActionError(null);
    try {
      const result = await api.pickFolder(snapshot?.cwd ?? requestedCwd ?? undefined);
      if (result.cancelled || !result.path) {
        return;
      }

      if (draftDirty && !window.confirm('Discard unsaved changes in the current file and switch folders?')) {
        return;
      }

      openWorkspaceSearch({ cwd: result.path, file: null });
    } catch (error) {
      setWorkspaceActionError(error instanceof Error ? error.message : 'Could not choose a workspace.');
    } finally {
      setWorkspaceActionBusy(false);
    }
  }, [draftDirty, openWorkspaceSearch, requestedCwd, snapshot?.cwd, workspaceActionBusy]);

  return (
    <BrowserSplitLayout
      storageKey={WORKSPACE_BROWSER_WIDTH_STORAGE_KEY}
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
              <ToolbarButton onClick={() => navigate(buildWorkspacePath('files', buildWorkspaceSearch(location.search, { cwd: requestedCwd, file: selectedFilePath, changeScope: null })))}>
                Files
              </ToolbarButton>
              <ToolbarButton onClick={() => navigate(buildWorkspacePath('changes', buildWorkspaceSearch(location.search, { cwd: requestedCwd, file: selectedFilePath, changeScope: null })))}>
                Changes
              </ToolbarButton>
              <ToolbarButton onClick={() => { void snapshotApi.refetch({ resetLoading: false }); }} disabled={snapshotApi.refreshing || saveBusy}>
                {snapshotApi.refreshing ? 'Refreshing…' : '↻ Refresh'}
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
              placeholder={snapshot?.cwd ?? 'Enter a folder path'}
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
          {snapshot && (
            <p className="mt-2 text-[11px] text-dim">
              {snapshot.repoRoot
                ? 'Browsing the repo root so git status and file selection stay aligned. Use the workspace browser on the left to switch files or jump to Changes.'
                : 'Browsing this folder directly because no git repo was found. Use the workspace browser on the left to switch files.'}
            </p>
          )}
          {workspaceActionError && <p className="mt-2 text-[12px] text-danger">{workspaceActionError}</p>}
        </div>

        <div className="min-h-0 flex-1">
          {snapshotApi.loading && !snapshot && (
            <LoadingState label="Loading workspace…" className="h-full justify-center" />
          )}

          {snapshotApi.error && !snapshot && (
            <ErrorState className="m-6" message={`Unable to load workspace: ${snapshotApi.error}`} />
          )}

          {snapshot && !selectedFilePath && (
            <div className="flex h-full items-center justify-center px-8">
              <EmptyState title="Select a file" body="Choose a file from the workspace browser on the left." />
            </div>
          )}

          {selectedFilePath && showingFileLoadingState && (
            <LoadingState label="Loading file…" className="h-full justify-center" />
          )}

          {selectedFilePath && !showingFileLoadingState && fileApi.error && (
            <div className="p-6">
              <ErrorState message={`Unable to load file: ${fileApi.error}`} />
            </div>
          )}

          {selectedFilePath && !showingFileLoadingState && !fileApi.error && fileDetail && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 border-b border-border-subtle px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-mono text-[13px] text-primary" title={fileDetail.path}>{fileDetail.relativePath}</p>
                      {fileDetail.change && <Pill tone={changeTone(fileDetail.change)}>{changeLabel(fileDetail.change)}</Pill>}
                      {draftDirty && <Pill tone="warning">unsaved changes</Pill>}
                    </div>
                    <p className="text-[11px] text-dim">
                      {fileDetail.exists ? formatFileSize(fileDetail.sizeBytes) : 'Deleted from disk'}
                      {fileDetail.repoRoot && ` · ${baseName(fileDetail.repoRoot)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <ToolbarButton onClick={() => { void handleRevert(); }} disabled={saveBusy || fileApi.loading}>
                      Reload
                    </ToolbarButton>
                    <ToolbarButton onClick={() => { void handleSave(); }} disabled={saveBusy || !draftDirty || fileDetail.binary || fileDetail.tooLarge || !fileDetail.exists}>
                      {saveBusy ? 'Saving…' : 'Save'}
                    </ToolbarButton>
                  </div>
                </div>
                {saveError && <p className="mt-2 text-[12px] text-danger">{saveError}</p>}
                {externalChangePending && !saveError && (
                  <p className="mt-2 text-[12px] text-warning">
                    Files changed on disk. Save or reload this file to sync with the latest workspace state.
                  </p>
                )}
              </div>

              <WorkspaceFileContent
                detail={fileDetail}
                value={draftContent}
                draftDirty={draftDirty}
                onChange={setDraftContent}
                onOpenFilePath={(nextPath) => openWorkspaceSearch({ file: nextPath })}
              />
            </div>
          )}
        </div>
      </div>
    </BrowserSplitLayout>
  );
}

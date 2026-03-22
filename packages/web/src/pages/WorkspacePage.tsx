import { useCallback, useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useTheme } from '../theme';
import type { WorkspaceFileDetail } from '../types';
import {
  baseName,
  buildWorkspaceSearch,
  changeLabel,
  changeTone,
  editorChromeTheme,
  flattenFiles,
  formatFileSize,
  languageExtensionForPath,
  readWorkspaceCwdFromSearch,
  readWorkspaceFileFromSearch,
  summarizeChanges,
  treeContainsPath,
  WorkspaceWordDiffView,
} from '../workspaceBrowser';
import { emitWorkspaceChanged, setWorkspaceEditorDirty } from '../workspaceEvents';
import { EmptyState, ErrorState, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function fileBlockedReason(detail: WorkspaceFileDetail | null): string | null {
  if (!detail) {
    return null;
  }

  if (detail.binary) {
    return 'This file looks binary and cannot be edited here yet.';
  }

  if (detail.tooLarge) {
    return `This file is larger than ${formatFileSize(512 * 1024)} and was not loaded into the editor.`;
  }

  if (!detail.exists) {
    return 'This file was deleted in the working tree. Review the diff below to inspect the removal.';
  }

  return null;
}

function RawDiffFallback({ diff }: { diff: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface/30 overflow-hidden">
      <div className="border-b border-border-subtle bg-surface/70 px-4 py-2">
        <p className="ui-section-label">Raw diff fallback</p>
        <p className="text-[11px] text-dim">Word-level rendering was unavailable for this diff, so the unified patch is shown instead.</p>
      </div>
      <pre className="max-h-[24rem] overflow-auto px-4 py-3 font-mono text-[11px] leading-6 text-secondary whitespace-pre-wrap break-words">{diff}</pre>
    </div>
  );
}

export function WorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const requestedCwd = useMemo(() => readWorkspaceCwdFromSearch(location.search), [location.search]);
  const selectedFilePath = useMemo(() => readWorkspaceFileFromSearch(location.search), [location.search]);

  const snapshotApi = useApi(() => api.workspaceSnapshot(requestedCwd ?? undefined), requestedCwd ?? 'default');
  const snapshot = snapshotApi.data;
  const fileApi = useApi<WorkspaceFileDetail | null>(
    () => (selectedFilePath ? api.workspaceFile(selectedFilePath, snapshot?.cwd ?? requestedCwd ?? undefined) : Promise.resolve(null)),
    `${snapshot?.root ?? 'no-root'}::${selectedFilePath ?? 'no-file'}`,
  );
  const fileDetail = fileApi.data;

  const [cwdDraft, setCwdDraft] = useState(requestedCwd ?? '');
  const [draftContent, setDraftContent] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState(false);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null);

  useEffect(() => {
    setCwdDraft(requestedCwd ?? snapshot?.cwd ?? '');
  }, [requestedCwd, snapshot?.cwd]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (selectedFilePath && treeContainsPath(snapshot.tree, selectedFilePath)) {
      return;
    }

    const fallbackPath = snapshot.changes[0]?.relativePath ?? flattenFiles(snapshot.tree)[0]?.relativePath ?? null;
    if (fallbackPath) {
      navigate(`/workspace${buildWorkspaceSearch(location.search, { file: fallbackPath })}`, { replace: true });
      return;
    }

    if (selectedFilePath) {
      navigate(`/workspace${buildWorkspaceSearch(location.search, { file: null })}`, { replace: true });
    }
  }, [location.search, navigate, selectedFilePath, snapshot]);

  useEffect(() => {
    if (fileDetail?.content !== null && fileDetail?.content !== undefined) {
      setDraftContent(fileDetail.content);
      setSaveError(null);
      return;
    }

    setDraftContent('');
    setSaveError(null);
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
      fileApi.replaceData(saved);
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

  const editorExtensions = useMemo(() => {
    const extensions: Extension[] = [editorChromeTheme(theme === 'dark'), EditorView.lineWrapping];
    const languageExtension = selectedFilePath ? languageExtensionForPath(selectedFilePath) : null;
    if (languageExtension) {
      extensions.push(languageExtension);
    }
    return extensions;
  }, [selectedFilePath, theme]);

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

  const blockedReason = fileBlockedReason(fileDetail);
  const canRenderWordDiff = Boolean(
    fileDetail
    && fileDetail.change
    && fileDetail.originalContent !== null
    && (fileDetail.content !== null || !fileDetail.exists),
  );
  const currentDiffContent = fileDetail?.exists ? draftContent : '';
  const showingFileLoadingState = Boolean(selectedFilePath && fileApi.loading && fileDetail?.relativePath !== selectedFilePath);

  const openWorkspaceSearch = useCallback((patch: { cwd?: string | null; file?: string | null }, replace = false) => {
    navigate(`/workspace${buildWorkspaceSearch(location.search, patch)}`, { replace });
  }, [location.search, navigate]);

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

  const handleOpenInVscode = useCallback(async () => {
    if (!snapshot || workspaceActionBusy) {
      return;
    }

    setWorkspaceActionBusy(true);
    setWorkspaceActionError(null);
    try {
      const result = await api.run('code --reuse-window . || open -a "Visual Studio Code" .', snapshot.root);
      if (result.exitCode !== 0) {
        throw new Error(result.output.trim() || 'Unable to open VS Code.');
      }
    } catch (error) {
      setWorkspaceActionError(error instanceof Error ? error.message : 'Could not open VS Code.');
    } finally {
      setWorkspaceActionBusy(false);
    }
  }, [snapshot, workspaceActionBusy]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <>
            <ToolbarButton onClick={() => { void snapshotApi.refetch({ resetLoading: false }); }} disabled={snapshotApi.refreshing || saveBusy}>
              {snapshotApi.refreshing ? 'Refreshing…' : '↻ Refresh'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void handleOpenInVscode(); }} disabled={!snapshot || workspaceActionBusy}>
              {workspaceActionBusy ? 'Working…' : 'Open in VS Code'}
            </ToolbarButton>
          </>
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
              ? 'Browsing the repo root so git status and file selection stay aligned. The tree lives in the right panel.'
              : 'Browsing this folder directly because no git repo was found. The tree lives in the right panel.'}
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
            <EmptyState title="Select a file" body="Use the right-hand tree to open a file and inspect its diff." />
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
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {blockedReason ? (
                <div className="flex h-full items-center justify-center px-8 py-10">
                  <EmptyState title="Editor unavailable" body={blockedReason} />
                </div>
              ) : (
                <div className="h-full bg-panel">
                  <CodeMirror
                    value={draftContent}
                    onChange={setDraftContent}
                    extensions={editorExtensions}
                    className="h-full"
                  />
                </div>
              )}
            </div>

            {(fileDetail.change || fileDetail.diff) && (
              <div className="shrink-0 border-t border-border-subtle bg-surface/20 px-4 py-3 space-y-3">
                <div className="space-y-1">
                  <p className="ui-section-label">Diff</p>
                  <p className="text-[11px] text-dim">
                    {draftDirty
                      ? 'Word-level diff compares the last saved file on disk with the committed baseline. Save to update it.'
                      : 'Word-level diff compares the current file with the committed baseline.'}
                  </p>
                </div>

                {canRenderWordDiff
                  ? <WorkspaceWordDiffView originalContent={fileDetail.originalContent ?? ''} currentContent={fileDetail.exists ? currentDiffContent : ''} />
                  : fileDetail.diff
                    ? <RawDiffFallback diff={fileDetail.diff} />
                    : <p className="text-[12px] text-dim">No diff available for this file.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { type ExtensionSurfaceProps, WorkspaceExplorer, WorkspaceFileDocument } from '@personal-agent/extensions/workbench';
import { Suspense, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const WORKSPACE_DRAFT_PROMPT_EVENT = 'pa:workspace-draft-prompt';
const WORKSPACE_REPLY_SELECTION_EVENT = 'pa:workspace-reply-selection';
const WORKSPACE_FILE_PARAM = 'workspaceFile';

function getWorkspaceFilePath(search: string): string | null {
  return new URLSearchParams(search).get(WORKSPACE_FILE_PARAM);
}

export function WorkspaceFilesPanel({ context }: ExtensionSurfaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilePath = getWorkspaceFilePath(searchParams.toString());
  const handleOpenFile = useCallback(
    (file: { cwd: string; path: string }) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('file');
        next.delete('artifact');
        next.delete('checkpoint');
        next.delete('run');
        next.set(WORKSPACE_FILE_PARAM, file.path);
        return next;
      });
    },
    [setSearchParams],
  );
  const handleCloseFile = useCallback(
    (path: string | null) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (!path || next.get(WORKSPACE_FILE_PARAM) === path) {
          next.delete(WORKSPACE_FILE_PARAM);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  if (!context.cwd) {
    return <div className="px-4 py-5 text-[12px] text-dim">Open a local conversation to browse its workspace.</div>;
  }

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading workspace…</div>}>
      <WorkspaceExplorer
        cwd={context.cwd}
        railOnly
        activeFilePath={activeFilePath}
        onOpenFile={handleOpenFile}
        onCloseFile={handleCloseFile}
        onDraftPrompt={(prompt) => {
          window.dispatchEvent(new CustomEvent(WORKSPACE_DRAFT_PROMPT_EVENT, { detail: { prompt } }));
        }}
      />
    </Suspense>
  );
}

export function WorkspaceFileDetailPanel({ context }: ExtensionSurfaceProps) {
  const filePath = getWorkspaceFilePath(context.search);

  if (!context.cwd) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open a local conversation</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">Open a local conversation to browse its workspace.</p>
        </div>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open a file</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">Pick a file from the right rail to keep it beside the transcript.</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Opening file…</div>}>
      <WorkspaceFileDocument
        cwd={context.cwd}
        path={filePath}
        onReplyWithSelection={(selection) => {
          window.dispatchEvent(new CustomEvent(WORKSPACE_REPLY_SELECTION_EVENT, { detail: selection }));
        }}
      />
    </Suspense>
  );
}

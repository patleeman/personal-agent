import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { ConversationFileTarget } from '../conversationFiles';
import { baseName, changeLabel, changeTone, formatFileSize } from '../workspaceBrowser';
import { ErrorState, LoadingState, Pill } from './ui';
import { WorkspaceFileContent } from './WorkspaceFileContent';

export function ConversationFileModal({
  target,
  workspaceHref,
  onClose,
  onOpenFilePath,
}: {
  target: ConversationFileTarget;
  workspaceHref: string;
  onClose: () => void;
  onOpenFilePath?: (path: string) => void;
}) {
  const fileApi = useApi(
    () => api.workspaceFile(target.file, target.cwd),
    `${target.cwd}::${target.file}`,
  );
  const detail = fileApi.data;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const modalLabel = useMemo(
    () => detail?.relativePath ?? target.file,
    [detail?.relativePath, target.file],
  );

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`File preview: ${modalLabel}`}
        className="ui-dialog-shell"
        style={{ maxWidth: 'min(1200px, calc(100vw - 3rem))', height: 'calc(100vh - 5rem)' }}
      >
        <div className="shrink-0 border-b border-border-subtle px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-mono text-[13px] text-primary" title={detail?.path ?? target.file}>
                  {detail?.relativePath ?? target.file}
                </p>
                {detail?.change && <Pill tone={changeTone(detail.change)}>{changeLabel(detail.change)}</Pill>}
              </div>
              <p className="text-[11px] text-dim">
                {detail
                  ? `${detail.exists ? formatFileSize(detail.sizeBytes) : 'Deleted from disk'}${detail.repoRoot ? ` · ${baseName(detail.repoRoot)}` : ''}`
                  : target.cwd}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Link to={workspaceHref} className="ui-toolbar-button text-accent">
                Open in File Explorer
              </Link>
              <button type="button" onClick={onClose} className="ui-toolbar-button">
                Close
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {fileApi.loading && !detail && (
            <LoadingState label="Loading file…" className="h-full justify-center" />
          )}

          {fileApi.error && !detail && (
            <div className="p-6">
              <ErrorState message={`Unable to load file: ${fileApi.error}`} />
            </div>
          )}

          {detail && (
            <WorkspaceFileContent
              detail={detail}
              value={detail.content ?? ''}
              readOnly
              onOpenFilePath={onOpenFilePath}
            />
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  getConversationCheckpointFileFromSearch,
  setConversationCheckpointFileInSearch,
  setConversationCheckpointIdInSearch,
} from '../conversationCheckpoints';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type { ConversationCommitCheckpointFile } from '../types';
import { formatDate } from '../utils';
import { ErrorState, LoadingState, cx } from './ui';

type ParsedPatchLine = {
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'del';
  oldNumber?: number | null;
  newNumber?: number | null;
  text: string;
};

function parsePatchLines(patch: string): ParsedPatchLine[] {
  const output: ParsedPatchLine[] = [];
  let oldLineNumber: number | null = null;
  let newLineNumber: number | null = null;

  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.length === 0 && output.length > 0 && output[output.length - 1]?.text === '') {
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLineNumber = Number.parseInt(hunkMatch[1] as string, 10);
      newLineNumber = Number.parseInt(hunkMatch[2] as string, 10);
      output.push({ kind: 'hunk', text: line });
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      output.push({ kind: 'add', oldNumber: null, newNumber: newLineNumber, text: line });
      newLineNumber = (newLineNumber ?? 0) + 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      output.push({ kind: 'del', oldNumber: oldLineNumber, newNumber: null, text: line });
      oldLineNumber = (oldLineNumber ?? 0) + 1;
      continue;
    }

    if (line.startsWith(' ')) {
      output.push({ kind: 'context', oldNumber: oldLineNumber, newNumber: newLineNumber, text: line });
      oldLineNumber = (oldLineNumber ?? 0) + 1;
      newLineNumber = (newLineNumber ?? 0) + 1;
      continue;
    }

    output.push({ kind: 'meta', text: line });
  }

  return output;
}

function statusLabel(file: ConversationCommitCheckpointFile): string {
  switch (file.status) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'typechange':
      return 'Type change';
    case 'unmerged':
      return 'Unmerged';
    case 'modified':
      return 'Modified';
    default:
      return 'Changed';
  }
}

function fileDisplayPath(file: ConversationCommitCheckpointFile): string {
  return file.previousPath && file.previousPath !== file.path
    ? `${file.previousPath} → ${file.path}`
    : file.path;
}

export function ConversationCheckpointModal({
  conversationId,
  checkpointId,
}: {
  conversationId: string;
  checkpointId: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { versions } = useAppEvents();
  const [copied, setCopied] = useState(false);

  const checkpointFetcher = useCallback(() => api.conversationCheckpoint(conversationId, checkpointId), [checkpointId, conversationId]);
  const {
    data,
    loading,
    error,
    refetch,
  } = useApi(checkpointFetcher, `${conversationId}:checkpoint:${checkpointId}`);

  useEffect(() => {
    setCopied(false);
  }, [checkpointId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const closeCheckpoint = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: setConversationCheckpointIdInSearch(location.search, null),
    });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeCheckpoint();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeCheckpoint]);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [refetch, versions.checkpoints]);

  const checkpoint = data?.checkpoint ?? null;
  const selectedFilePath = getConversationCheckpointFileFromSearch(location.search);
  const selectedFile = checkpoint?.files.find((file) => file.path === selectedFilePath)
    ?? checkpoint?.files[0]
    ?? null;
  const selectedFilePatchLines = useMemo(
    () => (selectedFile ? parsePatchLines(selectedFile.patch) : []),
    [selectedFile],
  );

  async function copyCommitSha() {
    if (!checkpoint) {
      return;
    }

    await navigator.clipboard.writeText(checkpoint.commitSha);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const openFile = useCallback((filePath: string) => {
    navigate({
      pathname: location.pathname,
      search: setConversationCheckpointFileInSearch(location.search, filePath),
    });
  }, [location.pathname, location.search, navigate]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeCheckpoint();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conversation checkpoint review"
        className="ui-dialog-shell"
        style={{ width: 'min(1360px, calc(100vw - 3rem))', height: 'min(88vh, 980px)', maxHeight: 'calc(100vh - 3rem)' }}
      >
        <div className="border-b border-border-subtle px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim/80">
                <span>Checkpoint</span>
                {checkpoint ? <span className="font-mono text-primary/75 normal-case tracking-normal">{checkpoint.shortSha}</span> : null}
              </div>
              <h2 className="mt-1 truncate text-[15px] font-semibold text-primary" title={checkpoint?.subject ?? checkpointId}>
                {checkpoint?.subject ?? checkpointId}
              </h2>
              {checkpoint ? (
                <p className="mt-1 text-[12px] text-secondary">
                  {checkpoint.fileCount} file{checkpoint.fileCount === 1 ? '' : 's'} · <span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span> · committed {formatDate(checkpoint.committedAt)}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {checkpoint ? (
                <button type="button" onClick={() => { void copyCommitSha(); }} className="ui-toolbar-button px-2 py-1 text-[10px]">
                  {copied ? 'copied' : 'copy sha'}
                </button>
              ) : null}
              <button type="button" onClick={closeCheckpoint} className="ui-toolbar-button px-2 py-1 text-[10px]">close</button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex flex-1 overflow-hidden bg-base">
          <aside className="flex w-80 shrink-0 flex-col border-r border-border-subtle bg-base/50">
            <div className="border-b border-border-subtle px-4 py-3">
              <p className="ui-section-label">Files</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {checkpoint?.files.length ? checkpoint.files.map((file) => {
                const selected = selectedFile?.path === file.path;
                return (
                  <button
                    key={`${file.path}:${file.previousPath ?? ''}`}
                    type="button"
                    onClick={() => openFile(file.path)}
                    className={cx(
                      'w-full rounded-xl px-3 py-2.5 text-left transition-colors',
                      selected ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium" title={fileDisplayPath(file)}>{fileDisplayPath(file)}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-dim/80">{statusLabel(file)}</p>
                      </div>
                      <div className="shrink-0 text-right text-[10px] font-mono tabular-nums">
                        <div className="text-success">+{file.additions}</div>
                        <div className="text-danger">-{file.deletions}</div>
                      </div>
                    </div>
                  </button>
                );
              }) : (
                <p className="px-2 py-3 text-[12px] text-dim">No changed files were captured for this checkpoint.</p>
              )}
            </div>
          </aside>

          <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
            {loading && !checkpoint ? (
              <LoadingState label="Loading checkpoint…" className="justify-center h-full" />
            ) : error || !checkpoint ? (
              <ErrorState message={error || 'Checkpoint not found.'} className="px-4 py-4" />
            ) : !selectedFile ? (
              <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">No file selected.</div>
            ) : (
              <>
                <div className="border-b border-border-subtle px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-primary" title={fileDisplayPath(selectedFile)}>{fileDisplayPath(selectedFile)}</p>
                      <p className="mt-0.5 text-[11px] text-secondary">{statusLabel(selectedFile)} · <span className="font-mono text-success">+{selectedFile.additions}</span> <span className="font-mono text-danger">-{selectedFile.deletions}</span></p>
                    </div>
                    <p className="text-[11px] text-dim">{checkpoint.authorName}{checkpoint.authorEmail ? ` · ${checkpoint.authorEmail}` : ''}</p>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-elevated/20">
                  <table className="min-w-full border-collapse font-mono text-[11px] leading-5 text-primary">
                    <tbody>
                      {selectedFilePatchLines.map((line, index) => {
                        const toneClass = line.kind === 'add'
                          ? 'bg-success/8 text-success'
                          : line.kind === 'del'
                            ? 'bg-danger/8 text-danger'
                            : line.kind === 'hunk'
                              ? 'bg-accent/8 text-accent'
                              : line.kind === 'meta'
                                ? 'bg-base/60 text-secondary'
                                : '';

                        return (
                          <tr key={`${selectedFile.path}:${index}`} className={cx('border-b border-border-subtle/60 align-top', toneClass)}>
                            <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{line.oldNumber ?? ''}</td>
                            <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{line.newNumber ?? ''}</td>
                            <td className="whitespace-pre-wrap break-all px-3 py-1">{line.text || ' '}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

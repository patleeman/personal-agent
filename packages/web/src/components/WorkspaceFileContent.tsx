import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { unifiedMergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { useTheme } from '../theme';
import type { WorkspaceFileDetail } from '../types';
import {
  buildWorkspaceFileAssetUrl,
  editorChromeTheme,
  formatFileSize,
  languageExtensionForPath,
  type WorkspaceFilePreviewKind,
  getWorkspaceFilePreviewKind,
} from '../workspaceBrowser';
import { FilePathPreformattedText } from '../filePathLinks';
import { EmptyState } from './ui';

function fileBlockedReason(detail: WorkspaceFileDetail, previewKind: WorkspaceFilePreviewKind | null): string | null {
  if (!detail.exists) {
    return 'This file was deleted in the working tree. Review the diff below to inspect the removal.';
  }

  if (detail.binary && !previewKind) {
    return 'This file looks binary and cannot be previewed here.';
  }

  if (detail.tooLarge && !previewKind) {
    return `This file is larger than ${formatFileSize(512 * 1024)} and was not loaded into the editor.`;
  }

  return null;
}

function inlineDiffOriginalContent(detail: WorkspaceFileDetail, value: string, draftDirty: boolean): string | null {
  if (detail.binary || detail.tooLarge || !detail.exists) {
    return null;
  }

  if (detail.originalContent !== null) {
    return detail.originalContent;
  }

  if (draftDirty && detail.content !== null) {
    return detail.content;
  }

  return null;
}

function inlineDiffDescription(detail: WorkspaceFileDetail, draftDirty: boolean, originalContent: string | null): string | null {
  if (originalContent === null) {
    return null;
  }

  if (detail.originalContent !== null) {
    if (detail.change === 'added' || detail.change === 'untracked') {
      return draftDirty
        ? 'Inline diff markers show your draft as a new file against an empty baseline.'
        : 'Inline diff markers show this file as a new addition against an empty baseline.';
    }

    return draftDirty
      ? 'Inline diff markers compare your draft with the committed baseline.'
      : 'Inline diff markers compare this file with the committed baseline.';
  }

  return 'Inline diff markers show unsaved edits against the last saved file on disk.';
}

function WorkspaceMediaPreview({
  previewKind,
  previewUrl,
  label,
}: {
  previewKind: WorkspaceFilePreviewKind;
  previewUrl: string;
  label: string;
}) {
  if (previewKind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-panel p-6">
        <img src={previewUrl} alt={label} className="max-h-full max-w-full rounded-xl border border-border-subtle bg-base shadow-lg" />
      </div>
    );
  }

  if (previewKind === 'video') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-panel p-6">
        <video src={previewUrl} controls className="max-h-full max-w-full rounded-xl border border-border-subtle bg-base shadow-lg" />
      </div>
    );
  }

  if (previewKind === 'audio') {
    return (
      <div className="flex h-full items-center justify-center bg-panel p-6">
        <audio src={previewUrl} controls className="w-full max-w-2xl" />
      </div>
    );
  }

  return (
    <div className="h-full bg-panel">
      <iframe title={label} src={previewUrl} className="h-full w-full border-0" />
    </div>
  );
}

export function WorkspaceFileContent({
  detail,
  value,
  draftDirty = false,
  readOnly = false,
  onChange,
  onOpenFilePath,
}: {
  detail: WorkspaceFileDetail;
  value: string;
  draftDirty?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onOpenFilePath?: (path: string) => void;
}) {
  const { theme } = useTheme();
  const previewKind = useMemo(() => getWorkspaceFilePreviewKind(detail.path), [detail.path]);
  const mergeOriginalContent = useMemo(
    () => inlineDiffOriginalContent(detail, value, draftDirty),
    [detail, draftDirty, value],
  );
  const description = useMemo(
    () => inlineDiffDescription(detail, draftDirty, mergeOriginalContent),
    [detail, draftDirty, mergeOriginalContent],
  );
  const blockedReason = useMemo(
    () => fileBlockedReason(detail, previewKind),
    [detail, previewKind],
  );
  const showPreview = Boolean(detail.exists && previewKind && detail.content === null);
  const previewUrl = showPreview ? buildWorkspaceFileAssetUrl(detail.path, detail.cwd) : null;
  const showRawDiffFallback = Boolean(detail.diff) && mergeOriginalContent === null;

  const editorExtensions = useMemo(() => {
    const extensions: Extension[] = [editorChromeTheme(theme === 'dark'), EditorView.lineWrapping];
    const languageExtension = languageExtensionForPath(detail.path);
    if (languageExtension) {
      extensions.push(languageExtension);
    }
    if (mergeOriginalContent !== null) {
      extensions.push(unifiedMergeView({
        original: mergeOriginalContent,
        gutter: true,
        highlightChanges: true,
        allowInlineDiffs: true,
        syntaxHighlightDeletions: false,
        mergeControls: false,
      }));
    }
    return extensions;
  }, [detail.path, mergeOriginalContent, theme]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {description && (
        <div className="shrink-0 border-b border-border-subtle bg-surface/20 px-4 py-2.5">
          <p className="text-[11px] text-dim">{description}</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {previewKind && previewUrl ? (
          <WorkspaceMediaPreview previewKind={previewKind} previewUrl={previewUrl} label={detail.relativePath} />
        ) : blockedReason ? (
          <div className="flex h-full items-center justify-center px-8 py-10">
            <EmptyState title="Preview unavailable" body={blockedReason} />
          </div>
        ) : (
          <div className="h-full bg-panel">
            <CodeMirror
              value={value}
              onChange={onChange ?? (() => undefined)}
              extensions={editorExtensions}
              editable={!readOnly}
              readOnly={readOnly}
              className="h-full"
            />
          </div>
        )}
      </div>

      {showRawDiffFallback && (
        <div className="shrink-0 border-t border-border-subtle bg-surface/20 px-4 py-3 space-y-3">
          <div className="space-y-1">
            <p className="ui-section-label">Patch</p>
            <p className="text-[11px] text-dim">
              The inline editor diff is unavailable for this file, so the raw patch is shown instead.
            </p>
          </div>

          <FilePathPreformattedText
            text={detail.diff ?? ''}
            onOpenFilePath={onOpenFilePath}
            className="max-h-[24rem] overflow-auto rounded-xl border border-border-subtle bg-surface/30 px-4 py-3 font-mono text-[11px] leading-6 text-secondary whitespace-pre-wrap break-words"
          />
        </div>
      )}
    </div>
  );
}

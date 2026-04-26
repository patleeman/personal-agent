import { useMemo, type CSSProperties } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import type { FileDiffOptions } from '@pierre/diffs';
import type { ConversationCommitCheckpointFile } from '../../shared/types';
import { cx } from '../ui';

const checkpointDiffStyle = {
  '--diffs-font-family': 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace)',
  '--diffs-header-font-family': 'var(--font-sans, Inter, ui-sans-serif, system-ui, sans-serif)',
  '--diffs-font-size': '11px',
  '--diffs-line-height': '1.45',
  '--diffs-tab-size': '2',
} as CSSProperties;

export function statusLabel(file: ConversationCommitCheckpointFile): string {
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

export function fileDisplayPath(file: ConversationCommitCheckpointFile): string {
  return file.previousPath && file.previousPath !== file.path
    ? `${file.previousPath} → ${file.path}`
    : file.path;
}

export function CheckpointDiffSection({
  file,
  active = false,
  view,
  registerSection,
  stickyHeader = false,
  showActiveBadge = false,
  sectionClassName,
}: {
  file: ConversationCommitCheckpointFile;
  active?: boolean;
  view: 'unified' | 'split';
  registerSection?: (node: HTMLDivElement | null) => void;
  stickyHeader?: boolean;
  showActiveBadge?: boolean;
  sectionClassName?: string;
}) {
  const diffOptions = useMemo<FileDiffOptions<undefined>>(() => ({
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'system',
    diffStyle: view,
    diffIndicators: 'classic',
    disableFileHeader: true,
    hunkSeparators: 'metadata',
    lineDiffType: 'word-alt',
    overflow: 'wrap',
  }), [view]);

  return (
    <section
      ref={registerSection}
      data-checkpoint-file-path={file.path}
      className={cx('scroll-mt-4 border-b border-border-subtle/80', active && 'bg-accent/3', sectionClassName)}
    >
      <div
        className={cx(
          'border-b border-border-subtle/60 px-4 py-3',
          stickyHeader && 'sticky top-0 z-10 bg-base/95 backdrop-blur supports-[backdrop-filter]:bg-base/88',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-primary" title={fileDisplayPath(file)}>{fileDisplayPath(file)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-secondary">
              <span>{statusLabel(file)}</span>
              <span className="font-mono tabular-nums"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
            </p>
          </div>
          {showActiveBadge && active ? <span className="text-[10px] uppercase tracking-[0.14em] text-accent">Current</span> : null}
        </div>
      </div>
      <div className="overflow-hidden bg-elevated/10">
        <PatchDiff
          key={`${file.path}:${view}`}
          patch={file.patch}
          options={diffOptions}
          style={checkpointDiffStyle}
        />
      </div>
    </section>
  );
}

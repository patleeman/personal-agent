import { useMemo, type CSSProperties } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import type { FileDiffOptions } from '@pierre/diffs';
import type { ConversationCommitCheckpointFile } from '../../shared/types';
import { useTheme } from '../../ui-state/theme';
import { cx } from '../ui';

const checkpointDiffStyle = {
  '--diffs-font-family': 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace)',
  '--diffs-header-font-family': 'var(--font-sans, Inter, ui-sans-serif, system-ui, sans-serif)',
  '--diffs-font-size': '11px',
  '--diffs-line-height': '1.45',
  '--diffs-tab-size': '2',
  '--diffs-bg-context-override': 'rgb(var(--color-terminal-surface))',
  '--diffs-bg-separator-override': 'rgb(var(--color-surface))',
  '--diffs-bg-buffer-override': 'rgb(var(--color-elevated) / 0.45)',
  '--diffs-bg-hover-override': 'rgb(var(--color-hover))',
  '--diffs-fg-number-override': 'rgb(var(--color-dim))',
  '--diffs-addition-color-override': 'rgb(var(--color-success))',
  '--diffs-deletion-color-override': 'rgb(var(--color-danger))',
  '--diffs-modified-color-override': 'rgb(var(--color-steel))',
  '--diffs-bg-addition-override': 'rgb(var(--color-success) / 0.16)',
  '--diffs-bg-addition-number-override': 'rgb(var(--color-success) / 0.10)',
  '--diffs-bg-deletion-override': 'rgb(var(--color-danger) / 0.16)',
  '--diffs-bg-deletion-number-override': 'rgb(var(--color-danger) / 0.10)',
  '--diffs-bg-addition-emphasis-override': 'rgb(var(--color-success) / 0.24)',
  '--diffs-bg-deletion-emphasis-override': 'rgb(var(--color-danger) / 0.24)',
} as CSSProperties;

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
  const { theme } = useTheme();
  const diffOptions = useMemo<FileDiffOptions<undefined>>(() => ({
    theme: { dark: 'tokyo-night', light: 'github-light' },
    themeType: theme,
    diffStyle: view,
    diffIndicators: 'classic',
    disableFileHeader: true,
    hunkSeparators: 'metadata',
    lineDiffType: 'word-alt',
    overflow: 'wrap',
  }), [theme, view]);

  return (
    <section
      ref={registerSection}
      data-checkpoint-file-path={file.path}
      className={cx('mb-4 scroll-mt-4 overflow-hidden rounded-lg border border-border-subtle/80 bg-base/80 shadow-[0_18px_50px_rgba(0,0,0,0.14)]', active && 'border-accent/30', sectionClassName)}
    >
      <div
        className={cx(
          'border-b border-border-subtle/60 bg-elevated/35 px-4 py-2.5',
          stickyHeader && 'sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-elevated/80',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[12px] text-primary" title={fileDisplayPath(file)}>{fileDisplayPath(file)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-secondary">
              <span className="uppercase tracking-[0.14em] text-dim/80">{statusLabel(file)}</span>
              <span className="font-mono tabular-nums"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
            </p>
          </div>
          {showActiveBadge && active ? <span className="text-[10px] uppercase tracking-[0.14em] text-accent">Current</span> : null}
        </div>
      </div>
      <div className="overflow-hidden bg-[rgb(var(--color-terminal-surface))]">
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

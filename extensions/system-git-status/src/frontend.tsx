import type { ExtensionStatusBarItemProps } from '@personal-agent/extensions';
import React from 'react';

export function GitStatusIndicator({ statusBarContext }: ExtensionStatusBarItemProps) {
  const branchLabel = statusBarContext.branchLabel?.trim() || null;
  const gitSummary = statusBarContext.gitSummary;
  const hasGitSummary = gitSummary && gitSummary.kind !== 'none';

  if (!branchLabel && !hasGitSummary) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 text-right" aria-label="Git status">
      {branchLabel ? (
        <span className="max-w-[8rem] truncate font-mono" title={branchLabel}>
          {branchLabel}
        </span>
      ) : null}
      {gitSummary?.kind === 'diff' ? (
        <span className="font-mono tabular-nums">
          <span className="text-success">{gitSummary.added}</span>
          <span className="text-dim">/</span>
          <span className="text-danger">{gitSummary.deleted}</span>
        </span>
      ) : gitSummary?.kind === 'summary' ? (
        <span className="font-mono tabular-nums">{gitSummary.text}</span>
      ) : null}
    </div>
  );
}

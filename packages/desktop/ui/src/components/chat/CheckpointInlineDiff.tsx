import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppEvents } from '../../app/contexts';
import { api } from '../../client/api';
import { useApi } from '../../hooks/useApi';
import { CheckpointDiffSection } from '../checkpoints/CheckpointDiffView';
import { cx, ErrorState, LoadingState } from '../ui';

const COLLAPSED_INLINE_DIFF_HEIGHT = 'clamp(12rem, 24vh, 16rem)';
const EXPANDED_INLINE_DIFF_HEIGHT = 'clamp(24rem, 56vh, 44rem)';

export function CheckpointInlineDiff({
  conversationId,
  checkpointId,
  onOpenCheckpoint,
  modalOpen = false,
}: {
  conversationId?: string | null;
  checkpointId: string;
  onOpenCheckpoint?: (checkpointId: string) => void;
  modalOpen?: boolean;
}) {
  const { versions } = useAppEvents();
  const [expanded, setExpanded] = useState(false);
  const previewEnabled = Boolean(conversationId?.trim());
  const previousCheckpointIdRef = useRef(checkpointId);
  const lastCheckpointVersionRef = useRef(versions.checkpoints);

  const fetchPreview = useCallback(async () => {
    if (!previewEnabled || !conversationId) {
      return null;
    }

    return api.conversationCheckpoint(conversationId, checkpointId);
  }, [checkpointId, conversationId, previewEnabled]);

  const { data, loading, error, refetch } = useApi(
    fetchPreview,
    previewEnabled ? `${conversationId}:checkpoint-inline:${checkpointId}` : `checkpoint-inline:${checkpointId}:disabled`,
  );

  useEffect(() => {
    if (previousCheckpointIdRef.current === checkpointId) {
      return;
    }

    previousCheckpointIdRef.current = checkpointId;
    setExpanded(false);
  }, [checkpointId]);

  useEffect(() => {
    if (!previewEnabled) {
      lastCheckpointVersionRef.current = versions.checkpoints;
      return;
    }

    if (versions.checkpoints === lastCheckpointVersionRef.current) {
      return;
    }

    lastCheckpointVersionRef.current = versions.checkpoints;
    void refetch({ resetLoading: false });
  }, [previewEnabled, refetch, versions.checkpoints]);

  if (!previewEnabled) {
    return null;
  }

  const checkpoint = data?.checkpoint ?? null;
  const hasFiles = (checkpoint?.files.length ?? 0) > 0;

  return (
    <div className="mt-4 border-t border-border-subtle/60 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div>
          <p className="font-medium text-secondary">{expanded ? 'Inline diff' : 'Diff peek'}</p>
          <p className="mt-0.5 text-dim">
            {expanded ? 'Single-column continuous diff.' : 'Scroll inline or click the preview to expand it.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFiles ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              className="ui-toolbar-button px-2 py-1 text-[10px]"
            >
              {expanded ? 'Collapse inline' : 'Expand inline'}
            </button>
          ) : null}
          {onOpenCheckpoint ? (
            <button
              type="button"
              onClick={() => onOpenCheckpoint(checkpointId)}
              className={cx('ui-toolbar-button px-2 py-1 text-[10px]', modalOpen ? 'text-secondary' : 'text-accent')}
            >
              {modalOpen ? 'Modal open' : 'Open modal'}
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cx('relative mt-3 overflow-hidden rounded-xl bg-base/40', hasFiles && !expanded && 'cursor-zoom-in')}
        style={{ height: expanded ? EXPANDED_INLINE_DIFF_HEIGHT : COLLAPSED_INLINE_DIFF_HEIGHT }}
        onClick={() => {
          if (!hasFiles || expanded) {
            return;
          }

          setExpanded(true);
        }}
      >
        {loading && !checkpoint ? (
          <LoadingState label="Loading diff…" className="h-full justify-center" />
        ) : error || !checkpoint ? (
          <ErrorState message={error || 'Couldn’t load the inline diff preview.'} className="m-3" />
        ) : checkpoint.files.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-[13px] text-secondary">
            No changed files were captured for this checkpoint.
          </div>
        ) : (
          <div className="h-full overflow-auto overscroll-contain">
            {checkpoint.files.map((file) => (
              <CheckpointDiffSection key={`${file.path}:${file.previousPath ?? ''}`} file={file} view="unified" stickyHeader />
            ))}
          </div>
        )}
        {!expanded && hasFiles ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface via-surface/90 to-transparent" />
        ) : null}
      </div>
    </div>
  );
}

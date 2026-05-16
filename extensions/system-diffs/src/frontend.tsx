import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import React, { lazy, Suspense } from 'react';

import { CheckpointTranscriptRenderer as BaseCheckpointTranscriptRenderer } from './panels.js';

type CheckpointTranscriptRendererProps = Parameters<typeof BaseCheckpointTranscriptRenderer>[0];
const LazyConversationDiffsPanel = lazy(async () => ({ default: (await import('./panels.js')).ConversationDiffsPanel }));
const LazyConversationDiffDetailPanel = lazy(async () => ({ default: (await import('./panels.js')).ConversationDiffDetailPanel }));
const fallback = <div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading checkpoints…</div>;

export function CheckpointTranscriptRenderer(props: CheckpointTranscriptRendererProps) {
  return <BaseCheckpointTranscriptRenderer {...props} />;
}
export function ConversationDiffsPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyConversationDiffsPanel {...props} />
    </Suspense>
  );
}
export function ConversationDiffDetailPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyConversationDiffDetailPanel {...props} />
    </Suspense>
  );
}

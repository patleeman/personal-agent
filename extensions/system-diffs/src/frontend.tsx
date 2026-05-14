import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { lazy, Suspense } from 'react';

type CheckpointTranscriptRendererProps = Parameters<typeof import('./panels.js').CheckpointTranscriptRenderer>[0];
const LazyCheckpointTranscriptRenderer = lazy(async () => ({ default: (await import('./panels.js')).CheckpointTranscriptRenderer }));
const LazyConversationDiffsPanel = lazy(async () => ({ default: (await import('./panels.js')).ConversationDiffsPanel }));
const LazyConversationDiffDetailPanel = lazy(async () => ({ default: (await import('./panels.js')).ConversationDiffDetailPanel }));
const fallback = <div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading checkpoints…</div>;

export function CheckpointTranscriptRenderer(props: CheckpointTranscriptRendererProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyCheckpointTranscriptRenderer {...props} />
    </Suspense>
  );
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

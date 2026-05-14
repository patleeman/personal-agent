export { ActivityShelf } from './ActivityShelf.js';

import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { lazy, Suspense } from 'react';

const LazyConversationBackgroundWorkPanel = lazy(async () => ({ default: (await import('./panels.js')).ConversationBackgroundWorkPanel }));
const LazyConversationBackgroundWorkDetailPanel = lazy(async () => ({
  default: (await import('./panels.js')).ConversationBackgroundWorkDetailPanel,
}));
const fallback = <div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading background work…</div>;

export function ConversationBackgroundWorkPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyConversationBackgroundWorkPanel {...props} />
    </Suspense>
  );
}
export function ConversationBackgroundWorkDetailPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyConversationBackgroundWorkDetailPanel {...props} />
    </Suspense>
  );
}
export const ConversationRunsPanel = ConversationBackgroundWorkPanel;
export const ConversationRunDetailPanel = ConversationBackgroundWorkDetailPanel;

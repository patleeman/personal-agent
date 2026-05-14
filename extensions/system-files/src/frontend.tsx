import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { lazy, Suspense } from 'react';

const LazyWorkspaceFilesPanel = lazy(async () => ({ default: (await import('./panels.js')).WorkspaceFilesPanel }));
const LazyWorkspaceFileDetailPanel = lazy(async () => ({ default: (await import('./panels.js')).WorkspaceFileDetailPanel }));

const fallback = <div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading workspace…</div>;

export function WorkspaceFilesPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyWorkspaceFilesPanel {...props} />
    </Suspense>
  );
}

export function WorkspaceFileDetailPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyWorkspaceFileDetailPanel {...props} />
    </Suspense>
  );
}

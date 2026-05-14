import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { lazy, Suspense } from 'react';

const LazyArtifactsPanel = lazy(async () => ({ default: (await import('./panels.js')).ArtifactsPanel }));
const LazyArtifactDetailPanel = lazy(async () => ({ default: (await import('./panels.js')).ArtifactDetailPanel }));
const LazyArtifactTranscriptRenderer = lazy(async () => ({ default: (await import('./panels.js')).ArtifactTranscriptRenderer }));
const fallback = <div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading artifacts…</div>;

export function ArtifactTranscriptRenderer(props: never) {
  return (
    <Suspense fallback={fallback}>
      <LazyArtifactTranscriptRenderer {...props} />
    </Suspense>
  );
}
export function ArtifactsPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyArtifactsPanel {...props} />
    </Suspense>
  );
}
export function ArtifactDetailPanel(props: ExtensionSurfaceProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyArtifactDetailPanel {...props} />
    </Suspense>
  );
}

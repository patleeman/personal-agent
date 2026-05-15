import { lazy, Suspense } from 'react';

type BrowserTranscriptRendererProps = Parameters<typeof import('./panels.js').BrowserTranscriptRenderer>[0];
const LazyBrowserTranscriptRenderer = lazy(async () => ({ default: (await import('./panels.js')).BrowserTranscriptRenderer }));
const LazyBrowserTabsPanel = lazy(async () => ({ default: (await import('./panels.js')).BrowserTabsPanel }));
const LazyBrowserWorkbenchPanel = lazy(async () => ({ default: (await import('./panels.js')).BrowserWorkbenchPanel }));
const fallback = <div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading browser…</div>;

export function BrowserTranscriptRenderer(props: BrowserTranscriptRendererProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyBrowserTranscriptRenderer {...props} />
    </Suspense>
  );
}

export function BrowserTabsPanel() {
  return (
    <Suspense fallback={fallback}>
      <LazyBrowserTabsPanel />
    </Suspense>
  );
}

export function BrowserWorkbenchPanel() {
  return (
    <Suspense fallback={fallback}>
      <LazyBrowserWorkbenchPanel />
    </Suspense>
  );
}

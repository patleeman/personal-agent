import React, { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ErrorState, LoadingState } from '../components/ui';
import type { MessageBlock } from '../shared/types';
import type { ExtensionInstallSummary, ExtensionTranscriptRendererContribution } from './types';

type ToolBlock = Extract<MessageBlock, { type: 'tool_use' }>;

export interface ExtensionToolBlockContext {
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
  onOpenBrowser?: () => void;
}

type ExtensionToolBlockComponent = ComponentType<{
  block: ToolBlock;
  renderer: ExtensionTranscriptRendererContribution;
  context: ExtensionToolBlockContext;
}>;

const systemComponents = new Map<string, () => Promise<Record<string, unknown>>>([
  ['system-artifacts', () => import('./systemWorkbench/SystemArtifactsExtension')],
  ['system-diffs', () => import('./systemWorkbench/SystemDiffsExtension')],
]);

function loadExtensionModule(extension: ExtensionInstallSummary): Promise<Record<string, unknown>> {
  const systemLoader = systemComponents.get(extension.id);
  if (systemLoader) return systemLoader();
  const entry = extension.manifest.frontend?.entry;
  if (!entry) throw new Error(`Extension ${extension.id} has no frontend entry.`);
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(extension.id)}/files/${entry.split('/').map(encodeURIComponent).join('/')}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

function lazyRendererComponent(extension: ExtensionInstallSummary, renderer: ExtensionTranscriptRendererContribution) {
  return lazy(async () => {
    const module = await loadExtensionModule(extension);
    const component = module[renderer.component];
    if (typeof component !== 'function') throw new Error(`Extension transcript renderer not found: ${renderer.component}`);
    return { default: component as ExtensionToolBlockComponent };
  });
}

export function NativeExtensionToolBlockHost({
  extension,
  renderer,
  block,
  context,
}: {
  extension: ExtensionInstallSummary;
  renderer: ExtensionTranscriptRendererContribution;
  block: ToolBlock;
  context: ExtensionToolBlockContext;
}) {
  const Component = useMemo(() => lazyRendererComponent(extension, renderer), [extension, renderer]);
  return (
    <Suspense fallback={<LoadingState label="Loading tool…" className="py-3" />}>
      <ExtensionToolBlockErrorBoundary>
        <Component block={block} renderer={renderer} context={context} />
      </ExtensionToolBlockErrorBoundary>
    </Suspense>
  );
}

class ExtensionToolBlockErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
  state = { message: null };
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.message ? <ErrorState message={this.state.message} /> : this.props.children;
  }
}

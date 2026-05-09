import React, { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ErrorState, LoadingState } from '../components/ui';
import type { MessageBlock } from '../shared/types';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionInstallSummary, ExtensionTranscriptRendererContribution } from './types';
import { useExtensionStyles } from './useExtensionStyles';

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

function loadExtensionModule(extension: ExtensionInstallSummary, revision: number): Promise<Record<string, unknown>> {
  const systemLoader = systemExtensionModules.get(extension.id);
  if (systemLoader) return systemLoader();
  const entry = extension.manifest.frontend?.entry;
  if (!entry) throw new Error(`Extension ${extension.id} has no frontend entry.`);
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(extension.id)}/files/${entry.split('/').map(encodeURIComponent).join('/')}?v=${revision}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

function extensionModuleKey(extension: ExtensionInstallSummary): string {
  return `${extension.id}:${extension.manifest.frontend?.entry ?? ''}:${getExtensionRegistryRevision()}`;
}

function lazyRendererComponent(extension: ExtensionInstallSummary, renderer: ExtensionTranscriptRendererContribution, revision: number) {
  return lazy(async () => {
    const module = await loadExtensionModule(extension, revision);
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
  useExtensionStyles(extension.id, extension.manifest.frontend?.styles);

  const moduleKey = extensionModuleKey(extension);
  const Component = useMemo(
    () => lazyRendererComponent(extension, renderer, getExtensionRegistryRevision()),
    [extension, renderer, moduleKey],
  );
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

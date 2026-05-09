import React, { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ErrorState, LoadingState } from '../components/ui';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient, type NativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { NativeExtensionViewSummary } from './types';
import { useExtensionStyles } from './useExtensionStyles';

type ExtensionComponent = ComponentType<{
  pa: NativeExtensionClient;
  context: {
    extensionId: string;
    surfaceId: string;
    route?: string | null;
    pathname: string;
    search: string;
    hash: string;
    conversationId?: string | null;
    cwd?: string | null;
  };
  surface: NativeExtensionViewSummary;
  params: Record<string, string>;
}>;

function loadExtensionModule(surface: NativeExtensionViewSummary, revision: number): Promise<Record<string, unknown>> {
  const systemLoader = systemExtensionModules.get(surface.extensionId);
  if (systemLoader) return systemLoader();
  const entry = surface.frontend?.entry;
  if (!entry) throw new Error(`Extension ${surface.extensionId} has no frontend entry.`);
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(surface.extensionId)}/files/${entry.split('/').map(encodeURIComponent).join('/')}?v=${revision}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

function extensionModuleKey(surface: NativeExtensionViewSummary): string {
  return `${surface.extensionId}:${surface.id}:${surface.frontend?.entry ?? ''}:${getExtensionRegistryRevision()}`;
}

function lazyExtensionComponent(surface: NativeExtensionViewSummary, revision: number) {
  return lazy(async () => {
    const module = await loadExtensionModule(surface, revision);
    const component = module[surface.component];
    if (typeof component !== 'function') {
      throw new Error(`Extension component not found: ${surface.component}`);
    }
    return { default: component as ExtensionComponent };
  });
}

function ExtensionSurfaceError({ message }: { message: string }) {
  return <ErrorState message={message} className="m-6" />;
}

export function NativeExtensionSurfaceHost({
  surface,
  pathname,
  search,
  hash,
  conversationId,
  cwd,
}: {
  surface: NativeExtensionViewSummary;
  pathname: string;
  search: string;
  hash: string;
  conversationId?: string | null;
  cwd?: string | null;
}) {
  useExtensionStyles(surface.extensionId, surface.frontend?.styles);

  const pa = useMemo(() => createNativeExtensionClient(surface.extensionId), [surface.extensionId]);
  const moduleKey = extensionModuleKey(surface);
  const Component = useMemo(() => lazyExtensionComponent(surface, getExtensionRegistryRevision()), [surface, moduleKey]);
  const context = useMemo(
    () => ({ extensionId: surface.extensionId, surfaceId: surface.id, route: surface.route, pathname, search, hash, conversationId, cwd }),
    [conversationId, cwd, hash, pathname, search, surface.extensionId, surface.id, surface.route],
  );

  return (
    <section
      className="h-full min-h-0 overflow-auto bg-base"
      data-extension-id={surface.extensionId}
      data-extension-surface-id={surface.id}
    >
      <Suspense fallback={<LoadingState label="Loading extension…" className="h-full justify-center" />}>
        <ExtensionErrorBoundary>
          <Component pa={pa} context={context} surface={surface} params={{}} />
        </ExtensionErrorBoundary>
      </Suspense>
    </section>
  );
}

class ExtensionErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
  state = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    return this.state.message ? <ExtensionSurfaceError message={this.state.message} /> : this.props.children;
  }
}

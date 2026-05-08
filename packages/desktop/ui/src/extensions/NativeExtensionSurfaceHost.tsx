import React, { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ErrorState, LoadingState } from '../components/ui';
import { createNativeExtensionClient, type NativeExtensionClient } from './nativePaClient';
import type { NativeExtensionViewSummary } from './types';

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

const systemComponents = new Map<string, () => Promise<Record<string, unknown>>>([
  ['system-automations', () => import('./systemAutomations/SystemAutomationsExtension')],
  ['system-gateways', () => import('../pages/GatewaysPage')],
  ['system-telemetry', () => import('../pages/TracesPage').then((module) => ({ TelemetryPage: module.TracesPage }))],
  ['system-runs', () => import('./systemWorkbench/SystemWorkbenchExtensions')],
  ['system-diffs', () => import('./systemWorkbench/SystemWorkbenchExtensions')],
  ['system-settings', () => import('./systemSettings/SystemSettingsExtensions')],
]);

function loadExtensionModule(surface: NativeExtensionViewSummary): Promise<Record<string, unknown>> {
  const systemLoader = systemComponents.get(surface.extensionId);
  if (systemLoader) return systemLoader();
  const entry = surface.frontend?.entry;
  if (!entry) throw new Error(`Extension ${surface.extensionId} has no frontend entry.`);
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(surface.extensionId)}/files/${entry.split('/').map(encodeURIComponent).join('/')}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

function lazyExtensionComponent(surface: NativeExtensionViewSummary) {
  return lazy(async () => {
    const module = await loadExtensionModule(surface);
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
  const pa = useMemo(() => createNativeExtensionClient(surface.extensionId), [surface.extensionId]);
  const Component = useMemo(() => lazyExtensionComponent(surface), [surface]);
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

import React, { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { addNotification } from '../components/notifications/notificationStore';
import { ErrorState, LoadingState } from '../components/ui';
import { ensureExtensionFrontendReactGlobals } from './extensionFrontendReactGlobals';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import {
  type ExtensionHostViewComponent,
  type ExtensionHostViewComponentProps,
  type ExtensionHostViewWrapperComponent,
  isHostViewComponentReference,
  lazyHostViewComponent,
} from './hostViewComponents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { NativeExtensionViewSummary } from './types';
import { useExtensionStyles } from './useExtensionStyles';

type ExtensionComponent = ComponentType<ExtensionHostViewComponentProps>;

function loadExtensionModule(surface: NativeExtensionViewSummary, revision: number, retryNonce?: number): Promise<Record<string, unknown>> {
  ensureExtensionFrontendReactGlobals();
  const systemLoader = systemExtensionModules.get(surface.extensionId);
  if (systemLoader) return systemLoader();
  const entry = surface.frontend?.entry;
  if (!entry) throw new Error(`Extension ${surface.extensionId} has no frontend entry.`);
  const query = retryNonce === undefined ? `v=${revision}` : `v=${revision}&retry=${retryNonce}`;
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(surface.extensionId)}/files/${entry.split('/').map(encodeURIComponent).join('/')}?${query}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

async function loadExtensionModuleWithRetry(surface: NativeExtensionViewSummary, revision: number): Promise<Record<string, unknown>> {
  try {
    return await loadExtensionModule(surface, revision);
  } catch {
    // Browser module loaders permanently cache failed dynamic imports by URL.
    // If an extension was rebuilt after an earlier bad bundle, retry once with
    // a fresh URL so the fixed dist/frontend.js can load without an app restart.
    return loadExtensionModule(surface, revision, Date.now());
  }
}

function extensionModuleKey(surface: NativeExtensionViewSummary): string {
  return `${surface.extensionId}:${surface.id}:${surface.frontend?.entry ?? ''}`;
}

function lazyExtensionComponent(surface: NativeExtensionViewSummary, revision: number) {
  return lazy(async () => {
    const module = await loadExtensionModuleWithRetry(surface, revision);
    if (typeof surface.component !== 'string') {
      throw new Error(`Extension component export is only available for custom component references.`);
    }
    const component = module[surface.component];
    if (typeof component !== 'function') {
      throw new Error(`Extension component not found: ${surface.component}`);
    }
    return { default: component as ExtensionComponent };
  });
}

function normalizeSlotOverrides(component: NativeExtensionViewSummary['component']): Record<string, string> {
  if (!isHostViewComponentReference(component)) return {};
  const overrides = component.overrides && typeof component.overrides === 'object' ? { ...component.overrides } : {};
  if (component.override && !overrides.wrapper) overrides.wrapper = component.override;
  return overrides;
}

function lazyHostViewSurfaceComponent(surface: NativeExtensionViewSummary, revision: number) {
  if (!isHostViewComponentReference(surface.component)) throw new Error('Host view component reference expected.');
  const hostId = surface.component.host;
  const slotOverrideExports = normalizeSlotOverrides(surface.component);
  const wrapperExport = slotOverrideExports.wrapper;
  const slotExports = Object.fromEntries(Object.entries(slotOverrideExports).filter(([slot]) => slot !== 'wrapper'));
  const HostComponent = lazyHostViewComponent(hostId);

  if (!wrapperExport && Object.keys(slotExports).length === 0) {
    return HostComponent;
  }

  return lazy(async () => {
    const module = await loadExtensionModuleWithRetry(surface, revision);
    const slotOverrides: Record<string, React.ComponentType<ExtensionHostViewComponentProps>> = {};
    for (const [slot, exportName] of Object.entries(slotExports)) {
      const slotComponent = module[exportName];
      if (typeof slotComponent !== 'function') throw new Error(`Extension host view override not found: ${slot} -> ${exportName}`);
      slotOverrides[slot] = slotComponent as React.ComponentType<ExtensionHostViewComponentProps>;
    }

    if (wrapperExport) {
      const wrapper = module[wrapperExport];
      if (typeof wrapper !== 'function') throw new Error(`Extension host view wrapper override not found: ${wrapperExport}`);
      const Wrapper = wrapper as ExtensionHostViewWrapperComponent;
      return {
        default: function HostViewWrapper(props: ExtensionHostViewComponentProps) {
          return <Wrapper {...props} HostComponent={HostComponent as ExtensionHostViewComponent} slotOverrides={slotOverrides} />;
        },
      };
    }

    return {
      default: function HostViewWithSlotOverrides(props: ExtensionHostViewComponentProps) {
        return <HostComponent {...props} slotOverrides={slotOverrides} />;
      },
    };
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
  const Component = useMemo(() => {
    if (isHostViewComponentReference(surface.component)) return lazyHostViewSurfaceComponent(surface, getExtensionRegistryRevision());
    return lazyExtensionComponent(surface, getExtensionRegistryRevision());
  }, [surface, moduleKey]);
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
        <ExtensionErrorBoundary extensionId={surface.extensionId}>
          <Component
            pa={pa}
            context={context}
            surface={surface}
            params={{}}
            hostProps={isHostViewComponentReference(surface.component) ? surface.component.props : undefined}
          />
        </ExtensionErrorBoundary>
      </Suspense>
    </section>
  );
}

class ExtensionErrorBoundary extends React.Component<{ children: React.ReactNode; extensionId: string }, { message: string | null }> {
  state = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, _errorInfo: { componentStack?: string }) {
    const message = error instanceof Error ? error.message : String(error);
    addNotification({
      type: 'error',
      message: `Extension surface error: ${message}`,
      details: error instanceof Error ? error.stack : undefined,
      source: this.props.extensionId,
    });
  }

  render() {
    return this.state.message ? <ExtensionSurfaceError message={this.state.message} /> : this.props.children;
  }
}

import React, { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { LoadingState } from '../components/ui';
import { ensureExtensionFrontendReactGlobals } from './extensionFrontendReactGlobals';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionSettingsComponentRegistration } from './useExtensionRegistry';

interface ExtensionSettingsPanelContext {
  sectionId: string;
  extensionId: string;
}

type ExtensionSettingsPanelComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
  settingsContext: ExtensionSettingsPanelContext;
}>;

function loadPanelModule(registration: ExtensionSettingsComponentRegistration, revision: number): Promise<Record<string, unknown>> {
  ensureExtensionFrontendReactGlobals();
  const systemLoader = systemExtensionModules.get(registration.extensionId);
  if (systemLoader) return systemLoader();
  const entry = registration.frontendEntry;
  if (!entry) throw new Error(`Extension ${registration.extensionId} has no frontend entry.`);
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(registration.extensionId)}/files/${entry.split('/').map(encodeURIComponent).join('/')}?v=${revision}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

export function SettingsPanelHost({ registration }: { registration: ExtensionSettingsComponentRegistration }) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadPanelModule(registration, getExtensionRegistryRevision());
        const component = module[registration.component] as ExtensionSettingsPanelComponent | undefined;
        if (typeof component !== 'function') {
          return { default: () => null as unknown as React.ReactElement };
        }
        return { default: component };
      }),
    [moduleKey],
  );

  return (
    <SettingsPanelErrorBoundary extensionId={registration.extensionId} componentId={registration.id}>
      <Suspense fallback={<LoadingState label="Loading extension settings…" />}>
        <Component pa={pa} settingsContext={{ sectionId: registration.sectionId, extensionId: registration.extensionId }} />
      </Suspense>
    </SettingsPanelErrorBoundary>
  );
}

class SettingsPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; extensionId: string; componentId: string },
  { message: string | null }
> {
  state = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-[12px] text-danger">
        <p className="font-medium">Extension settings failed to render.</p>
        <p className="mt-1 font-mono">
          {this.props.extensionId}:{this.props.componentId} — {this.state.message}
        </p>
      </div>
    );
  }
}

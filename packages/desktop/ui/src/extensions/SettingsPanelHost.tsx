import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { LoadingState } from '../components/ui';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionSettingsComponentRegistration } from './useExtensionRegistry';

interface ExtensionSettingsPanelContext {
  sectionId: string;
}

type ExtensionSettingsPanelComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
  settingsContext: ExtensionSettingsPanelContext;
}>;

function loadPanelModule(registration: ExtensionSettingsComponentRegistration, revision: number): Promise<Record<string, unknown>> {
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
    <Suspense fallback={<LoadingState label="Loading extension settings…" />}>
      <Component pa={pa} settingsContext={{ sectionId: registration.sectionId }} />
    </Suspense>
  );
}

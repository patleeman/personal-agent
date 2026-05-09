import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import type { ExtensionComposerShelfRegistration } from './useExtensionRegistry';
import { createNativeExtensionClient } from './nativePaClient';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { systemExtensionModules } from './systemExtensionModules';

type ComposerShelfComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
}>;

function loadShelfModule(registration: ExtensionComposerShelfRegistration, revision: number): Promise<Record<string, unknown>> {
  const systemLoader = systemExtensionModules.get(registration.extensionId);
  if (systemLoader) return systemLoader();
  const entry = registration.frontendEntry;
  if (!entry) throw new Error(`Extension ${registration.extensionId} has no frontend entry.`);
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(registration.extensionId)}/files/${entry.split('/').map(encodeURIComponent).join('/')}?v=${revision}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

export function ComposerShelfHost({ registration }: { registration: ExtensionComposerShelfRegistration }) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadShelfModule(registration, getExtensionRegistryRevision());
        const component = module[registration.component] as ComposerShelfComponent | undefined;
        if (typeof component !== 'function') {
          return { default: () => null as unknown as React.ReactElement };
        }
        return { default: component as React.ComponentType<{ pa: ReturnType<typeof createNativeExtensionClient> }> };
      }),
    [moduleKey],
  );

  return (
    <Suspense fallback={null}>
      <Component pa={pa} />
    </Suspense>
  );
}

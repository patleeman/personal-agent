import type { ExtensionStatusBarItemProps } from '@personal-agent/extensions';
import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ensureExtensionFrontendReactGlobals } from './extensionFrontendReactGlobals';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionStatusBarItemRegistration } from './useExtensionRegistry';

type StatusBarComponent = ComponentType<ExtensionStatusBarItemProps>;

type StatusBarContext = ExtensionStatusBarItemProps['statusBarContext'];

function loadStatusBarModule(registration: ExtensionStatusBarItemRegistration, revision: number): Promise<Record<string, unknown>> {
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

export function StatusBarItemHost({
  registration,
  statusBarContext,
}: {
  registration: ExtensionStatusBarItemRegistration;
  statusBarContext: StatusBarContext;
}) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadStatusBarModule(registration, getExtensionRegistryRevision());
        const component = registration.component ? (module[registration.component] as StatusBarComponent | undefined) : undefined;
        if (typeof component !== 'function') {
          return { default: () => null as unknown as React.ReactElement };
        }
        return { default: component };
      }),
    [moduleKey, registration.component],
  );

  return (
    <Suspense fallback={null}>
      <Component pa={pa} statusBarContext={statusBarContext} />
    </Suspense>
  );
}

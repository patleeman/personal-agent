import type { ComposerControlContext } from '@personal-agent/extensions/composer';
import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ensureExtensionFrontendReactGlobals } from './extensionFrontendReactGlobals';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionComposerControlRegistration } from './useExtensionRegistry';

export type ComposerButtonContext = ComposerControlContext;

type ComposerButtonComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
  buttonContext: ComposerButtonContext;
  controlContext: ComposerControlContext;
}>;

function loadButtonModule(registration: ExtensionComposerControlRegistration, revision: number): Promise<Record<string, unknown>> {
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

export function ComposerButtonHost({
  registration,
  buttonContext,
}: {
  registration: ExtensionComposerControlRegistration;
  buttonContext: ComposerButtonContext;
}) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadButtonModule(registration, getExtensionRegistryRevision());
        const component = module[registration.component] as ComposerButtonComponent | undefined;
        if (typeof component !== 'function') {
          return { default: () => null as unknown as React.ReactElement };
        }
        return { default: component };
      }),
    [moduleKey],
  );

  return (
    <Suspense fallback={null}>
      <Component pa={pa} buttonContext={buttonContext} controlContext={buttonContext} />
    </Suspense>
  );
}

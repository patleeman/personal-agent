import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { createNativeExtensionClient } from './nativePaClient';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionConversationDecoratorRegistration } from './useExtensionRegistry';
import type { SessionMeta } from '../shared/types';

type DecoratorComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
  session: SessionMeta;
}>;

function loadDecoratorModule(registration: ExtensionConversationDecoratorRegistration, revision: number): Promise<Record<string, unknown>> {
  const systemLoader = systemExtensionModules.get(registration.extensionId);
  if (systemLoader) return systemLoader();
  const entry = registration.frontendEntry;
  if (!entry) throw new Error(`Extension ${registration.extensionId} has no frontend entry.`);
  const source = buildApiPath(
    `/extensions/${encodeURIComponent(registration.extensionId)}/files/${entry.split('/').map(encodeURIComponent).join('/')}?v=${revision}`,
  );
  return import(/* @vite-ignore */ source) as Promise<Record<string, unknown>>;
}

export function ConversationDecoratorHost({
  registration,
  session,
}: {
  registration: ExtensionConversationDecoratorRegistration;
  session: SessionMeta;
}) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadDecoratorModule(registration, getExtensionRegistryRevision());
        const component = module[registration.component] as DecoratorComponent | undefined;
        if (typeof component !== 'function') {
          return { default: () => null as unknown as React.ReactElement };
        }
        return {
          default: component as React.ComponentType<{
            pa: ReturnType<typeof createNativeExtensionClient>;
            session: SessionMeta;
          }>,
        };
      }),
    [moduleKey],
  );

  return (
    <Suspense fallback={null}>
      <Component pa={pa} session={session} />
    </Suspense>
  );
}

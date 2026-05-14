import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ensureExtensionFrontendReactGlobals } from './extensionFrontendReactGlobals';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionThreadHeaderActionRegistration } from './useExtensionRegistry';

export interface ThreadHeaderActionContext {
  activeConversationId?: string | null;
  cwd?: string | null;
}

type ThreadHeaderActionComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
  actionContext: ThreadHeaderActionContext;
}>;

function loadActionModule(registration: ExtensionThreadHeaderActionRegistration, revision: number): Promise<Record<string, unknown>> {
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

export function ThreadHeaderActionHost({
  registration,
  actionContext,
}: {
  registration: ExtensionThreadHeaderActionRegistration;
  actionContext: ThreadHeaderActionContext;
}) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadActionModule(registration, getExtensionRegistryRevision());
        const component = module[registration.component] as ThreadHeaderActionComponent | undefined;
        if (typeof component !== 'function') {
          return { default: () => null as unknown as React.ReactElement };
        }
        return { default: component };
      }),
    [moduleKey],
  );

  return (
    <Suspense fallback={null}>
      <Component pa={pa} actionContext={actionContext} />
    </Suspense>
  );
}

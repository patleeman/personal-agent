import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import { ensureExtensionFrontendReactGlobals } from './extensionFrontendReactGlobals';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionConversationLifecycleRegistration } from './useExtensionRegistry';

export interface ConversationLifecycleContext {
  conversationId?: string | null;
  cwd?: string | null;
  event: ExtensionConversationLifecycleRegistration['events'][number];
  isStreaming?: boolean;
  hasGoal?: boolean;
  isCompacting?: boolean;
  error?: string | null;
}

type LifecycleComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
  lifecycleContext: ConversationLifecycleContext;
}>;

function loadLifecycleModule(registration: ExtensionConversationLifecycleRegistration, revision: number): Promise<Record<string, unknown>> {
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

export function ConversationLifecycleHost({
  registration,
  lifecycleContext,
}: {
  registration: ExtensionConversationLifecycleRegistration;
  lifecycleContext: ConversationLifecycleContext;
}) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadLifecycleModule(registration, getExtensionRegistryRevision());
        const component = module[registration.component] as LifecycleComponent | undefined;
        if (typeof component !== 'function') return { default: (() => null) as LifecycleComponent };
        return { default: component };
      }),
    [moduleKey, registration],
  ) as ComponentType<{ pa: ReturnType<typeof createNativeExtensionClient>; lifecycleContext: ConversationLifecycleContext }>;

  return (
    <Suspense fallback={null}>
      <Component pa={pa} lifecycleContext={lifecycleContext} />
    </Suspense>
  );
}

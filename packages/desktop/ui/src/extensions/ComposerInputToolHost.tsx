import { type ComponentType, lazy, Suspense, useMemo } from 'react';

import { buildApiPath } from '../client/apiBase';
import type { ComposerDrawingAttachment } from '../conversation/promptAttachments';
import { ensureExtensionFrontendReactGlobals } from './extensionFrontendReactGlobals';
import { getExtensionRegistryRevision } from './extensionRegistryEvents';
import { createNativeExtensionClient } from './nativePaClient';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionComposerInputToolRegistration } from './useExtensionRegistry';

export interface ComposerInputToolContext {
  composerDisabled: boolean;
  streamIsStreaming: boolean;
  composerHasContent: boolean;
  addFiles: (files: File[]) => void;
  upsertDrawingAttachment: (payload: Omit<ComposerDrawingAttachment, 'localId' | 'dirty'>) => void;
}

type ComposerInputToolComponent = ComponentType<{
  pa: ReturnType<typeof createNativeExtensionClient>;
  toolContext: ComposerInputToolContext;
}>;

function loadInputToolModule(registration: ExtensionComposerInputToolRegistration, revision: number): Promise<Record<string, unknown>> {
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

export function ComposerInputToolHost({
  registration,
  toolContext,
}: {
  registration: ExtensionComposerInputToolRegistration;
  toolContext: ComposerInputToolContext;
}) {
  const moduleKey = `${registration.extensionId}:${registration.frontendEntry ?? ''}:${getExtensionRegistryRevision()}`;
  const pa = useMemo(() => createNativeExtensionClient(registration.extensionId), [registration.extensionId]);
  const Component = useMemo(
    () =>
      lazy(async () => {
        const module = await loadInputToolModule(registration, getExtensionRegistryRevision());
        const component = module[registration.component] as ComposerInputToolComponent | undefined;
        if (typeof component !== 'function') {
          return { default: () => null as unknown as React.ReactElement };
        }
        return { default: component };
      }),
    [moduleKey],
  );

  return (
    <Suspense fallback={null}>
      <Component pa={pa} toolContext={toolContext} />
    </Suspense>
  );
}

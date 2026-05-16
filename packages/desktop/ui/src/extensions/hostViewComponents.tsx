import { HOST_VIEW_COMPONENT_DEFINITIONS, type HostViewComponentDefinition } from '@personal-agent/extensions/host-view-components';
import React from 'react';

import { lazyWithRecovery } from '../navigation/lazyRouteRecovery';
import type { NativeExtensionClient } from './nativePaClient';
import type { NativeExtensionViewSummary } from './types';

export type { HostViewComponentDefinition };

export type ExtensionHostViewComponent = React.ComponentType<ExtensionHostViewComponentProps>;

export interface ExtensionHostViewComponentProps {
  pa: NativeExtensionClient;
  context: {
    extensionId: string;
    surfaceId: string;
    route?: string | null;
    pathname: string;
    search: string;
    hash: string;
    conversationId?: string | null;
    cwd?: string | null;
  };
  surface: NativeExtensionViewSummary;
  params: Record<string, string>;
  hostProps?: Record<string, unknown>;
  slotOverrides?: Record<string, React.ComponentType<ExtensionHostViewComponentProps>>;
}

export type ExtensionHostViewWrapperComponent = React.ComponentType<
  ExtensionHostViewComponentProps & { HostComponent: ExtensionHostViewComponent }
>;

const componentLoaders: Record<string, () => Promise<{ default: ExtensionHostViewComponent }>> = {
  'workbench.artifacts.rail': async () => ({
    default: (await import('../../../../../extensions/system-artifacts/src/panels')).ArtifactsPanel as ExtensionHostViewComponent,
  }),
  'workbench.artifacts.detail': async () => ({
    default: (await import('../../../../../extensions/system-artifacts/src/panels')).ArtifactDetailPanel as ExtensionHostViewComponent,
  }),
  'workbench.diffs.rail': async () => ({
    default: (await import('../../../../../extensions/system-diffs/src/panels')).ConversationDiffsPanel as ExtensionHostViewComponent,
  }),
  'workbench.diffs.detail': async () => ({
    default: (await import('../../../../../extensions/system-diffs/src/panels')).ConversationDiffDetailPanel as ExtensionHostViewComponent,
  }),
  'workbench.files.rail': async () => ({
    default: (await import('../../../../../extensions/system-files/src/panels')).WorkspaceFilesPanel as ExtensionHostViewComponent,
  }),
  'workbench.files.detail': async () => ({
    default: (await import('../../../../../extensions/system-files/src/panels')).WorkspaceFileDetailPanel as ExtensionHostViewComponent,
  }),
  'workbench.runs.rail': async () => ({
    default: (await import('../../../../../extensions/system-runs/src/panels'))
      .ConversationBackgroundWorkPanel as ExtensionHostViewComponent,
  }),
  'workbench.runs.detail': async () => ({
    default: (await import('../../../../../extensions/system-runs/src/panels'))
      .ConversationBackgroundWorkDetailPanel as ExtensionHostViewComponent,
  }),
  'workbench.browser.rail': async () => ({
    default: (await import('../../../../../experimental-extensions/extensions/system-browser/src/panels'))
      .BrowserTabsPanel as ExtensionHostViewComponent,
  }),
  'workbench.browser.detail': async () => ({
    default: (await import('../../../../../experimental-extensions/extensions/system-browser/src/panels'))
      .BrowserWorkbenchPanel as ExtensionHostViewComponent,
  }),
};

export const hostViewComponentDefinitions: HostViewComponentDefinition[] = [...HOST_VIEW_COMPONENT_DEFINITIONS];

export const hostViewComponentRegistry = new Map(
  hostViewComponentDefinitions.map((definition) => [definition.id, { ...definition, load: componentLoaders[definition.id] }]),
);

export function isHostViewComponentReference(
  value: unknown,
): value is { host: string; props?: Record<string, unknown>; override?: string; overrides?: Record<string, string> } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { host?: unknown }).host === 'string');
}

export function getHostViewComponentDefinition(
  id: string,
): (HostViewComponentDefinition & { load?: () => Promise<{ default: ExtensionHostViewComponent }> }) | undefined {
  return hostViewComponentRegistry.get(id);
}

export function lazyHostViewComponent(id: string) {
  const definition = getHostViewComponentDefinition(id);
  if (!definition?.load) throw new Error(`Unknown host view component: ${id}`);
  return lazyWithRecovery(`host-view:${id}`, definition.load);
}

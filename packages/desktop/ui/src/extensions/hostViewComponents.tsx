import React, { lazy } from 'react';

import type { NativeExtensionClient } from './nativePaClient';
import type { NativeExtensionViewSummary } from './types';

export interface HostViewComponentDefinition {
  id: string;
  title: string;
  description: string;
  locations: Array<'main' | 'rightRail' | 'workbench'>;
  propsSchema: Record<string, unknown>;
  overrideSlots: Record<string, unknown>;
  examples: Array<Record<string, unknown>>;
  load: () => Promise<{ default: ExtensionHostViewComponent }>;
}

export type ExtensionHostViewComponent = React.ComponentType<{
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
  Override?: React.ComponentType<Record<string, unknown>>;
}>;

const emptyPropsSchema = { type: 'object', additionalProperties: false } as const;

export const hostViewComponentDefinitions: HostViewComponentDefinition[] = [
  {
    id: 'workbench.artifacts.rail',
    title: 'Artifacts rail',
    description: 'Conversation artifact list for the workbench right rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.artifacts.rail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-artifacts/src/panels')).ArtifactsPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.artifacts.detail',
    title: 'Artifact detail',
    description: 'Conversation artifact detail pane for the workbench.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.artifacts.detail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-artifacts/src/panels')).ArtifactDetailPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.diffs.rail',
    title: 'Diffs rail',
    description: 'Conversation checkpoint list for the workbench right rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.diffs.rail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-diffs/src/panels')).ConversationDiffsPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.diffs.detail',
    title: 'Diff detail',
    description: 'Conversation checkpoint diff detail pane for the workbench.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.diffs.detail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-diffs/src/panels'))
        .ConversationDiffDetailPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.files.rail',
    title: 'Workspace files rail',
    description: 'Workspace file explorer rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.files.rail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-files/src/panels')).WorkspaceFilesPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.files.detail',
    title: 'Workspace file detail',
    description: 'Workspace file detail pane.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.files.detail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-files/src/panels')).WorkspaceFileDetailPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.runs.rail',
    title: 'Background work rail',
    description: 'Conversation background work rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.runs.rail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-runs/src/panels'))
        .ConversationBackgroundWorkPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.runs.detail',
    title: 'Background work detail',
    description: 'Conversation background work detail pane.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.runs.detail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-runs/src/panels'))
        .ConversationBackgroundWorkDetailPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.browser.rail',
    title: 'Browser rail',
    description: 'Workbench browser tab rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.browser.rail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-browser/src/panels')).BrowserTabsPanel as ExtensionHostViewComponent,
    }),
  },
  {
    id: 'workbench.browser.detail',
    title: 'Browser detail',
    description: 'Workbench browser detail pane.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: {},
    examples: [{ component: { host: 'workbench.browser.detail' } }],
    load: async () => ({
      default: (await import('../../../../../extensions/system-browser/src/panels')).BrowserWorkbenchPanel as ExtensionHostViewComponent,
    }),
  },
];

export const hostViewComponentRegistry = new Map(hostViewComponentDefinitions.map((definition) => [definition.id, definition]));

export function isHostViewComponentReference(
  value: unknown,
): value is { host: string; props?: Record<string, unknown>; override?: string } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { host?: unknown }).host === 'string');
}

export function getHostViewComponentDefinition(id: string): HostViewComponentDefinition | undefined {
  return hostViewComponentRegistry.get(id);
}

export function lazyHostViewComponent(id: string) {
  const definition = getHostViewComponentDefinition(id);
  if (!definition) throw new Error(`Unknown host view component: ${id}`);
  return lazy(definition.load);
}

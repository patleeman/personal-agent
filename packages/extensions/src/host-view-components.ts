export type HostViewComponentLocation = 'main' | 'rightRail' | 'workbench';

export interface HostViewComponentOverrideSlotDefinition {
  description: string;
  propsSchema: Record<string, unknown>;
}

export interface HostViewComponentDefinition {
  id: string;
  title: string;
  description: string;
  locations: HostViewComponentLocation[];
  propsSchema: Record<string, unknown>;
  overrideSlots: Record<string, HostViewComponentOverrideSlotDefinition>;
  examples: Array<Record<string, unknown>>;
}

const emptyPropsSchema = { type: 'object', additionalProperties: false } as const;

const wrapperOverrideSlot = {
  description:
    'Wraps the host component. The override export receives the normal surface props plus HostComponent, hostProps, and slotOverrides.',
  propsSchema: {
    type: 'object',
    additionalProperties: true,
  },
} as const;

export const HOST_VIEW_COMPONENT_DEFINITIONS = [
  {
    id: 'workbench.artifacts.rail',
    title: 'Artifacts rail',
    description: 'Conversation artifact list for the workbench right rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.artifacts.rail' } }],
  },
  {
    id: 'workbench.artifacts.detail',
    title: 'Artifact detail',
    description: 'Conversation artifact detail pane for the workbench.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.artifacts.detail' } }],
  },
  {
    id: 'workbench.diffs.rail',
    title: 'Diffs rail',
    description: 'Conversation checkpoint list for the workbench right rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.diffs.rail' } }],
  },
  {
    id: 'workbench.diffs.detail',
    title: 'Diff detail',
    description: 'Conversation checkpoint diff detail pane for the workbench.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.diffs.detail' } }],
  },
  {
    id: 'workbench.files.rail',
    title: 'Workspace files rail',
    description: 'Workspace file explorer rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.files.rail' } }],
  },
  {
    id: 'workbench.files.detail',
    title: 'Workspace file detail',
    description: 'Workspace file detail pane.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.files.detail' } }],
  },
  {
    id: 'workbench.runs.rail',
    title: 'Background work rail',
    description: 'Conversation background work rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.runs.rail' } }],
  },
  {
    id: 'workbench.runs.detail',
    title: 'Background work detail',
    description: 'Conversation background work detail pane.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.runs.detail' } }],
  },
  {
    id: 'workbench.browser.rail',
    title: 'Browser rail',
    description: 'Workbench browser tab rail.',
    locations: ['rightRail'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.browser.rail' } }],
  },
  {
    id: 'workbench.browser.detail',
    title: 'Browser detail',
    description: 'Workbench browser detail pane.',
    locations: ['workbench'],
    propsSchema: emptyPropsSchema,
    overrideSlots: { wrapper: wrapperOverrideSlot },
    examples: [{ component: { host: 'workbench.browser.detail' } }],
  },
] as const satisfies readonly HostViewComponentDefinition[];

export type HostViewComponentId = (typeof HOST_VIEW_COMPONENT_DEFINITIONS)[number]['id'];

export const HOST_VIEW_COMPONENT_IDS = HOST_VIEW_COMPONENT_DEFINITIONS.map((definition) => definition.id) as HostViewComponentId[];

export function getHostViewComponentDefinition(id: string): HostViewComponentDefinition | undefined {
  return HOST_VIEW_COMPONENT_DEFINITIONS.find((definition) => definition.id === id);
}

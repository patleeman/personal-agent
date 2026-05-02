const CAPABILITIES_SECTION_QUERY_PARAM = 'section';
const CAPABILITIES_PRESET_QUERY_PARAM = 'preset';
const CAPABILITIES_TASK_QUERY_PARAM = 'task';
const CAPABILITIES_TOOL_QUERY_PARAM = 'tool';

const CAPABILITIES_SECTIONS = ['overview', 'presets', 'scheduled', 'tools'] as const;

type CapabilitySection = (typeof CAPABILITIES_SECTIONS)[number];

const CAPABILITIES_SECTION_SET = new Set<string>(CAPABILITIES_SECTIONS);

export function getCapabilitiesSection(search: string): CapabilitySection {
  const value = new URLSearchParams(search).get(CAPABILITIES_SECTION_QUERY_PARAM)?.trim() ?? '';
  return CAPABILITIES_SECTION_SET.has(value) ? value as CapabilitySection : 'overview';
}

export function getCapabilitiesPresetId(search: string): string | null {
  return new URLSearchParams(search).get(CAPABILITIES_PRESET_QUERY_PARAM)?.trim() || null;
}

export function getCapabilitiesTaskId(search: string): string | null {
  return new URLSearchParams(search).get(CAPABILITIES_TASK_QUERY_PARAM)?.trim() || null;
}

export function getCapabilitiesToolName(search: string): string | null {
  return new URLSearchParams(search).get(CAPABILITIES_TOOL_QUERY_PARAM)?.trim() || null;
}

export function buildCapabilitiesSearch(currentSearch: string, updates: {
  section?: CapabilitySection;
  presetId?: string | null;
  taskId?: string | null;
  toolName?: string | null;
}): string {
  const params = new URLSearchParams(currentSearch);
  const nextSection = updates.section ?? getCapabilitiesSection(currentSearch);

  params.set(CAPABILITIES_SECTION_QUERY_PARAM, nextSection);

  if (nextSection !== 'presets' || updates.presetId === null) {
    params.delete(CAPABILITIES_PRESET_QUERY_PARAM);
  }
  if (nextSection !== 'scheduled' || updates.taskId === null) {
    params.delete(CAPABILITIES_TASK_QUERY_PARAM);
  }
  if (nextSection !== 'tools' || updates.toolName === null) {
    params.delete(CAPABILITIES_TOOL_QUERY_PARAM);
  }

  if (nextSection === 'presets' && updates.presetId) {
    params.set(CAPABILITIES_PRESET_QUERY_PARAM, updates.presetId);
  }
  if (nextSection === 'scheduled' && updates.taskId) {
    params.set(CAPABILITIES_TASK_QUERY_PARAM, updates.taskId);
  }
  if (nextSection === 'tools' && updates.toolName) {
    params.set(CAPABILITIES_TOOL_QUERY_PARAM, updates.toolName);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

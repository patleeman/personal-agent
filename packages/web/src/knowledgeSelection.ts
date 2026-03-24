export const KNOWLEDGE_SECTION_QUERY_PARAM = 'section';
export const KNOWLEDGE_PROJECT_QUERY_PARAM = 'project';
export const KNOWLEDGE_MEMORY_QUERY_PARAM = 'memory';
export const KNOWLEDGE_SKILL_QUERY_PARAM = 'skill';
export const KNOWLEDGE_INSTRUCTION_QUERY_PARAM = 'instruction';

export const KNOWLEDGE_SECTIONS = ['overview', 'projects', 'memories', 'skills', 'instructions'] as const;

export type KnowledgeSection = (typeof KNOWLEDGE_SECTIONS)[number];

const KNOWLEDGE_SECTION_SET = new Set<string>(KNOWLEDGE_SECTIONS);

export function getKnowledgeSection(search: string): KnowledgeSection {
  const value = new URLSearchParams(search).get(KNOWLEDGE_SECTION_QUERY_PARAM)?.trim() ?? '';
  return KNOWLEDGE_SECTION_SET.has(value) ? value as KnowledgeSection : 'overview';
}

export function getKnowledgeProjectId(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_PROJECT_QUERY_PARAM)?.trim() || null;
}

export function getKnowledgeMemoryId(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_MEMORY_QUERY_PARAM)?.trim() || null;
}

export function getKnowledgeSkillName(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_SKILL_QUERY_PARAM)?.trim() || null;
}

export function getKnowledgeInstructionPath(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_INSTRUCTION_QUERY_PARAM)?.trim() || null;
}

export function getKnowledgeLandingPath(search: string): string | null {
  return getKnowledgeSection(search) === 'overview' ? '/projects' : null;
}

export function buildKnowledgeSearch(currentSearch: string, updates: {
  section?: KnowledgeSection;
  projectId?: string | null;
  memoryId?: string | null;
  skillName?: string | null;
  instructionPath?: string | null;
}): string {
  const params = new URLSearchParams(currentSearch);
  const nextSection = updates.section ?? getKnowledgeSection(currentSearch);

  params.set(KNOWLEDGE_SECTION_QUERY_PARAM, nextSection);

  if (nextSection !== 'projects' || updates.projectId === null) {
    params.delete(KNOWLEDGE_PROJECT_QUERY_PARAM);
  }
  if (nextSection !== 'memories' || updates.memoryId === null) {
    params.delete(KNOWLEDGE_MEMORY_QUERY_PARAM);
  }
  if (nextSection !== 'skills' || updates.skillName === null) {
    params.delete(KNOWLEDGE_SKILL_QUERY_PARAM);
  }
  if (nextSection !== 'instructions' || updates.instructionPath === null) {
    params.delete(KNOWLEDGE_INSTRUCTION_QUERY_PARAM);
  }

  if (nextSection === 'projects' && updates.projectId) {
    params.set(KNOWLEDGE_PROJECT_QUERY_PARAM, updates.projectId);
  }
  if (nextSection === 'memories' && updates.memoryId) {
    params.set(KNOWLEDGE_MEMORY_QUERY_PARAM, updates.memoryId);
  }
  if (nextSection === 'skills' && updates.skillName) {
    params.set(KNOWLEDGE_SKILL_QUERY_PARAM, updates.skillName);
  }
  if (nextSection === 'instructions' && updates.instructionPath) {
    params.set(KNOWLEDGE_INSTRUCTION_QUERY_PARAM, updates.instructionPath);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

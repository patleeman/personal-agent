export const KNOWLEDGE_SECTION_QUERY_PARAM = 'section';
export const KNOWLEDGE_PROJECT_QUERY_PARAM = 'project';
export const KNOWLEDGE_NOTE_QUERY_PARAM = 'note';
export const KNOWLEDGE_SKILL_QUERY_PARAM = 'skill';
export const KNOWLEDGE_INSTRUCTION_QUERY_PARAM = 'instruction';

export const KNOWLEDGE_SECTIONS = ['overview', 'projects', 'notes', 'skills', 'instructions'] as const;

export type KnowledgeSection = (typeof KNOWLEDGE_SECTIONS)[number];

const KNOWLEDGE_SECTION_SET = new Set<string>(KNOWLEDGE_SECTIONS);

export function getKnowledgeSection(search: string): KnowledgeSection {
  const value = new URLSearchParams(search).get(KNOWLEDGE_SECTION_QUERY_PARAM)?.trim() ?? '';
  const normalized = value === 'memories' ? 'notes' : value;
  return KNOWLEDGE_SECTION_SET.has(normalized) ? normalized as KnowledgeSection : 'overview';
}

export function getKnowledgeProjectId(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_PROJECT_QUERY_PARAM)?.trim() || null;
}

export function getKnowledgeNoteId(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get(KNOWLEDGE_NOTE_QUERY_PARAM)?.trim() || params.get('memory')?.trim() || null;
}

export function getKnowledgeSkillName(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_SKILL_QUERY_PARAM)?.trim() || null;
}

export function getKnowledgeInstructionPath(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_INSTRUCTION_QUERY_PARAM)?.trim() || null;
}

export function buildKnowledgeSearch(currentSearch: string, updates: {
  section?: KnowledgeSection;
  projectId?: string | null;
  noteId?: string | null;
  skillName?: string | null;
  instructionPath?: string | null;
}): string {
  const params = new URLSearchParams(currentSearch);
  const nextSection = updates.section ?? getKnowledgeSection(currentSearch);

  params.set(KNOWLEDGE_SECTION_QUERY_PARAM, nextSection);

  if (nextSection !== 'projects' || updates.projectId === null) {
    params.delete(KNOWLEDGE_PROJECT_QUERY_PARAM);
  }
  if (nextSection !== 'notes' || updates.noteId === null) {
    params.delete(KNOWLEDGE_NOTE_QUERY_PARAM);
  }
  if (nextSection !== 'notes') {
    params.delete('memory');
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
  if (nextSection === 'notes' && updates.noteId) {
    params.set(KNOWLEDGE_NOTE_QUERY_PARAM, updates.noteId);
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

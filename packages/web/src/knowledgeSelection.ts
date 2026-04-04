const KNOWLEDGE_SECTION_QUERY_PARAM = 'section';
const KNOWLEDGE_INSTRUCTION_QUERY_PARAM = 'instruction';

export function getKnowledgeSection(search: string): 'overview' | 'instructions' {
  const value = new URLSearchParams(search).get(KNOWLEDGE_SECTION_QUERY_PARAM)?.trim() ?? '';
  return value === 'instructions' ? 'instructions' : 'overview';
}

export function getKnowledgeInstructionPath(search: string): string | null {
  return new URLSearchParams(search).get(KNOWLEDGE_INSTRUCTION_QUERY_PARAM)?.trim() || null;
}

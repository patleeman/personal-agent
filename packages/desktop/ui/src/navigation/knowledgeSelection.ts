const KNOWLEDGE_SECTION_QUERY_PARAM = 'section';

export function getKnowledgeSection(search: string): 'overview' | 'instructions' {
  const value = new URLSearchParams(search).get(KNOWLEDGE_SECTION_QUERY_PARAM)?.trim() ?? '';
  return value === 'instructions' ? 'instructions' : 'overview';
}

export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
  if (!match) {
    return null;
  }

  return {
    name: match[1] ?? '',
    location: match[2] ?? '',
    content: match[3] ?? '',
    userMessage: match[4]?.trim() || undefined,
  };
}

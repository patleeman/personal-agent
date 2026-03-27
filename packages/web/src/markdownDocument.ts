function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export interface MarkdownDocumentParts {
  frontmatter: string | null;
  body: string;
}

export function splitMarkdownFrontmatter(content: string): MarkdownDocumentParts {
  const normalized = normalizeNewlines(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return {
      frontmatter: null,
      body: normalized.replace(/^\n+/, ''),
    };
  }

  return {
    frontmatter: match[1] ?? '',
    body: (match[2] ?? '').replace(/^\n+/, ''),
  };
}

export function stripMarkdownFrontmatter(content: string): string {
  return splitMarkdownFrontmatter(content).body;
}

export function joinMarkdownFrontmatter(frontmatter: string | null, body: string): string {
  const normalizedBody = normalizeNewlines(body).trim();

  if (!frontmatter || frontmatter.trim().length === 0) {
    return normalizedBody.length > 0 ? `${normalizedBody}\n` : '';
  }

  return `---\n${normalizeNewlines(frontmatter).trimEnd()}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
}

export function normalizeMarkdownValue(value: string): string {
  return normalizeNewlines(value).trim();
}

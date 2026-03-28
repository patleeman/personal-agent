function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripMarkdownFrontmatter(content: string): string {
  return normalizeNewlines(content).replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\n+/, '');
}

export function stripManagedNoteHeading(content: string, title: string): string {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) {
    return content.replace(/^\n+/, '');
  }

  const normalizedContent = normalizeNewlines(content).replace(/^\n+/, '');
  const headingPattern = new RegExp(`^#\\s+${escapeRegExp(normalizedTitle)}\\s*(?:\n+|$)`, 'i');
  if (!headingPattern.test(normalizedContent)) {
    return normalizedContent;
  }

  return normalizedContent.replace(headingPattern, '').replace(/^\n+/, '');
}

export function readEditableNoteBody(content: string, title: string): string {
  return stripManagedNoteHeading(stripMarkdownFrontmatter(content), title);
}

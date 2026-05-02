const MAX_SUMMARY_PREVIEW_LINES = 8;

export function stripPreviewMarkdownWrappers(line: string) {
  if ((line.startsWith('**') && line.endsWith('**')) || (line.startsWith('__') && line.endsWith('__'))) {
    return line.slice(2, -2).trim();
  }

  if (
    (line.startsWith('*') && line.endsWith('*')) ||
    (line.startsWith('_') && line.endsWith('_')) ||
    (line.startsWith('`') && line.endsWith('`'))
  ) {
    return line.slice(1, -1).trim();
  }

  return line;
}

export function formatSummaryPreviewLine(line: string) {
  let normalized = line;

  if (/^#{1,6}\s+/.test(normalized)) {
    normalized = normalized.replace(/^#{1,6}\s+/, '');
  }

  if (/^[-*+]\s+/.test(normalized)) {
    return `• ${stripPreviewMarkdownWrappers(normalized.replace(/^[-*+]\s+/, ''))}`;
  }

  return stripPreviewMarkdownWrappers(normalized);
}

export function buildSummaryPreview(text: string, maxLines: number) {
  const lineLimit = Number.isSafeInteger(maxLines) && maxLines > 0 ? Math.min(MAX_SUMMARY_PREVIEW_LINES, maxLines) : 1;
  const previewLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    previewLines.push(formatSummaryPreviewLine(trimmed));
    if (previewLines.length >= lineLimit) {
      break;
    }
  }

  return previewLines.join('\n');
}

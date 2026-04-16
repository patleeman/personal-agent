interface ReplyQuoteInsertionResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function normalizeReplyQuoteSelection(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .trim();
}

function formatReplyQuoteMarkdown(text: string): string {
  const normalized = normalizeReplyQuoteSelection(text);
  if (!normalized) {
    return '';
  }

  return normalized
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

export function insertReplyQuoteIntoComposer(
  promptText: string,
  replyQuoteText: string | null | undefined,
  selection?: { start: number; end: number } | null,
): ReplyQuoteInsertionResult {
  const quote = formatReplyQuoteMarkdown(replyQuoteText ?? '');
  const normalizedPrompt = promptText.replace(/\r\n?/g, '\n');
  const fallbackPosition = normalizedPrompt.length;
  const start = Math.max(0, Math.min(selection?.start ?? fallbackPosition, normalizedPrompt.length));
  const end = Math.max(start, Math.min(selection?.end ?? start, normalizedPrompt.length));

  if (!quote) {
    return {
      text: normalizedPrompt,
      selectionStart: end,
      selectionEnd: end,
    };
  }

  const before = normalizedPrompt.slice(0, start);
  const after = normalizedPrompt.slice(end);
  const beforeGap = before.length === 0
    ? ''
    : before.endsWith('\n\n')
      ? ''
      : before.endsWith('\n')
        ? '\n'
        : '\n\n';
  const afterGap = after.length === 0
    ? '\n\n'
    : after.startsWith('\n\n')
      ? ''
      : after.startsWith('\n')
        ? '\n'
        : '\n\n';
  const inserted = `${beforeGap}${quote}${afterGap}`;
  const nextText = `${before}${inserted}${after}`;
  const caret = before.length + inserted.length;

  return {
    text: nextText,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

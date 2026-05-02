interface ReplyQuoteInsertionResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

function normalizeReplyQuoteSelectionIndex(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isSafeInteger(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(value, max));
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

function buildInsertedComposerBlock(
  promptText: string,
  block: string,
  selection?: { start: number; end: number } | null,
): ReplyQuoteInsertionResult {
  const normalizedPrompt = promptText.replace(/\r\n?/g, '\n');
  const fallbackPosition = normalizedPrompt.length;
  const start = normalizeReplyQuoteSelectionIndex(selection?.start, fallbackPosition, normalizedPrompt.length);
  const end = Math.max(start, normalizeReplyQuoteSelectionIndex(selection?.end, start, normalizedPrompt.length));

  if (!block) {
    return {
      text: normalizedPrompt,
      selectionStart: end,
      selectionEnd: end,
    };
  }

  const before = normalizedPrompt.slice(0, start);
  const after = normalizedPrompt.slice(end);
  const beforeGap = before.length === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const afterGap = after.length === 0 ? '\n\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${beforeGap}${block}${afterGap}`;
  const nextText = `${before}${inserted}${after}`;
  const caret = before.length + inserted.length;

  return {
    text: nextText,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

export function insertReplyQuoteIntoComposer(
  promptText: string,
  replyQuoteText: string | null | undefined,
  selection?: { start: number; end: number } | null,
): ReplyQuoteInsertionResult {
  const quote = formatReplyQuoteMarkdown(replyQuoteText ?? '');
  return buildInsertedComposerBlock(promptText, quote, selection);
}

export function insertFileReplyQuoteIntoComposer(
  promptText: string,
  filePath: string,
  replyQuoteText: string | null | undefined,
  selection?: { start: number; end: number } | null,
): ReplyQuoteInsertionResult {
  const normalizedPath = filePath.trim();
  const quote = formatReplyQuoteMarkdown(replyQuoteText ?? '');
  const block = normalizedPath && quote ? `From \`${normalizedPath}\`:\n${quote}` : quote;

  return buildInsertedComposerBlock(promptText, block, selection);
}

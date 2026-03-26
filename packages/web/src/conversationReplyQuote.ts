export function normalizeReplyQuoteSelection(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .trim();
}

export function formatReplyQuoteMarkdown(text: string): string {
  const normalized = normalizeReplyQuoteSelection(text);
  if (!normalized) {
    return '';
  }

  return normalized
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

export function prependReplyQuoteToPrompt(promptText: string, replyQuoteText: string | null | undefined): string {
  const quote = formatReplyQuoteMarkdown(replyQuoteText ?? '');
  if (!quote) {
    return promptText;
  }

  const normalizedPrompt = promptText.replace(/\r\n?/g, '\n').trim();
  return normalizedPrompt.length > 0 ? `${quote}\n\n${normalizedPrompt}` : quote;
}

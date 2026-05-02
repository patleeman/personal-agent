function normalizeConversationCwd(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function summarizeConversationCwd(cwd: string): string {
  const trimmed = normalizeConversationCwd(cwd);
  if (!trimmed) {
    return '';
  }

  if (trimmed === '/' || trimmed === '\\') {
    return trimmed;
  }

  const normalized = trimmed.replace(/[\\/]+$/, '');
  if (normalized === '~' || /^[A-Za-z]:$/.test(normalized)) {
    return normalized;
  }

  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function truncateConversationCwdFromFront(cwd: string, maxChars = 48): string {
  const trimmed = normalizeConversationCwd(cwd);
  if (!trimmed) {
    return '';
  }

  const limit = Number.isSafeInteger(maxChars) && maxChars > 0 && maxChars <= 240 ? maxChars : 48;
  if (trimmed.length <= limit) {
    return trimmed;
  }

  if (limit === 1) {
    return '…';
  }

  return `…${trimmed.slice(-(limit - 1))}`;
}

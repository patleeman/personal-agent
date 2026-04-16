export function normalizeConversationCwd(value: string | null | undefined): string {
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

import type { SessionMeta } from './types';

export function normalizeConversationCwd(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildConversationCwdHistory(
  sessions: SessionMeta[] | null | undefined,
  draftCwd?: string | null,
): string[] {
  const seen = new Set<string>();
  const history: string[] = [];

  const add = (value: string | null | undefined) => {
    const normalized = normalizeConversationCwd(value);
    if (!normalized || normalized === 'Draft' || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    history.push(normalized);
  };

  add(draftCwd);
  for (const session of sessions ?? []) {
    add(session.cwd);
  }

  return history;
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

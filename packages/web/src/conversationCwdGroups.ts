function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

function baseName(path: string): string {
  const normalized = normalizePathSeparators(path);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export interface ConversationCwdGroup<T> {
  key: string;
  cwd: string | null;
  label: string;
  items: T[];
}

export function normalizeConversationGroupCwd(cwd: string | null | undefined): string {
  return cwd?.trim() ?? '';
}

export function getConversationGroupLabel(cwd: string | null | undefined): string {
  const normalized = normalizeConversationGroupCwd(cwd);
  if (!normalized) {
    return 'No working directory';
  }

  return baseName(normalized) || normalized;
}

export function groupConversationItemsByCwd<T>(
  items: T[],
  getCwd: (item: T) => string | null | undefined,
): ConversationCwdGroup<T>[] {
  const groups = new Map<string, ConversationCwdGroup<T>>();

  for (const item of items) {
    const normalizedCwd = normalizeConversationGroupCwd(getCwd(item));
    const mapKey = normalizedCwd;
    const existing = groups.get(mapKey);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(mapKey, {
      key: normalizedCwd || '__no-cwd__',
      cwd: normalizedCwd || null,
      label: getConversationGroupLabel(normalizedCwd),
      items: [item],
    });
  }

  return [...groups.values()];
}

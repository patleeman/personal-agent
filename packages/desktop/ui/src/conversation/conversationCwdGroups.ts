function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

function trimTrailingPathSeparators(path: string): string {
  if (path === '/' || /^[A-Za-z]:\/$/.test(path)) {
    return path;
  }

  return path.replace(/\/+$/, '');
}

function baseName(path: string): string {
  const normalized = normalizePathSeparators(path);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function splitPathParts(path: string): string[] {
  const normalized = normalizeConversationGroupCwd(path);
  return normalized ? normalizePathSeparators(normalized).split('/').filter(Boolean) : [];
}

interface ConversationGroupLabelEntry {
  cwd: string;
  parts: string[];
  baseLabel: string;
}

interface ConversationCwdGroup<T> {
  key: string;
  cwd: string | null;
  label: string;
  items: T[];
}

export function normalizeConversationGroupCwd(cwd: string | null | undefined): string {
  const trimmed = cwd?.trim() ?? '';
  if (!trimmed) {
    return '';
  }

  const normalized = normalizePathSeparators(trimmed);
  return trimTrailingPathSeparators(normalized) || normalized;
}

export function buildConversationGroupLabels(cwds: Iterable<string | null | undefined>): Map<string, string> {
  const entries: ConversationGroupLabelEntry[] = [];
  const seen = new Set<string>();

  for (const cwd of cwds) {
    const normalizedCwd = normalizeConversationGroupCwd(cwd);
    if (!normalizedCwd || seen.has(normalizedCwd)) {
      continue;
    }

    seen.add(normalizedCwd);
    entries.push({
      cwd: normalizedCwd,
      parts: splitPathParts(normalizedCwd),
      baseLabel: baseName(normalizedCwd) || normalizedCwd,
    });
  }

  const labels = new Map<string, string>();
  const entriesByBaseLabel = new Map<string, ConversationGroupLabelEntry[]>();

  for (const entry of entries) {
    const existing = entriesByBaseLabel.get(entry.baseLabel);
    if (existing) {
      existing.push(entry);
      continue;
    }

    entriesByBaseLabel.set(entry.baseLabel, [entry]);
  }

  for (const [baseLabel, matchingEntries] of entriesByBaseLabel) {
    if (matchingEntries.length === 1) {
      labels.set(matchingEntries[0]!.cwd, baseLabel);
      continue;
    }

    let unresolved = matchingEntries.slice();
    const maxSegmentCount = Math.max(...matchingEntries.map((entry) => Math.max(entry.parts.length, 1)));

    for (let segmentCount = 2; segmentCount <= maxSegmentCount && unresolved.length > 0; segmentCount += 1) {
      const candidateCounts = new Map<string, number>();

      for (const entry of unresolved) {
        const candidate = entry.parts.slice(-Math.min(segmentCount, entry.parts.length)).join('/') || entry.cwd;
        candidateCounts.set(candidate, (candidateCounts.get(candidate) ?? 0) + 1);
      }

      unresolved = unresolved.filter((entry) => {
        const candidate = entry.parts.slice(-Math.min(segmentCount, entry.parts.length)).join('/') || entry.cwd;
        if (candidateCounts.get(candidate) !== 1) {
          return true;
        }

        labels.set(entry.cwd, candidate);
        return false;
      });
    }

    for (const entry of unresolved) {
      labels.set(entry.cwd, entry.cwd);
    }
  }

  return labels;
}

export function getConversationGroupLabel(cwd: string | null | undefined, options?: { labelsByCwd?: ReadonlyMap<string, string> }): string {
  const normalized = normalizeConversationGroupCwd(cwd);
  if (!normalized) {
    return 'No working directory';
  }

  return options?.labelsByCwd?.get(normalized) ?? (baseName(normalized) || normalized);
}

export function groupConversationItemsByCwd<T>(
  items: T[],
  getCwd: (item: T) => string | null | undefined,
  options?: { labelsByCwd?: ReadonlyMap<string, string> },
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
      label: getConversationGroupLabel(normalizedCwd, options),
      items: [item],
    });
  }

  return [...groups.values()];
}

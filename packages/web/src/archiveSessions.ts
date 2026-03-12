import type { SessionMeta } from './types';

export const ALL_ARCHIVE_WORKSPACES_VALUE = '__all_workspaces__';

export interface ArchiveWorkspaceOption {
  value: string;
  label: string;
  count: number;
  latestTimestamp: string;
}

function compareWorkspaceOptions(left: ArchiveWorkspaceOption, right: ArchiveWorkspaceOption): number {
  if (left.latestTimestamp !== right.latestTimestamp) {
    return right.latestTimestamp.localeCompare(left.latestTimestamp);
  }

  if (left.count !== right.count) {
    return right.count - left.count;
  }

  return left.label.localeCompare(right.label);
}

export function buildArchiveWorkspaceOptions(sessions: SessionMeta[]): ArchiveWorkspaceOption[] {
  const workspaceMap = new Map<string, ArchiveWorkspaceOption>();

  for (const session of sessions) {
    const existing = workspaceMap.get(session.cwd);
    if (existing) {
      existing.count += 1;
      if (session.timestamp.localeCompare(existing.latestTimestamp) > 0) {
        existing.latestTimestamp = session.timestamp;
      }
      continue;
    }

    workspaceMap.set(session.cwd, {
      value: session.cwd,
      label: session.cwd,
      count: 1,
      latestTimestamp: session.timestamp,
    });
  }

  return [...workspaceMap.values()].sort(compareWorkspaceOptions);
}

export function filterArchiveSessions(
  sessions: SessionMeta[],
  query: string,
  workspace: string = ALL_ARCHIVE_WORKSPACES_VALUE,
): SessionMeta[] {
  const normalizedQuery = query.trim().toLowerCase();

  return sessions.filter((session) => {
    if (workspace !== ALL_ARCHIVE_WORKSPACES_VALUE && session.cwd !== workspace) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const title = session.title.toLowerCase();
    const cwd = session.cwd.toLowerCase();
    const id = session.id.toLowerCase();
    return title.includes(normalizedQuery) || cwd.includes(normalizedQuery) || id.includes(normalizedQuery);
  });
}

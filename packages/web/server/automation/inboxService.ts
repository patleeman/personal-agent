import { loadDaemonConfig, resolveDaemonPaths } from '@personal-agent/daemon';
import {
  clearActivityConversationLinks,
  deleteProfileActivityEntries,
  getActivityConversationLink,
  listProfileActivityEntries,
  loadProfileActivityReadState,
  markConversationAttentionRead,
  saveProfileActivityReadState,
} from '@personal-agent/core';
import {
  listArchivedAttentionSessions,
  listStandaloneActivityRecords,
} from './inbox.js';

type ActivityEntry = ReturnType<typeof listProfileActivityEntries>[number]['entry'] & {
  read?: boolean;
  relatedConversationIds?: string[];
};

export type ActivityRecord = {
  entry: ActivityEntry;
  stateRoot?: string;
  read: boolean;
};

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function listActivityStateRoots(): Array<string | undefined> {
  try {
    return [undefined, resolveDaemonRoot()];
  } catch {
    return [undefined];
  }
}

function loadReadState(stateRoot: string | undefined, profile: string): Set<string> {
  return loadProfileActivityReadState({ stateRoot, profile });
}

function saveReadState(stateRoot: string | undefined, profile: string, ids: Set<string>): void {
  try {
    saveProfileActivityReadState({ stateRoot, profile, ids });
  } catch {
    // Ignore read-state write failures for inbox best-effort mutations.
  }
}

function attachActivityConversationLinks(
  profile: string,
  entry: ReturnType<typeof listProfileActivityEntries>[number]['entry'],
  stateRoot?: string,
): ActivityEntry {
  const relatedConversationIds = getActivityConversationLink({
    stateRoot,
    profile,
    activityId: entry.id,
  })?.relatedConversationIds;

  if (!relatedConversationIds || relatedConversationIds.length === 0) {
    return entry;
  }

  return {
    ...entry,
    relatedConversationIds,
  };
}

function listActivityRecordsForProfile(profile: string): ActivityRecord[] {
  const records: ActivityRecord[] = [];

  for (const stateRoot of listActivityStateRoots()) {
    const readState = loadReadState(stateRoot, profile);
    const entries = listProfileActivityEntries({ stateRoot, profile });

    for (const { entry } of entries) {
      records.push({
        stateRoot,
        entry: attachActivityConversationLinks(profile, entry, stateRoot),
        read: readState.has(entry.id),
      });
    }
  }

  records.sort((left, right) => {
    const timestampCompare = right.entry.createdAt.localeCompare(left.entry.createdAt);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }

    if (left.stateRoot !== right.stateRoot) {
      return left.stateRoot ? 1 : -1;
    }

    return right.entry.id.localeCompare(left.entry.id);
  });

  const deduped: ActivityRecord[] = [];
  const seenIds = new Set<string>();

  for (const record of records) {
    if (seenIds.has(record.entry.id)) {
      continue;
    }

    seenIds.add(record.entry.id);
    deduped.push(record);
  }

  return deduped;
}

function deleteActivityIdsForProfile(profile: string, activityIds: Iterable<string>): string[] {
  const requestedIds = [...new Set(Array.from(activityIds)
    .filter((activityId): activityId is string => typeof activityId === 'string')
    .map((activityId) => activityId.trim())
    .filter((activityId) => activityId.length > 0))];

  if (requestedIds.length === 0) {
    return [];
  }

  const requestedIdSet = new Set(requestedIds);
  const deletedIds = new Set<string>();

  for (const stateRoot of listActivityStateRoots()) {
    const entries = listProfileActivityEntries({ stateRoot, profile });
    const matchingEntries = entries.filter(({ entry }) => requestedIdSet.has(entry.id));
    if (matchingEntries.length === 0) {
      continue;
    }

    const deletedInStateRoot = deleteProfileActivityEntries({
      stateRoot,
      profile,
      activityIds: matchingEntries.map(({ entry }) => entry.id),
    });

    for (const activityId of deletedInStateRoot) {
      clearActivityConversationLinks({ stateRoot, profile, activityId });
      deletedIds.add(activityId);
    }

    const readState = loadReadState(stateRoot, profile);
    let readStateChanged = false;
    for (const { entry } of matchingEntries) {
      readStateChanged = readState.delete(entry.id) || readStateChanged;
    }
    if (readStateChanged) {
      saveReadState(stateRoot, profile, readState);
    }
  }

  return [...deletedIds];
}

function markConversationSessionsRead(
  profile: string,
  sessions: Array<{ id: string; messageCount: number }>,
): string[] {
  const dedupedSessions = [...new Map(sessions.map((session) => [session.id, session])).values()];

  for (const session of dedupedSessions) {
    markConversationAttentionRead({
      profile,
      conversationId: session.id,
      messageCount: session.messageCount,
    });
  }

  return dedupedSessions.map((session) => session.id);
}

export function listActivityForCurrentProfile(profile: string): ActivityEntry[] {
  return listActivityRecordsForProfile(profile).map(({ entry, read }) => ({
    ...entry,
    read,
  }));
}

export function findActivityRecord(profile: string, activityId: string): ActivityRecord | undefined {
  return listActivityRecordsForProfile(profile).find((record) => record.entry.id === activityId);
}

export function markActivityReadState(profile: string, activityId: string, read: boolean): boolean {
  let changed = false;

  for (const stateRoot of listActivityStateRoots()) {
    const entries = listProfileActivityEntries({ stateRoot, profile });
    if (!entries.some(({ entry }) => entry.id === activityId)) {
      continue;
    }

    const state = loadReadState(stateRoot, profile);
    if (read) {
      state.add(activityId);
    } else {
      state.delete(activityId);
    }
    saveReadState(stateRoot, profile, state);
    changed = true;
  }

  return changed;
}

export function clearInboxForCurrentProfile(input: {
  profile: string;
  sessions: Array<{ id: string; messageCount: number; needsAttention?: boolean }>;
  openConversationIds: Iterable<string>;
}) {
  const activityRecords = listActivityRecordsForProfile(input.profile);
  const standaloneActivities = listStandaloneActivityRecords(activityRecords, input.sessions.map((session) => session.id));
  const archivedAttentionSessions = listArchivedAttentionSessions(input.sessions, input.openConversationIds);
  const deletedActivityIds = deleteActivityIdsForProfile(input.profile, standaloneActivities.map((record) => record.entry.id));
  const clearedConversationIds = markConversationSessionsRead(input.profile, archivedAttentionSessions);

  return {
    deletedActivityIds,
    clearedConversationIds,
  };
}

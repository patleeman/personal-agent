import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPiAgentRuntimeDir } from '@personal-agent/core';

type ActivityEntry = {
  id: string;
  profile: string;
  kind: string;
  summary: string;
  createdAt: string;
  details?: string;
  read?: boolean;
  relatedProjectIds?: string[];
  relatedConversationIds?: string[];
  notificationState?: string;
};

export type ActivityRecord = {
  entry: ActivityEntry;
  stateRoot: string;
  read: boolean;
};

const AGENT_DIR = getPiAgentRuntimeDir();

export function getInboxDirForProfile(profile: string) {
  return join(AGENT_DIR, 'profiles', profile, 'inbox');
}

export function listActivityForCurrentProfile(profile: string): ActivityEntry[] {
  const inboxDir = getInboxDirForProfile(profile);
  if (!existsSync(inboxDir)) {
    return [];
  }

  const entries: ActivityEntry[] = [];
  const files = readdirSync(inboxDir).filter((file) => file.endsWith('.json'));

  for (const file of files) {
    try {
      const content = readFileSync(join(inboxDir, file), 'utf-8');
      const record = JSON.parse(content) as ActivityRecord;
      entries.push({ ...record.entry, read: record.read });
    } catch {
      // Ignore corrupted records
    }
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findActivityRecord(profile: string, activityId: string): ActivityRecord | undefined {
  const inboxDir = getInboxDirForProfile(profile);
  const filePath = join(inboxDir, `${activityId}.json`);
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ActivityRecord;
  } catch {
    return undefined;
  }
}

export function markActivityReadState(profile: string, activityId: string, read: boolean): boolean {
  const inboxDir = getInboxDirForProfile(profile);
  const filePath = join(inboxDir, `${activityId}.json`);
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const record = JSON.parse(readFileSync(filePath, 'utf-8')) as ActivityRecord;
    if (record.read === read) {
      return true;
    }

    record.read = read;
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function clearInboxForCurrentProfile(profile: string) {
  const inboxDir = getInboxDirForProfile(profile);
  if (!existsSync(inboxDir)) {
    return { deletedActivityIds: [], clearedConversationIds: [] };
  }

  const files = readdirSync(inboxDir).filter((file) => file.endsWith('.json'));
  const deletedActivityIds: string[] = [];

  for (const file of files) {
    const activityId = file.replace('.json', '');
    try {
      rmSync(join(inboxDir, file));
      deletedActivityIds.push(activityId);
    } catch {
      // Ignore
    }
  }

  return { deletedActivityIds, clearedConversationIds: [] };
}

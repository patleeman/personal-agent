import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  readProjectActivityEntry,
  writeProjectActivityEntry,
  type ProjectActivityEntryDocument,
} from './project-artifacts.js';
import { getStateRoot } from './runtime/paths.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ACTIVITY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export interface ResolveActivityOptions {
  profile: string;
  stateRoot?: string;
  repoRoot?: string;
}

export interface ResolveActivityEntryPathOptions extends ResolveActivityOptions {
  activityId: string;
}

export interface StoredActivityEntry {
  path: string;
  entry: ProjectActivityEntryDocument;
}

function getActivityStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(
      `Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function validateActivityId(activityId: string): void {
  if (!ACTIVITY_ID_PATTERN.test(activityId)) {
    throw new Error(
      `Invalid activity id "${activityId}". Activity ids may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function resolveProfileActivityStateDir(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(getActivityStateRoot(options.stateRoot), 'pi-agent', 'state', 'inbox', options.profile);
}

export function resolveProfileActivityDir(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(resolveProfileActivityStateDir(options), 'activities');
}

export function resolveActivityEntryPath(options: ResolveActivityEntryPathOptions): string {
  validateProfileName(options.profile);
  validateActivityId(options.activityId);

  return join(resolveProfileActivityDir(options), `${options.activityId}.md`);
}

export function resolveActivityReadStatePath(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(resolveProfileActivityStateDir(options), 'read-state.json');
}

export function loadProfileActivityReadState(options: ResolveActivityOptions): Set<string> {
  const path = resolveActivityReadStatePath(options);

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0));
  } catch {
    return new Set();
  }
}

export function saveProfileActivityReadState(options: ResolveActivityOptions & { ids: Iterable<string> }): string {
  const path = resolveActivityReadStatePath(options);
  const normalizedIds = [...new Set(Array.from(options.ids)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0))]
    .sort();

  mkdirSync(resolveProfileActivityStateDir(options), { recursive: true });
  writeFileSync(path, JSON.stringify(normalizedIds));
  return path;
}

export function writeProfileActivityEntry(options: {
  profile: string;
  entry: ProjectActivityEntryDocument;
  stateRoot?: string;
  repoRoot?: string;
}): string {
  const path = resolveActivityEntryPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    activityId: options.entry.id,
  });

  writeProjectActivityEntry(path, options.entry);
  return path;
}

export function listProfileActivityEntries(options: ResolveActivityOptions): StoredActivityEntry[] {
  const activityDir = resolveProfileActivityDir(options);

  if (!existsSync(activityDir)) {
    return [];
  }

  const entries: StoredActivityEntry[] = [];

  for (const activityFile of readdirSync(activityDir, { withFileTypes: true })) {
    if (!activityFile.isFile() || !activityFile.name.endsWith('.md')) {
      continue;
    }

    const path = join(activityDir, activityFile.name);

    try {
      entries.push({
        path,
        entry: readProjectActivityEntry(path),
      });
    } catch {
      continue;
    }
  }

  entries.sort((left, right) => {
    const timestampCompare = right.entry.createdAt.localeCompare(left.entry.createdAt);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }

    return right.entry.id.localeCompare(left.entry.id);
  });

  return entries;
}

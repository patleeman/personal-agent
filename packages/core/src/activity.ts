import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  readProjectActivityEntry,
  writeProjectActivityEntry,
  type ProjectActivityEntryDocument,
} from './project-artifacts.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ACTIVITY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export interface ResolveActivityOptions {
  repoRoot?: string;
  profile: string;
}

export interface ResolveActivityEntryPathOptions extends ResolveActivityOptions {
  activityId: string;
}

export interface StoredActivityEntry {
  path: string;
  entry: ProjectActivityEntryDocument;
}

function getRepoRoot(repoRoot?: string): string {
  return resolve(repoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd());
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

export function resolveProfileActivityDir(options: ResolveActivityOptions): string {
  validateProfileName(options.profile);
  return join(getRepoRoot(options.repoRoot), 'profiles', options.profile, 'agent', 'activity');
}

export function resolveActivityEntryPath(options: ResolveActivityEntryPathOptions): string {
  validateProfileName(options.profile);
  validateActivityId(options.activityId);

  return join(resolveProfileActivityDir(options), `${options.activityId}.md`);
}

export function writeProfileActivityEntry(options: {
  repoRoot?: string;
  profile: string;
  entry: ProjectActivityEntryDocument;
}): string {
  const path = resolveActivityEntryPath({
    repoRoot: options.repoRoot,
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

  const entries = readdirSync(activityDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const path = join(activityDir, entry.name);
      return {
        path,
        entry: readProjectActivityEntry(path),
      };
    });

  entries.sort((left, right) => {
    const timestampCompare = right.entry.createdAt.localeCompare(left.entry.createdAt);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }

    return right.entry.id.localeCompare(left.entry.id);
  });

  return entries;
}

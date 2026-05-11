import { type ProjectActivityEntryDocument } from './project-artifacts.js';
export declare function closeActivityDbs(): void;
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
export declare function validateActivityId(activityId: string): void;
export declare function resolveProfileActivityStateDir(options: ResolveActivityOptions): string;
export declare function resolveProfileActivityDir(options: ResolveActivityOptions): string;
export declare function resolveActivityEntryPath(options: ResolveActivityEntryPathOptions): string;
export declare function resolveActivityReadStatePath(options: ResolveActivityOptions): string;
export declare function resolveProfileActivityDbPath(options: ResolveActivityOptions): string;
export declare function loadProfileActivityReadState(options: ResolveActivityOptions): Set<string>;
export declare function saveProfileActivityReadState(
  options: ResolveActivityOptions & {
    ids: Iterable<string>;
  },
): string;
export declare function writeProfileActivityEntry(options: {
  profile: string;
  entry: ProjectActivityEntryDocument;
  stateRoot?: string;
  repoRoot?: string;
}): string;
export declare function hasProfileActivityEntry(options: ResolveActivityEntryPathOptions): boolean;
export declare function getProfileActivityEntry(options: ResolveActivityEntryPathOptions): StoredActivityEntry | null;
export declare function deleteProfileActivityEntries(
  options: ResolveActivityOptions & {
    activityIds: Iterable<string>;
  },
): string[];
export declare function listProfileActivityEntries(options: ResolveActivityOptions): StoredActivityEntry[];

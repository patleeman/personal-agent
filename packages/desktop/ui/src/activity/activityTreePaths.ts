import type { ActivityTreeItem } from './activityTree';

export interface ActivityTreePathEntry {
  item: ActivityTreeItem;
  path: string;
}

export interface ActivityTreePathModel {
  entries: ActivityTreePathEntry[];
  pathById: Map<string, string>;
  itemByPath: Map<string, ActivityTreeItem>;
  paths: string[];
}

export function buildActivityTreePathModel(items: readonly ActivityTreeItem[]): ActivityTreePathModel {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const pathById = new Map<string, string>();
  const usedSiblingSlugsByParent = new Map<string, Set<string>>();

  function buildPath(item: ActivityTreeItem, seen = new Set<string>()): string {
    const existing = pathById.get(item.id);
    if (existing) return existing;

    if (seen.has(item.id)) {
      return uniqueSegment(item, usedSiblingSlugsByParent, '');
    }

    const nextSeen = new Set(seen);
    nextSeen.add(item.id);
    const parent = item.parentId ? itemById.get(item.parentId) : undefined;
    const parentPath = parent ? buildPath(parent, nextSeen) : '';
    const segment = uniqueSegment(item, usedSiblingSlugsByParent, parentPath);
    const path = parentPath ? `${parentPath}/${segment}` : segment;
    pathById.set(item.id, path);
    return path;
  }

  const entries = items.map((item) => ({ item, path: buildPath(item) }));
  entries.sort((left, right) => left.path.localeCompare(right.path));

  return {
    entries,
    pathById,
    itemByPath: new Map(entries.map((entry) => [entry.path, entry.item])),
    paths: entries.map((entry) => entry.path),
  };
}

function uniqueSegment(item: ActivityTreeItem, usedSiblingSlugsByParent: Map<string, Set<string>>, parentPath: string): string {
  const used = usedSiblingSlugsByParent.get(parentPath) ?? new Set<string>();
  usedSiblingSlugsByParent.set(parentPath, used);

  const base = slugTreeSegment(item.title || item.id) || item.kind;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base} ${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function slugTreeSegment(value: string): string {
  return value
    .replace(/[\\/]+/g, ' ')
    .replace(/[\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

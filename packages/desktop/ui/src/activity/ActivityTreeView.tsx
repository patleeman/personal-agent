import type { FileTreeContextMenuOpenContext } from '@pierre/trees';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { ActivityTreeItem } from './activityTree';
import { buildActivityTreePathModel } from './activityTreePaths';

interface ActivityTreeViewProps {
  items: readonly ActivityTreeItem[];
  activeItemId?: string | null;
  className?: string;
  style?: CSSProperties;
  onArchiveItem?: (item: ActivityTreeItem) => void;
  onOpenItem?: (item: ActivityTreeItem) => void;
  renderContextMenu?: (item: ActivityTreeItem, context: FileTreeContextMenuOpenContext) => ReactNode;
}

interface ActivityTreeContextMenuState {
  item: ActivityTreeItem;
  x: number;
  y: number;
}

export function ActivityTreeView({
  items,
  activeItemId,
  className,
  style,
  onArchiveItem,
  onOpenItem,
  renderContextMenu,
}: ActivityTreeViewProps) {
  const pathModel = useMemo(() => buildActivityTreePathModel(items), [items]);
  const selectedPath = activeItemId ? pathModel.pathById.get(activeItemId) : undefined;
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.parentId) continue;
      counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<ActivityTreeContextMenuState | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const toggleExpanded = useCallback((itemId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const visibleEntries = useMemo(
    () => pathModel.entries.filter(({ item }) => !item.parentId || expandedIds.has(item.parentId)),
    [expandedIds, pathModel.entries],
  );

  if (pathModel.entries.length === 0) {
    return <p className="px-4 py-2 text-[12px] text-dim">No threads yet.</p>;
  }

  return (
    <div className={className} style={style} onClick={contextMenu ? closeContextMenu : undefined}>
      <div role="tree" aria-label="Threads" className="space-y-px px-1 py-0.5">
        {visibleEntries.map(({ item, path }) => {
          const depth = item.parentId ? Math.max(1, path.split('/').length - 1) : 0;
          const active = path === selectedPath;
          const accentColor = sanitizeCssColor(item.accentColor);
          const backgroundColor = sanitizeCssColor(item.backgroundColor);
          const childCount = childCountByParentId.get(item.id) ?? 0;
          const expanded = expandedIds.has(item.id);
          const canArchive = item.kind === 'conversation' && onArchiveItem;
          return (
            <button
              key={item.id}
              type="button"
              role="treeitem"
              aria-selected={active ? 'true' : 'false'}
              className={[
                'ui-sidebar-session-row group flex w-full items-center gap-1 select-none text-left',
                active && 'ui-sidebar-session-row-active',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                paddingLeft: `${0.5 + depth * 0.5}rem`,
                ...(backgroundColor ? { backgroundColor } : {}),
                ...(accentColor ? { boxShadow: `inset 2px 0 0 ${accentColor}` } : {}),
              }}
              title={typeof item.metadata?.tooltip === 'string' ? item.metadata.tooltip : item.subtitle}
              onClick={() => onOpenItem?.(item)}
              onContextMenu={(event) => {
                if (!renderContextMenu) return;
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ item, x: event.clientX, y: event.clientY });
              }}
            >
              {childCount > 0 ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="-ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-dim hover:text-primary"
                  aria-label={expanded ? 'Collapse runs' : 'Expand runs'}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleExpanded(item.id);
                  }}
                >
                  {expanded ? '▾' : '▸'}
                </span>
              ) : depth > 0 ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-subtle" aria-hidden="true" />
              ) : (
                <span className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] leading-[1.15] text-primary">{item.title}</span>
              {item.status !== 'idle' ? (
                <span className="shrink-0 text-[10px] text-dim">{formatActivityTreeStatus(item.status)}</span>
              ) : null}
              {canArchive ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="shrink-0 rounded px-1 text-[12px] text-dim opacity-0 hover:bg-surface-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label="Archive thread"
                  title="Archive thread"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onArchiveItem(item);
                  }}
                >
                  ⌫
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {contextMenu && renderContextMenu ? (
        <div
          data-file-tree-context-menu-root="true"
          className="fixed z-[1000]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {renderContextMenu(contextMenu.item, {
            anchorElement: document.body,
            anchorRect: { x: contextMenu.x, y: contextMenu.y, width: 1, height: 1 },
            close: closeContextMenu,
            restoreFocus: () => {},
          } as FileTreeContextMenuOpenContext)}
        </div>
      ) : null}
    </div>
  );
}

function formatActivityTreeStatus(status: ActivityTreeItem['status']): string {
  switch (status) {
    case 'running':
      return 'run';
    case 'queued':
      return 'wait';
    case 'failed':
      return 'fail';
    case 'done':
      return 'done';
    case 'idle':
    default:
      return 'idle';
  }
}

function sanitizeCssColor(value: string | undefined): string | null {
  const color = value?.trim();
  if (!color) return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.test(color)) return color;
  if (/^color-mix\(in srgb, #[0-9a-fA-F]{3,8} \d{1,3}%, transparent\)$/.test(color)) return color;
  return null;
}

export function useActivityTreeModel(items: readonly ActivityTreeItem[], activeItemId?: string | null) {
  const pathModel = useMemo(() => buildActivityTreePathModel(items), [items]);
  return {
    pathModel,
    selectedPath: activeItemId ? pathModel.pathById.get(activeItemId) : undefined,
  };
}

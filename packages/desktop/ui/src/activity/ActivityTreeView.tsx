import type { FileTreeContextMenuOpenContext } from '@pierre/trees';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConversationStatusText } from '../components/ConversationStatusText';
import { timeAgoCompact } from '../shared/utils';
import type { ActivityTreeItem } from './activityTree';
import { buildActivityTreePathModel } from './activityTreePaths';

export type ActivityTreeDropPosition = 'before' | 'after';

interface ActivityTreeViewProps {
  items: readonly ActivityTreeItem[];
  activeItemId?: string | null;
  className?: string;
  style?: CSSProperties;
  canDragItem?: (item: ActivityTreeItem) => boolean;
  canDropItem?: (
    draggedItem: ActivityTreeItem,
    targetItem: ActivityTreeItem,
    position: ActivityTreeDropPosition,
    event: DragEvent<HTMLElement>,
  ) => boolean;
  collapsedGroupItemIds?: ReadonlySet<string>;
  onToggleGroupItem?: (item: ActivityTreeItem) => void;
  onArchiveItem?: (item: ActivityTreeItem) => void;
  onCreateChildItem?: (item: ActivityTreeItem) => void;
  onOpenItem?: (item: ActivityTreeItem) => void;
  onDragStartItem?: (item: ActivityTreeItem, event: DragEvent<HTMLElement>) => void;
  onDropItem?: (
    draggedItem: ActivityTreeItem,
    targetItem: ActivityTreeItem,
    position: ActivityTreeDropPosition,
    event: DragEvent<HTMLElement>,
  ) => void;
  onDragEndItem?: () => void;
  renderContextMenu?: (item: ActivityTreeItem, context: FileTreeContextMenuOpenContext) => ReactNode;
}

interface ActivityTreeContextMenuState {
  item: ActivityTreeItem;
  x: number;
  y: number;
}

function PinIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15.75 3.75 4.5 4.5-3 3v3l-2.25 2.25-7.5-7.5L9.75 6.75h3l3-3ZM9.75 14.25 4.5 19.5" />
    </svg>
  );
}

export function ActivityTreeView({
  items,
  activeItemId,
  className,
  style,
  canDragItem,
  canDropItem,
  collapsedGroupItemIds,
  onToggleGroupItem,
  onArchiveItem,
  onCreateChildItem,
  onOpenItem,
  onDragStartItem,
  onDropItem,
  onDragEndItem,
  renderContextMenu,
}: ActivityTreeViewProps) {
  const pathModel = useMemo(() => buildActivityTreePathModel(items), [items]);
  const selectedPath = activeItemId ? pathModel.pathById.get(activeItemId) : undefined;
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item] as const)), [items]);
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.parentId) continue;
      counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<ActivityTreeContextMenuState | null>(null);
  const contextMenuRootRef = useRef<HTMLDivElement | null>(null);
  const draggedItemIdRef = useRef<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ itemId: string; position: ActivityTreeDropPosition } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu || typeof document === 'undefined') return;

    const closeIfOutsideMenu = (event: MouseEvent | PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRootRef.current?.contains(target)) return;
      closeContextMenu();
    };

    document.addEventListener('pointerdown', closeIfOutsideMenu, true);
    document.addEventListener('contextmenu', closeIfOutsideMenu, true);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutsideMenu, true);
      document.removeEventListener('contextmenu', closeIfOutsideMenu, true);
    };
  }, [closeContextMenu, contextMenu]);

  const toggleGroupCollapsed = useCallback(
    (item: ActivityTreeItem) => {
      if (collapsedGroupItemIds && onToggleGroupItem) {
        onToggleGroupItem(item);
        return;
      }

      setCollapsedGroupIds((current) => {
        const next = new Set(current);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    },
    [collapsedGroupItemIds, onToggleGroupItem],
  );
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
    () =>
      pathModel.entries.filter(({ item, path }) => {
        if (!item.parentId) return true;
        const parent = itemById.get(item.parentId);
        if (parent?.kind === 'group') return !(collapsedGroupItemIds ?? collapsedGroupIds).has(parent.id);
        return expandedIds.has(item.parentId) || path === selectedPath || Boolean(selectedPath?.startsWith(`${path}/`));
      }),
    [collapsedGroupIds, collapsedGroupItemIds, expandedIds, itemById, pathModel.entries, selectedPath],
  );

  function getDropPosition(event: DragEvent<HTMLElement>): ActivityTreeDropPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }

  function clearDragState() {
    draggedItemIdRef.current = null;
    setDraggedItemId(null);
    setDropTarget(null);
  }

  if (pathModel.entries.length === 0) {
    return <p className="px-4 py-2 text-[12px] text-dim">No threads yet.</p>;
  }

  return (
    <div className={className} style={style} onClick={contextMenu ? closeContextMenu : undefined}>
      <div role="tree" aria-label="Threads" className="space-y-px px-1 py-0.5">
        {visibleEntries.map(({ item, path }) => {
          const depth = Math.max(0, path.split('/').filter(Boolean).length - 1);
          const active = path === selectedPath;
          const accentColor = sanitizeCssColor(item.accentColor);
          const backgroundColor = sanitizeCssColor(item.backgroundColor);
          const childCount = childCountByParentId.get(item.id) ?? 0;
          const expanded =
            item.kind === 'group'
              ? !(collapsedGroupItemIds ?? collapsedGroupIds).has(item.id)
              : expandedIds.has(item.id) || Boolean(selectedPath?.startsWith(path));
          const canDrag = Boolean(canDragItem?.(item));
          const rowDropPosition = dropTarget?.itemId === item.id ? dropTarget.position : null;
          const canArchive = item.kind === 'conversation' && onArchiveItem;
          const canCreateChild = item.kind === 'group' && onCreateChildItem;
          const conversationIsRunning = item.kind === 'conversation' && item.metadata?.isRunning === true;
          const conversationNeedsAttention = item.kind === 'conversation' && item.metadata?.needsAttention === true;
          const conversationHasPendingRuns = item.kind === 'conversation' && item.metadata?.hasPendingRuns === true;
          const conversationIsPinned = item.kind === 'conversation' && item.metadata?.isPinned === true;
          const showConversationStatus = conversationIsRunning || conversationHasPendingRuns || conversationNeedsAttention;
          const rowPaddingLeft = item.kind === 'group' ? 0.5 : 0.5 + depth * 0.5;
          return (
            <button
              key={item.id}
              type="button"
              role="treeitem"
              aria-selected={active ? 'true' : 'false'}
              draggable={canDrag}
              onDragStart={
                canDrag
                  ? (event) => {
                      draggedItemIdRef.current = item.id;
                      setDraggedItemId(item.id);
                      onDragStartItem?.(item, event);
                    }
                  : undefined
              }
              onDragOver={(event) => {
                const currentDraggedItemId = draggedItemIdRef.current ?? draggedItemId;
                const draggedItem = currentDraggedItemId ? itemById.get(currentDraggedItemId) : null;
                if (!draggedItem || draggedItem.id === item.id) {
                  setDropTarget(null);
                  return;
                }

                const position = getDropPosition(event);
                if (!canDropItem?.(draggedItem, item, position, event)) {
                  if (dropTarget?.itemId === item.id) setDropTarget(null);
                  return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget((current) =>
                  current?.itemId === item.id && current.position === position ? current : { itemId: item.id, position },
                );
              }}
              onDrop={(event) => {
                const currentDraggedItemId = draggedItemIdRef.current ?? draggedItemId;
                const draggedItem = currentDraggedItemId ? itemById.get(currentDraggedItemId) : null;
                if (!draggedItem) {
                  clearDragState();
                  return;
                }

                const position = getDropPosition(event);
                if (canDropItem?.(draggedItem, item, position, event)) {
                  event.preventDefault();
                  onDropItem?.(draggedItem, item, position, event);
                }
                clearDragState();
              }}
              onDragEnd={() => {
                clearDragState();
                onDragEndItem?.();
              }}
              className={[
                'ui-sidebar-session-row group relative flex w-full items-center gap-1 select-none text-left',
                item.kind === 'group' && 'font-semibold',
                active && 'ui-sidebar-session-row-active',
                canDrag && (draggedItemId === item.id ? 'cursor-grabbing opacity-60' : 'cursor-grab'),
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                paddingLeft: `${rowPaddingLeft}rem`,
                ...(backgroundColor ? { backgroundColor } : {}),
                ...(accentColor ? { boxShadow: `inset 2px 0 0 ${accentColor}` } : {}),
              }}
              data-sidebar-session-id={typeof item.metadata?.conversationId === 'string' ? item.metadata.conversationId : undefined}
              data-sidebar-group-key={typeof item.metadata?.groupKey === 'string' ? item.metadata.groupKey : undefined}
              title={
                canDrag
                  ? 'Drag to reorder conversations'
                  : typeof item.metadata?.tooltip === 'string'
                    ? item.metadata.tooltip
                    : item.subtitle
              }
              aria-expanded={item.kind === 'group' ? expanded : undefined}
              onClick={() => {
                if (item.kind === 'group') {
                  toggleGroupCollapsed(item);
                  return;
                }
                onOpenItem?.(item);
              }}
              onContextMenu={(event) => {
                if (!renderContextMenu) return;
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ item, x: event.clientX, y: event.clientY });
              }}
            >
              {rowDropPosition ? (
                <span
                  aria-hidden="true"
                  className={[
                    'pointer-events-none absolute left-2 right-2 z-10 h-0.5 rounded-full bg-accent/80',
                    rowDropPosition === 'before' ? 'top-0' : 'bottom-0',
                  ].join(' ')}
                />
              ) : null}
              {showConversationStatus ? (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                  <ConversationStatusText
                    isRunning={conversationIsRunning}
                    hasPendingRuns={conversationHasPendingRuns}
                    needsAttention={conversationNeedsAttention}
                  />
                </span>
              ) : item.kind === 'group' ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="-ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-dim hover:text-primary"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleGroupCollapsed(item);
                  }}
                >
                  {expanded ? '▾' : '▸'}
                </span>
              ) : childCount > 0 && item.kind !== 'conversation' ? (
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
              ) : depth > 0 && item.kind !== 'conversation' ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-subtle" aria-hidden="true" />
              ) : (
                <span className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {conversationIsPinned ? (
                <span className="ui-sidebar-pinned-icon shrink-0" title="Pinned chat" aria-label="Pinned chat">
                  <PinIcon />
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[12px] leading-[1.15] text-primary">{item.title}</span>
              {item.status !== 'idle' && item.kind !== 'conversation' ? (
                <span className="shrink-0 text-[10px] text-dim">{formatActivityTreeStatus(item.status)}</span>
              ) : null}
              {item.kind === 'group' && renderContextMenu ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="shrink-0 rounded px-1 text-[16px] leading-none text-dim hover:bg-surface-hover hover:text-primary"
                  aria-label={`Workspace actions for ${item.title}`}
                  title={
                    typeof item.metadata?.cwd === 'string'
                      ? `Workspace actions for ${item.metadata.cwd}`
                      : `Workspace actions for ${item.title}`
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({ item, x: rect.left, y: rect.bottom + 4 });
                  }}
                >
                  …
                </span>
              ) : null}
              {canCreateChild ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="shrink-0 rounded px-1 text-[14px] leading-none text-dim hover:bg-surface-hover hover:text-primary"
                  aria-label={`New conversation in ${item.title}`}
                  title={
                    typeof item.metadata?.cwd === 'string'
                      ? `New conversation in ${item.metadata.cwd}`
                      : `New conversation in ${item.title}`
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCreateChildItem(item);
                  }}
                >
                  +
                </span>
              ) : null}
              {item.kind === 'conversation' && item.updatedAt ? (
                <span className="ui-sidebar-session-meta ui-sidebar-session-time shrink-0 whitespace-nowrap">
                  {timeAgoCompact(item.updatedAt)}
                </span>
              ) : null}
              {canArchive ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="shrink-0 rounded px-1 text-[14px] leading-none text-dim opacity-0 hover:bg-surface-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label="Archive thread"
                  title="Archive thread"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onArchiveItem(item);
                  }}
                >
                  ×
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {contextMenu && renderContextMenu ? (
        <div
          ref={contextMenuRootRef}
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

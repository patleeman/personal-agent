import type { FileTreeContextMenuItem, FileTreeContextMenuOpenContext, FileTreeRowDecorationRenderer } from '@pierre/trees';
import { FileTree as TreesFileTree } from '@pierre/trees/react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo } from 'react';

import { useFileTreeModel } from '../components/shared/useFileTreeModel';
import type { ActivityTreeItem } from './activityTree';
import { buildActivityTreePathModel } from './activityTreePaths';
import { buildActivityTreeUnsafeCss } from './activityTreeStyles';

interface ActivityTreeViewProps {
  items: readonly ActivityTreeItem[];
  activeItemId?: string | null;
  className?: string;
  style?: CSSProperties;
  onOpenItem?: (item: ActivityTreeItem) => void;
  renderContextMenu?: (item: ActivityTreeItem, context: FileTreeContextMenuOpenContext) => ReactNode;
}

const ACTIVITY_TREE_STYLE = {
  '--trees-selected-bg-override': 'color-mix(in srgb, var(--color-accent, #8b5cf6) 15%, transparent)',
  '--trees-border-color-override': 'transparent',
} as CSSProperties;

export function ActivityTreeView({ items, activeItemId, className, style, onOpenItem, renderContextMenu }: ActivityTreeViewProps) {
  const pathModel = useMemo(() => buildActivityTreePathModel(items), [items]);
  const selectedPath = activeItemId ? pathModel.pathById.get(activeItemId) : undefined;
  const unsafeCSS = useMemo(() => buildActivityTreeUnsafeCss(pathModel), [pathModel]);
  const handleSelectionChange = useCallback(
    (paths: readonly string[]) => {
      const path = paths[0];
      if (!path) return;
      const item = pathModel.itemByPath.get(path);
      if (item) onOpenItem?.(item);
    },
    [onOpenItem, pathModel],
  );
  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>(
    ({ item }) => {
      const activityItem = pathModel.itemByPath.get(item.path);
      if (!activityItem) return null;

      if (activityItem.kind === 'run') {
        return { text: formatActivityTreeStatus(activityItem.status), title: `Run · ${activityItem.status}` };
      }

      if (activityItem.status === 'running' || activityItem.status === 'failed') {
        return { text: formatActivityTreeStatus(activityItem.status), title: activityItem.status };
      }

      return null;
    },
    [pathModel],
  );

  const { model, resetTree } = useFileTreeModel({
    useNativeContextMenu: false,
    dragAndDrop: false,
    onSelectionChange: handleSelectionChange,
    renderRowDecoration,
    unsafeCSS,
  });

  useEffect(() => {
    resetTree(pathModel.paths, {
      initialExpandedPaths: pathModel.paths,
      initialSelectedPaths: selectedPath ? [selectedPath] : [],
    });
  }, [pathModel, resetTree, selectedPath]);

  const renderTreeContextMenu = useCallback(
    (treeItem: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => {
      const item = pathModel.itemByPath.get(treeItem.path);
      return item ? renderContextMenu?.(item, context) : null;
    },
    [pathModel, renderContextMenu],
  );

  return (
    <TreesFileTree
      className={className}
      model={model}
      renderContextMenu={renderContextMenu ? renderTreeContextMenu : undefined}
      style={{ ...ACTIVITY_TREE_STYLE, ...style }}
    />
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

export function useActivityTreeModel(items: readonly ActivityTreeItem[], activeItemId?: string | null) {
  const pathModel = useMemo(() => buildActivityTreePathModel(items), [items]);
  return {
    pathModel,
    selectedPath: activeItemId ? pathModel.pathById.get(activeItemId) : undefined,
  };
}

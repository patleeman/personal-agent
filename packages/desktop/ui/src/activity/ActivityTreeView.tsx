import { FileTree as TreesFileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo } from 'react';

import { useFileTreeModel } from '../components/shared/useFileTreeModel';
import type { ActivityTreeItem } from './activityTree';
import { buildActivityTreePathModel } from './activityTreePaths';

interface ActivityTreeViewProps {
  items: readonly ActivityTreeItem[];
  activeItemId?: string | null;
  className?: string;
  style?: CSSProperties;
  onOpenItem?: (item: ActivityTreeItem) => void;
}

const ACTIVITY_TREE_STYLE = {
  '--trees-selected-bg-override': 'color-mix(in srgb, var(--color-accent, #8b5cf6) 15%, transparent)',
  '--trees-border-color-override': 'transparent',
} as CSSProperties;

export function ActivityTreeView({ items, activeItemId, className, style, onOpenItem }: ActivityTreeViewProps) {
  const pathModel = useMemo(() => buildActivityTreePathModel(items), [items]);
  const selectedPath = activeItemId ? pathModel.pathById.get(activeItemId) : undefined;
  const handleSelectionChange = useCallback(
    (paths: readonly string[]) => {
      const path = paths[0];
      if (!path) return;
      const item = pathModel.itemByPath.get(path);
      if (item) onOpenItem?.(item);
    },
    [onOpenItem, pathModel],
  );
  const { model, resetTree } = useFileTreeModel({
    useNativeContextMenu: false,
    dragAndDrop: false,
    onSelectionChange: handleSelectionChange,
  });

  useEffect(() => {
    resetTree(pathModel.paths, {
      initialExpandedPaths: pathModel.paths,
      initialSelectedPaths: selectedPath ? [selectedPath] : [],
    });
  }, [pathModel, resetTree, selectedPath]);

  return <TreesFileTree className={className} model={model} style={{ ...ACTIVITY_TREE_STYLE, ...style }} />;
}

export function useActivityTreeModel(items: readonly ActivityTreeItem[], activeItemId?: string | null) {
  const pathModel = useMemo(() => buildActivityTreePathModel(items), [items]);
  return {
    pathModel,
    selectedPath: activeItemId ? pathModel.pathById.get(activeItemId) : undefined,
  };
}

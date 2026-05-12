/**
 * Shared file tree model hook.
 *
 * Manages the @pierre/trees TreesModel lifecycle, selection tracking,
 * keyboard shortcuts, and multi-select action helpers used by both the
 * knowledge vault tree and the workspace explorer.
 */

import {
  type ContextMenuItem as FileTreeContextMenuItem,
  type ContextMenuOpenContext as FileTreeContextMenuOpenContext,
  FileTree as TreesModel,
  type FileTreeContextMenuTriggerMode,
  type FileTreeDragAndDropConfig,
  type FileTreeDropContext,
  type FileTreeDropResult,
  type FileTreeRenameEvent,
  type FileTreeRowDecorationRenderer,
} from '@pierre/trees';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { addNotification } from '../notifications/notificationStore';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Given a list of paths (files and/or folders), return only the top-level
 * ones — if a folder is selected, its descendants are excluded.
 */
export function getTopLevelDraggedPaths(paths: readonly string[]): string[] {
  const sorted = [...paths].sort((left, right) => left.length - right.length || left.localeCompare(right));
  return sorted.filter((path, index) => !sorted.slice(0, index).some((candidate) => candidate.endsWith('/') && path.startsWith(candidate)));
}

/**
 * Check whether every path in a list is a valid drop/move target.
 */
export function canDropAllPaths(
  paths: readonly string[],
  targetDir: string,
  canDrop: (path: string, targetDir: string) => boolean,
): boolean {
  return paths.every((path) => canDrop(path, targetDir));
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseFileTreeModelOptions {
  /** Whether search is enabled. Default false. */
  search?: boolean;
  /** Context menu trigger mode. Default 'right-click'. */
  contextMenuTrigger?: FileTreeContextMenuTriggerMode;
  /** Whether to use native OS context menus. */
  useNativeContextMenu: boolean;
  /** Drag-and-drop config or false to disable. */
  dragAndDrop?: false | FileTreeDragAndDropConfig;
  /** Called when selection changes. */
  onSelectionChange?: (paths: readonly string[]) => void;
  /** Called on rename. */
  onRename?: (event: FileTreeRenameEvent) => void;
  /** Optional lightweight row decoration renderer. */
  renderRowDecoration?: FileTreeRowDecorationRenderer;
  /** Optional CSS injected into the tree shadow root. Prefer tokens and keep this narrow. */
  unsafeCSS?: string;
}

export interface UseFileTreeModelResult {
  /** The TreesModel instance. */
  model: TreesModel;
  /** Updates the tree with a new set of paths, preserving expanded/selected state. */
  resetTree: (
    paths: readonly string[],
    options?: { initialExpandedPaths?: readonly string[]; initialSelectedPaths?: readonly string[] },
  ) => void;
  /** Ref that is kept in sync with the current selected paths. */
  selectedPathsRef: React.RefObject<readonly string[]>;
  /** Ref to set as the native context menu open handler. */
  nativeContextMenuOpenRef: React.RefObject<(item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => void>;
  /** Ref for the non-native renderContextMenu callback. */
  selectionChangeRef: React.RefObject<(paths: readonly string[]) => void>;
  /** Ref for the rename callback. */
  renameRef: React.RefObject<(event: FileTreeRenameEvent) => void>;
  /** Ref for canDrop callback. */
  canDropRef: React.RefObject<(event: FileTreeDropContext) => boolean>;
  /** Ref for drop complete callback. */
  dropCompleteRef: React.RefObject<(event: FileTreeDropResult) => void>;
}

export function useFileTreeModel({
  search = false,
  contextMenuTrigger = 'right-click',
  useNativeContextMenu,
  dragAndDrop,
  onSelectionChange,
  onRename,
  renderRowDecoration,
  unsafeCSS,
}: UseFileTreeModelOptions): UseFileTreeModelResult {
  const selectedPathsRef = useRef<readonly string[]>([]);
  const nativeContextMenuOpenRef = useRef<(item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => void>(() => {});
  const selectionChangeRef = useRef<(paths: readonly string[]) => void>(() => {});
  const renameRef = useRef<(event: FileTreeRenameEvent) => void>(() => {});
  const canDropRef = useRef<(event: FileTreeDropContext) => boolean>(() => false);
  const dropCompleteRef = useRef<(event: FileTreeDropResult) => void>(() => {});

  // Build the TreesModel. Immutable config (composition, renaming, dragAndDrop,
  // search) is set at construction. Mutable callbacks (selection, rename) are
  // wired through refs so they can update without rebuilding the model.
  const model = useMemo(
    () =>
      new TreesModel({
        paths: [],
        search,
        composition: {
          contextMenu: useNativeContextMenu
            ? {
                enabled: true,
                triggerMode: contextMenuTrigger,
                onOpen: (item, context) => nativeContextMenuOpenRef.current(item, context),
              }
            : { triggerMode: contextMenuTrigger },
        },
        onSelectionChange: (paths) => selectionChangeRef.current(paths),
        renaming: { onRename: (event) => renameRef.current(event) },
        ...(renderRowDecoration ? { renderRowDecoration } : {}),
        ...(unsafeCSS ? { unsafeCSS } : {}),
        ...(dragAndDrop !== false
          ? {
              dragAndDrop: {
                canDrop: (event) => canDropRef.current(event),
                onDropComplete: (event) => dropCompleteRef.current(event),
                onDropError: (error) => {
                  console.error('tree drop failed', error);
                  addNotification({
                    type: 'warning',
                    message: 'File move failed',
                    details: error instanceof Error ? error.message : String(error),
                    source: 'core',
                  });
                },
                ...(typeof dragAndDrop === 'object' ? dragAndDrop : {}),
              },
            }
          : {}),
      }),
    // These are the immutable options — the model must be rebuilt when they change.
    [search, contextMenuTrigger, renderRowDecoration, unsafeCSS, useNativeContextMenu],
  );

  const resetTree = useCallback(
    (paths: readonly string[], options?: { initialExpandedPaths?: readonly string[]; initialSelectedPaths?: readonly string[] }) => {
      model.resetPaths([...paths], {
        ...(options?.initialExpandedPaths ? { initialExpandedPaths: [...options.initialExpandedPaths] } : {}),
        ...(options?.initialSelectedPaths ? { initialSelectedPaths: [...options.initialSelectedPaths] } : {}),
      });
    },
    [model],
  );

  // Wire up mutable callbacks through refs
  useEffect(() => {
    selectionChangeRef.current = (paths) => {
      selectedPathsRef.current = paths;
      onSelectionChange?.(paths);
    };
  }, [onSelectionChange]);

  useEffect(() => {
    renameRef.current = (event) => {
      onRename?.(event);
    };
  }, [onRename]);

  // Wire up DnD refs
  useEffect(() => {
    if (dragAndDrop && typeof dragAndDrop === 'object') {
      if (dragAndDrop.canDrop) {
        canDropRef.current = dragAndDrop.canDrop;
      }
      if (dragAndDrop.onDropComplete) {
        dropCompleteRef.current = dragAndDrop.onDropComplete;
      }
    }
  }, [dragAndDrop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        model.cleanUp();
      } catch {
        // model may already be disposed
      }
    };
  }, []);

  return {
    model,
    resetTree,
    selectedPathsRef,
    nativeContextMenuOpenRef,
    selectionChangeRef,
    renameRef,
    canDropRef,
    dropCompleteRef,
  };
}

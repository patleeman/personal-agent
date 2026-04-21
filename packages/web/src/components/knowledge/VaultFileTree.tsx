import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { vaultApi } from '../../client/api';
import type { VaultEntry } from '../../shared/types';

// ── Icons ─────────────────────────────────────────────────────────────────────

function Ico({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  folder: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 8.25v9A2.25 2.25 0 0 1 18 19.5H6A2.25 2.25 0 0 1 3.75 17.25V6Z',
  folderOpen: 'M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66h3.96A2.25 2.25 0 0 1 20.25 8.25v1.526',
  file: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  chevRight: 'm9 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  folderPlus: 'M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z',
  trash: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
  pencil: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileTreeProps {
  activeFileId: string | null;
  onFileSelect: (id: string) => void;
  onFileCreated?: (id: string) => void;
  refreshKey?: number;
}

interface TreeNode {
  entry: VaultEntry;
  children: TreeNode[] | null; // null = not loaded yet
  expanded: boolean;
}

type EditState =
  | { type: 'rename'; id: string; value: string }
  | { type: 'new-file'; parentDir: string; value: string }
  | { type: 'new-folder'; parentDir: string; value: string };

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  entry: VaultEntry;
}

function ContextMenu({
  state,
  onRename,
  onDelete,
  onClose,
}: {
  state: ContextMenuState;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] rounded-lg border border-border-default bg-elevated shadow-lg py-1 text-[12px]"
      style={{ left: state.x, top: state.y }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-secondary hover:bg-accent/10 hover:text-primary"
        onClick={() => { onRename(); onClose(); }}
      >
        <Ico d={ICON.pencil} size={12} />
        Rename
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-danger/10"
        onClick={() => { onDelete(); onClose(); }}
      >
        <Ico d={ICON.trash} size={12} />
        Delete
      </button>
    </div>
  );
}

// ── Inline name input ─────────────────────────────────────────────────────────

function NameInput({
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={onCancel}
      className="flex-1 min-w-0 bg-accent/10 rounded px-1 py-0 text-[12px] text-primary outline-none border border-accent/40"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ── Tree node row ─────────────────────────────────────────────────────────────

function TreeRow({
  node,
  depth,
  isActive,
  editState,
  onSelect,
  onToggle,
  onContextMenu,
  onEditChange,
  onEditConfirm,
  onEditCancel,
}: {
  node: TreeNode;
  depth: number;
  isActive: boolean;
  editState: EditState | null;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
}) {
  const isFolder = node.entry.kind === 'folder';
  const isRenaming = editState?.type === 'rename' && editState.id === node.entry.id;

  return (
    <button
      type="button"
      aria-label={node.entry.name}
      className={[
        'group flex w-full items-center gap-1 px-2 py-[3px] rounded-md cursor-pointer select-none text-[12px] leading-tight text-left',
        isActive ? 'bg-accent/15 text-primary' : 'text-secondary hover:bg-accent/8 hover:text-primary',
      ].join(' ')}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={isFolder ? onToggle : onSelect}
      onContextMenu={onContextMenu}
    >
      {/* chevron for folders */}
      {isFolder ? (
        <span
          className="shrink-0 w-3 flex items-center justify-center text-dim"
          style={{
            transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms',
          }}
        >
          <Ico d={ICON.chevRight} size={10} />
        </span>
      ) : (
        <span className="shrink-0 w-3" />
      )}

      {/* icon */}
      <span className="shrink-0 text-dim">
        {isFolder
          ? <Ico d={node.expanded ? ICON.folderOpen : ICON.folder} size={12} />
          : <Ico d={ICON.file} size={12} />
        }
      </span>

      {/* name or rename input */}
      {isRenaming ? (
        <NameInput
          value={(editState as { value: string }).value}
          onChange={onEditChange}
          onConfirm={onEditConfirm}
          onCancel={onEditCancel}
        />
      ) : (
        <span className="flex-1 truncate">{node.entry.name}</span>
      )}
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function idToDir(id: string): string {
  // folder ids end with /, files don't
  if (id.endsWith('/')) return id;
  const parts = id.split('/');
  parts.pop();
  return parts.length > 0 ? parts.join('/') + '/' : '';
}

async function loadChildren(node: TreeNode): Promise<VaultEntry[]> {
  const dir = node.entry.kind === 'folder' ? node.entry.id : idToDir(node.entry.id);
  const result = await vaultApi.tree(dir);
  return result.entries;
}

function buildNode(entry: VaultEntry): TreeNode {
  return { entry, children: null, expanded: false };
}

function applyChildrenToTree(
  nodes: TreeNode[],
  targetId: string,
  children: VaultEntry[],
): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.id === targetId) {
      return { ...n, children: children.map(buildNode), expanded: true };
    }
    if (n.children) {
      return { ...n, children: applyChildrenToTree(n.children, targetId, children) };
    }
    return n;
  });
}

function toggleExpanded(nodes: TreeNode[], targetId: string): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.id === targetId) return { ...n, expanded: !n.expanded };
    if (n.children) return { ...n, children: toggleExpanded(n.children, targetId) };
    return n;
  });
}

function renameInTree(nodes: TreeNode[], oldId: string, newEntry: VaultEntry): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.id === oldId) return { ...n, entry: newEntry };
    if (n.children) return { ...n, children: renameInTree(n.children, oldId, newEntry) };
    return n;
  });
}

function deleteFromTree(nodes: TreeNode[], targetId: string): TreeNode[] {
  return nodes
    .filter((n) => n.entry.id !== targetId)
    .map((n) => n.children ? { ...n, children: deleteFromTree(n.children, targetId) } : n);
}

function insertIntoTree(nodes: TreeNode[], parentDir: string, newEntry: VaultEntry): TreeNode[] {
  if (!parentDir) {
    return [...nodes, buildNode(newEntry)];
  }
  return nodes.map((n) => {
    if (n.entry.id === parentDir && n.children !== null) {
      return { ...n, children: [...n.children, buildNode(newEntry)] };
    }
    if (n.children) {
      return { ...n, children: insertIntoTree(n.children, parentDir, newEntry) };
    }
    return n;
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export function VaultFileTree({ activeFileId, onFileSelect, onFileCreated, refreshKey }: FileTreeProps) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Load root entries
  const loadRoot = useCallback(async () => {
    setLoading(true);
    try {
      const result = await vaultApi.tree();
      setRoots(result.entries.map(buildNode));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRoot(); }, [loadRoot, refreshKey]);

  // Expand a folder node
  const handleToggle = useCallback(async (node: TreeNode) => {
    if (node.children !== null) {
      setRoots((prev) => toggleExpanded(prev, node.entry.id));
      return;
    }
    const children = await loadChildren(node);
    setRoots((prev) => applyChildrenToTree(prev, node.entry.id, children));
  }, []);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, entry: VaultEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  // Rename
  const startRename = useCallback((entry: VaultEntry) => {
    setEditState({ type: 'rename', id: entry.id, value: entry.name });
  }, []);

  const confirmRename = useCallback(async () => {
    if (!editState || editState.type !== 'rename') return;
    const newName = editState.value.trim();
    if (!newName || newName === editState.id.split('/').filter(Boolean).pop()) {
      setEditState(null);
      return;
    }
    try {
      const updated = await vaultApi.rename(editState.id, newName);
      setRoots((prev) => renameInTree(prev, editState.id, updated));
      if (activeFileId === editState.id) onFileSelect(updated.id);
    } catch (err) {
      console.error('rename failed', err);
    }
    setEditState(null);
  }, [editState, activeFileId, onFileSelect]);

  // Delete
  const handleDelete = useCallback(async (entry: VaultEntry) => {
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    try {
      await vaultApi.deleteFile(entry.id);
      setRoots((prev) => deleteFromTree(prev, entry.id));
      if (activeFileId === entry.id) onFileSelect('');
    } catch (err) {
      console.error('delete failed', err);
    }
  }, [activeFileId, onFileSelect]);

  // New file
  const startNewFile = useCallback((parentDir: string) => {
    setEditState({ type: 'new-file', parentDir, value: 'untitled.md' });
  }, []);

  const confirmNewFile = useCallback(async () => {
    if (!editState || editState.type !== 'new-file') return;
    const name = editState.value.trim();
    if (!name) { setEditState(null); return; }
    const finalName = name.endsWith('.md') ? name : `${name}.md`;
    const id = editState.parentDir ? `${editState.parentDir}${finalName}` : finalName;
    try {
      await vaultApi.writeFile(id, '');
      const result = await vaultApi.tree(editState.parentDir || undefined);
      const newEntry = result.entries.find((e) => e.id === id);
      if (newEntry) {
        if (!editState.parentDir) {
          setRoots((prev) => [...prev, buildNode(newEntry)]);
        } else {
          setRoots((prev) => insertIntoTree(prev, editState.parentDir, newEntry));
        }
        onFileCreated?.(id);
        onFileSelect(id);
      }
    } catch (err) {
      console.error('new file failed', err);
    }
    setEditState(null);
  }, [editState, onFileCreated, onFileSelect]);

  // New folder
  const startNewFolder = useCallback((parentDir: string) => {
    setEditState({ type: 'new-folder', parentDir, value: 'New Folder' });
  }, []);

  const confirmNewFolder = useCallback(async () => {
    if (!editState || editState.type !== 'new-folder') return;
    const name = editState.value.trim();
    if (!name) { setEditState(null); return; }
    const id = editState.parentDir ? `${editState.parentDir}${name}/` : `${name}/`;
    try {
      const newEntry = await vaultApi.createFolder(id);
      if (!editState.parentDir) {
        setRoots((prev) => [buildNode(newEntry), ...prev]);
      } else {
        setRoots((prev) => insertIntoTree(prev, editState.parentDir, newEntry));
      }
    } catch (err) {
      console.error('new folder failed', err);
    }
    setEditState(null);
  }, [editState]);

  const handleEditConfirm = useCallback(() => {
    if (!editState) return;
    if (editState.type === 'rename') void confirmRename();
    if (editState.type === 'new-file') void confirmNewFile();
    if (editState.type === 'new-folder') void confirmNewFolder();
  }, [editState, confirmRename, confirmNewFile, confirmNewFolder]);

  // ── Render tree recursively ───────────────────────────────────────────────

  function renderNewItemRow(depth: number, type: 'file' | 'folder') {
    if (!editState) return null;
    if (type === 'file' && editState.type !== 'new-file') return null;
    if (type === 'folder' && editState.type !== 'new-folder') return null;

    return (
      <div
        className="flex w-full items-center gap-1 px-2 py-[3px] text-[12px]"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <span className="shrink-0 w-3" />
        <span className="shrink-0 text-dim">
          {type === 'folder' ? <Ico d={ICON.folder} size={12} /> : <Ico d={ICON.file} size={12} />}
        </span>
        <NameInput
          value={editState.value}
          onChange={(v) => setEditState((s) => s ? { ...s, value: v } : s)}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditState(null)}
        />
      </div>
    );
  }

  function renderNodes(nodes: TreeNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const isActive = activeFileId === node.entry.id;
      const isEditingThis = editState?.type === 'rename' && editState.id === node.entry.id;

      return (
        <div key={node.entry.id}>
          <TreeRow
            node={node}
            depth={depth}
            isActive={isActive}
            editState={isEditingThis ? editState : null}
            onSelect={() => onFileSelect(node.entry.id)}
            onToggle={() => { void handleToggle(node); }}
            onContextMenu={(e) => handleContextMenu(e, node.entry)}
            onEditChange={(v) => setEditState((s) => s ? { ...s, value: v } : s)}
            onEditConfirm={handleEditConfirm}
            onEditCancel={() => setEditState(null)}
          />
          {node.entry.kind === 'folder' && node.expanded && node.children !== null && (
            <div>
              {renderNodes(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-3 py-1.5 shrink-0">
        <p className="ui-section-label flex-1">Knowledge Base</p>
        <button
          type="button"
          className="ui-icon-button ui-icon-button-compact"
          title="New file"
          onClick={() => startNewFile('')}
        >
          <Ico d={ICON.plus} size={12} />
        </button>
        <button
          type="button"
          className="ui-icon-button ui-icon-button-compact"
          title="New folder"
          onClick={() => startNewFolder('')}
        >
          <Ico d={ICON.folderPlus} size={12} />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1 pb-3">
        {loading ? (
          <p className="px-3 py-2 text-[12px] text-dim animate-pulse">Loading…</p>
        ) : (
          <div className="space-y-px">
            {/* Root-level new item rows */}
            {editState?.type === 'new-folder' && !editState.parentDir && renderNewItemRow(0, 'folder')}
            {editState?.type === 'new-file' && !editState.parentDir && renderNewItemRow(0, 'file')}
            {renderNodes(roots, 0)}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onRename={() => startRename(contextMenu.entry)}
          onDelete={() => { void handleDelete(contextMenu.entry); }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

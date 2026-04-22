import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { vaultApi } from '../../client/api';
import type { VaultEntry } from '../../shared/types';
import { openCommandPalette } from '../../commands/commandPaletteEvents';
import { emitKBEvent, onKBEvent } from './knowledgeEvents';
import { VAULT_ENTRY_DRAG_TYPE, canDropVaultEntry, normalizeVaultDir } from './vaultDragAndDrop';

// ── Icons ─────────────────────────────────────────────────────────────────────

function Ico({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0">
      <path d={d} />
    </svg>
  );
}

const ICON = {
  folder:     'M3.75 6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 8.25v9A2.25 2.25 0 0 1 18 19.5H6A2.25 2.25 0 0 1 3.75 17.25V6Z',
  folderOpen: 'M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66h3.96A2.25 2.25 0 0 1 20.25 8.25v1.526',
  file:       'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  chevRight:  'm9 6 6 6-6 6',
  plus:       'M12 5v14M5 12h14',
  folderPlus: 'M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z',
  trash:      'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
  pencil:     'M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125',
  move:       'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  search:     'M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z',
  import:     'M12 3v12m0 0 4-4m-4 4-4-4m-5 8.25h18',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileTreeProps {
  activeFileId: string | null;
  onFileSelect: (id: string) => void;
}

interface TreeNode {
  entry: VaultEntry;
  children: TreeNode[] | null;
  expanded: boolean;
}

type EditState =
  | { type: 'rename'; id: string; value: string }
  | { type: 'new-file'; parentDir: string; value: string }
  | { type: 'new-folder'; parentDir: string; value: string };

interface ContextMenuState { x: number; y: number; entry: VaultEntry }

// ── Context menu ──────────────────────────────────────────────────────────────

function ContextMenu({ state, onRename, onMove, onDelete, onClose }: {
  state: ContextMenuState;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  return (
    <div ref={ref} className="fixed z-50 min-w-[148px] rounded-lg border border-border-default bg-elevated shadow-lg py-1 text-[12px]"
      style={{ left: state.x, top: state.y }}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-secondary hover:bg-accent/10 hover:text-primary"
        onClick={() => { onRename(); onClose(); }}>
        <Ico d={ICON.pencil} size={12} /> Rename
      </button>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-secondary hover:bg-accent/10 hover:text-primary"
        onClick={() => { onMove(); onClose(); }}>
        <Ico d={ICON.move} size={12} /> Move to…
      </button>
      <div className="my-1 border-t border-border-subtle" />
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-danger/10"
        onClick={() => { onDelete(); onClose(); }}>
        <Ico d={ICON.trash} size={12} /> Delete
      </button>
    </div>
  );
}

// ── Move modal ────────────────────────────────────────────────────────────────

function MoveModal({ entry, onConfirm, onClose }: {
  entry: VaultEntry;
  onConfirm: (targetDir: string) => void;
  onClose: () => void;
}) {
  const [folders, setFolders] = useState<Array<{ id: string; label: string }>>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    // Collect all folders via BFS
    const collect = async (dir: string, depth: number): Promise<Array<{ id: string; label: string }>> => {
      if (depth > 6) return [];
      const result = await vaultApi.tree(dir || undefined);
      const thisFolders = result.entries.filter((e) => e.kind === 'folder');
      const items: Array<{ id: string; label: string }> = [
        { id: '', label: '/ (vault root)' },
      ];
      for (const f of thisFolders) {
        items.push({ id: f.id, label: f.id });
        const children = await collect(f.id, depth + 1);
        items.push(...children.filter((c) => c.id !== ''));
      }
      return items;
    };
    collect('', 0).then((items) => {
      // Deduplicate
      const seen = new Set<string>();
      setFolders(items.filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; }));
    }).catch(() => {});
  }, []);

  const currentDir = entry.kind === 'file'
    ? entry.id.split('/').slice(0, -1).join('/') + (entry.id.includes('/') ? '/' : '')
    : entry.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-elevated border border-border-default rounded-xl shadow-2xl w-80 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[13px] font-semibold text-primary mb-1">Move "{entry.name}"</h3>
        <p className="text-[11px] text-dim mb-3">Select destination folder</p>
        <select
          className="w-full rounded-lg border border-border-default bg-surface text-[12px] text-primary px-3 py-2 mb-4 outline-none focus:border-accent"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {folders.map((f) => (
            <option key={f.id} value={f.id} disabled={f.id === currentDir}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" className="ui-action-button text-[12px]" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-action-button text-[12px] bg-accent text-white hover:bg-accent/90"
            onClick={() => { onConfirm(selected); onClose(); }}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportUrlModal({
  initialDirectoryId,
  onImport,
  onClose,
}: {
  initialDirectoryId: string;
  onImport: (input: { url: string; title: string; directoryId: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [directoryId, setDirectoryId] = useState(initialDirectoryId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('URL is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onImport({
        url: trimmedUrl,
        title: title.trim(),
        directoryId: normalizeDirectoryId(directoryId),
      });
      onClose();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
      setSubmitting(false);
    }
  }, [directoryId, onClose, onImport, title, url]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!submitting) onClose(); }}>
      <div className="bg-elevated border border-border-default rounded-xl shadow-2xl w-[min(34rem,calc(100vw-2rem))] p-5" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-[13px] font-semibold text-primary mb-1">Import URL</h3>
        <p className="text-[11px] text-dim mb-3">Paste a web URL and Personal Agent will fetch readable content into a new vault note.</p>
        <form className="space-y-3" onSubmit={(event) => { void handleSubmit(event); }}>
          <label className="block space-y-1">
            <span className="text-[11px] text-dim">URL</span>
            <input
              ref={urlRef}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/article"
              className="w-full rounded-lg border border-border-default bg-surface text-[12px] text-primary px-3 py-2 outline-none focus:border-accent"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-dim">Title override <span className="text-dim/70">optional</span></span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Leave blank to use the page title"
              className="w-full rounded-lg border border-border-default bg-surface text-[12px] text-primary px-3 py-2 outline-none focus:border-accent"
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-dim">Target folder <span className="text-dim/70">optional</span></span>
            <input
              type="text"
              value={directoryId}
              onChange={(event) => setDirectoryId(event.target.value)}
              placeholder="Inbox"
              className="w-full rounded-lg border border-border-default bg-surface text-[12px] text-primary px-3 py-2 outline-none focus:border-accent"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="ui-action-button text-[12px]" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="ui-action-button text-[12px] bg-accent text-white hover:bg-accent/90 disabled:opacity-70" disabled={submitting}>
              {submitting ? 'Importing…' : 'Import URL'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Inline name input ─────────────────────────────────────────────────────────

function NameInput({ value, onChange, onConfirm, onCancel }: {
  value: string; onChange: (v: string) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input ref={ref} type="text" value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onConfirm(); } if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
      onBlur={onCancel}
      className="flex-1 min-w-0 bg-accent/10 rounded px-1 py-0 text-[12px] text-primary outline-none border border-accent/40"
      onClick={(e) => e.stopPropagation()} />
  );
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

function idToDir(id: string): string {
  if (id.endsWith('/')) return id;
  const parts = id.split('/');
  parts.pop();
  return parts.length > 0 ? `${parts.join('/')}/` : '';
}

function normalizeDirectoryId(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function buildNode(entry: VaultEntry): TreeNode {
  return { entry, children: null, expanded: false };
}

function applyChildren(nodes: TreeNode[], targetId: string, children: VaultEntry[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.id === targetId) return { ...n, children: children.map(buildNode), expanded: true };
    if (n.children) return { ...n, children: applyChildren(n.children, targetId, children) };
    return n;
  });
}

function toggleNode(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.id === id) return { ...n, expanded: !n.expanded };
    if (n.children) return { ...n, children: toggleNode(n.children, id) };
    return n;
  });
}

function updateEntry(nodes: TreeNode[], oldId: string, newEntry: VaultEntry): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.id === oldId) return { ...n, entry: newEntry };
    if (n.children) return { ...n, children: updateEntry(n.children, oldId, newEntry) };
    return n;
  });
}

function removeEntry(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.filter((n) => n.entry.id !== id)
    .map((n) => n.children ? { ...n, children: removeEntry(n.children, id) } : n);
}

function insertEntry(nodes: TreeNode[], parentDir: string, entry: VaultEntry): TreeNode[] {
  if (!parentDir) return [...nodes, buildNode(entry)];
  return nodes.map((n) => {
    if (n.entry.id === parentDir && n.children !== null) return { ...n, children: [...n.children, buildNode(entry)] };
    if (n.children) return { ...n, children: insertEntry(n.children, parentDir, entry) };
    return n;
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export function VaultFileTree({ activeFileId, onFileSelect }: FileTreeProps) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [moveEntry, setMoveEntry] = useState<VaultEntry | null>(null);
  const [importDirectoryId, setImportDirectoryId] = useState<string | null>(null);
  const [draggingEntry, setDraggingEntry] = useState<VaultEntry | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

  // ── Load root ───────────────────────────────────────────────────────────────

  const loadRoot = useCallback(async () => {
    setLoading(true);
    try {
      const result = await vaultApi.tree();
      setRoots(result.entries.map(buildNode));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadRoot(); }, [loadRoot]);

  // Listen for kb events from editor
  useEffect(() => {
    const offs = [
      onKBEvent('kb:entries-changed', () => void loadRoot()),
      onKBEvent<{ oldId: string; newId: string }>('kb:file-renamed', ({ oldId, newId }) => {
        // Try to update in-tree without full reload
        vaultApi.tree(idToDir(newId)).then((r) => {
          const found = r.entries.find((e) => e.id === newId);
          if (found) setRoots((prev) => updateEntry(prev, oldId, found));
          else void loadRoot();
        }).catch(() => void loadRoot());
      }),
      onKBEvent<{ id: string }>('kb:file-created', () => void loadRoot()),
      onKBEvent<{ id: string }>('kb:file-deleted', ({ id }) => {
        setRoots((prev) => removeEntry(prev, id));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [loadRoot]);

  // ── Tree expansion ──────────────────────────────────────────────────────────

  const handleToggle = useCallback(async (node: TreeNode) => {
    if (node.children !== null) { setRoots((prev) => toggleNode(prev, node.entry.id)); return; }
    const dir = node.entry.kind === 'folder' ? node.entry.id : idToDir(node.entry.id);
    const result = await vaultApi.tree(dir);
    setRoots((prev) => applyChildren(prev, node.entry.id, result.entries));
  }, []);

  const openImportUrlModal = useCallback((directoryId?: string) => {
    setImportDirectoryId(normalizeDirectoryId(directoryId ?? (activeFileId ? idToDir(activeFileId) : '')));
  }, [activeFileId]);

  const handleImportUrl = useCallback(async (input: { url: string; title: string; directoryId: string }) => {
    const imported = await vaultApi.importUrl({
      url: input.url,
      ...(input.title ? { title: input.title } : {}),
      ...(input.directoryId ? { directoryId: input.directoryId } : {}),
      sourceApp: 'Personal Agent Knowledge UI',
    });
    emitKBEvent('kb:entries-changed');
    onFileSelect(imported.note.id);
  }, [onFileSelect]);

  // ── Context menu ────────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: VaultEntry) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  // ── Rename ──────────────────────────────────────────────────────────────────

  const confirmRename = useCallback(async () => {
    if (!editState || editState.type !== 'rename') return;
    const newName = editState.value.trim();
    const oldBasename = editState.id.split('/').filter(Boolean).pop() ?? '';
    if (!newName || newName === oldBasename) { setEditState(null); return; }
    try {
      const updated = await vaultApi.rename(editState.id, newName);
      setRoots((prev) => updateEntry(prev, editState.id, updated));
      emitKBEvent('kb:file-renamed', { oldId: editState.id, newId: updated.id });
      if (activeFileId === editState.id) onFileSelect(updated.id);
    } catch (err) { console.error('rename failed', err); }
    setEditState(null);
  }, [editState, activeFileId, onFileSelect]);

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (entry: VaultEntry) => {
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    try {
      await vaultApi.deleteFile(entry.id);
      setRoots((prev) => removeEntry(prev, entry.id));
      emitKBEvent('kb:file-deleted', { id: entry.id });
      if (activeFileId === entry.id) onFileSelect('');
    } catch (err) { console.error('delete failed', err); }
  }, [activeFileId, onFileSelect]);

  // ── Move ────────────────────────────────────────────────────────────────────

  const handleMove = useCallback(async (entry: VaultEntry, targetDir: string) => {
    try {
      const updated = await vaultApi.move(entry.id, targetDir);
      setRoots((prev) => removeEntry(prev, entry.id));
      emitKBEvent('kb:entries-changed');
      if (activeFileId === entry.id) onFileSelect(updated.id);
    } catch (err) { console.error('move failed', err); }
  }, [activeFileId, onFileSelect]);

  const clearDragState = useCallback(() => {
    setDraggingEntry(null);
    setDropTargetDir(null);
  }, []);

  const handleEntryDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, entry: VaultEntry) => {
    event.stopPropagation();
    setDraggingEntry(entry);
    setDropTargetDir(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(VAULT_ENTRY_DRAG_TYPE, entry.id);
    event.dataTransfer.setData('text/plain', entry.id);
  }, []);

  const handleNodeDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>, targetEntry: VaultEntry) => {
    if (!draggingEntry) return;
    const targetDir = normalizeVaultDir(targetEntry.kind === 'folder' ? targetEntry.id : idToDir(targetEntry.id));
    if (!canDropVaultEntry(draggingEntry, targetDir)) {
      if (dropTargetDir !== null) setDropTargetDir(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (dropTargetDir !== targetDir) setDropTargetDir(targetDir);
  }, [draggingEntry, dropTargetDir]);

  const handleRootDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingEntry) return;
    if (!canDropVaultEntry(draggingEntry, '')) {
      if (dropTargetDir !== null) setDropTargetDir(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTargetDir !== '') setDropTargetDir('');
  }, [draggingEntry, dropTargetDir]);

  const handleDropToDir = useCallback((event: React.DragEvent<HTMLElement>, targetDirInput: string) => {
    event.preventDefault();
    event.stopPropagation();
    const entry = draggingEntry;
    clearDragState();
    if (!entry) return;
    const targetDir = normalizeVaultDir(targetDirInput);
    if (!canDropVaultEntry(entry, targetDir)) return;
    void handleMove(entry, targetDir);
  }, [clearDragState, draggingEntry, handleMove]);

  // ── New file/folder ─────────────────────────────────────────────────────────

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
        setRoots((prev) => insertEntry(prev, editState.parentDir, newEntry));
        emitKBEvent('kb:file-created', { id });
        onFileSelect(id);
      }
    } catch (err) { console.error('new file failed', err); }
    setEditState(null);
  }, [editState, onFileSelect]);

  const confirmNewFolder = useCallback(async () => {
    if (!editState || editState.type !== 'new-folder') return;
    const name = editState.value.trim();
    if (!name) { setEditState(null); return; }
    const id = editState.parentDir ? `${editState.parentDir}${name}/` : `${name}/`;
    try {
      const newEntry = await vaultApi.createFolder(id);
      setRoots((prev) => insertEntry(prev, editState.parentDir, newEntry));
      emitKBEvent('kb:entries-changed');
    } catch (err) { console.error('new folder failed', err); }
    setEditState(null);
  }, [editState]);

  const handleEditConfirm = useCallback(() => {
    if (!editState) return;
    if (editState.type === 'rename') void confirmRename();
    if (editState.type === 'new-file') void confirmNewFile();
    if (editState.type === 'new-folder') void confirmNewFolder();
  }, [editState, confirmRename, confirmNewFile, confirmNewFolder]);

  // ── Tree renderer ───────────────────────────────────────────────────────────

  function renderNodes(nodes: TreeNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const isFolder = node.entry.kind === 'folder';
      const isActive = activeFileId === node.entry.id;
      const isRenaming = editState?.type === 'rename' && editState.id === node.entry.id;
      const nodeDropDir = normalizeVaultDir(isFolder ? node.entry.id : idToDir(node.entry.id));
      const isDragging = draggingEntry?.id === node.entry.id;
      const isDropTarget = dropTargetDir === nodeDropDir;

      return (
        <div key={node.entry.id}>
          <button
            type="button"
            aria-label={node.entry.name}
            draggable={!isRenaming}
            className={['group flex w-full items-center gap-1 px-2 py-[3px] rounded-md cursor-pointer select-none text-[12px] leading-tight text-left',
              isDropTarget ? 'bg-accent/12 text-primary ring-1 ring-inset ring-accent/40' : isActive ? 'bg-accent/15 text-primary' : 'text-secondary hover:bg-accent/8 hover:text-primary',
              isDragging ? 'opacity-60' : '',
            ].join(' ')}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={isFolder ? () => { void handleToggle(node); } : () => onFileSelect(node.entry.id)}
            onContextMenu={(e) => handleContextMenu(e, node.entry)}
            onDragStart={(e) => handleEntryDragStart(e, node.entry)}
            onDragEnd={() => clearDragState()}
            onDragOver={(e) => handleNodeDragOver(e, node.entry)}
            onDrop={(e) => handleDropToDir(e, isFolder ? node.entry.id : idToDir(node.entry.id))}
          >
            <span className="shrink-0 w-3 flex items-center justify-center text-dim"
              style={{ transform: isFolder ? (node.expanded ? 'rotate(90deg)' : 'rotate(0deg)') : 'none', transition: 'transform 120ms' }}>
              {isFolder ? <Ico d={ICON.chevRight} size={10} /> : <span className="w-3" />}
            </span>
            <span className="shrink-0 text-dim">
              {isFolder ? <Ico d={node.expanded ? ICON.folderOpen : ICON.folder} size={12} /> : <Ico d={ICON.file} size={12} />}
            </span>
            {isRenaming ? (
              <NameInput value={(editState as { value: string }).value}
                onChange={(v) => setEditState((s) => s ? { ...s, value: v } : s)}
                onConfirm={handleEditConfirm} onCancel={() => setEditState(null)} />
            ) : (
              <span className="flex-1 truncate">{node.entry.name}</span>
            )}
          </button>
          {isFolder && node.expanded && node.children !== null && (
            <div>
              {/* Inline new-item rows inside folder */}
              {editState?.type === 'new-folder' && editState.parentDir === node.entry.id && (
                <div className="flex w-full items-center gap-1 px-2 py-[3px] text-[12px]"
                  style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}>
                  <span className="shrink-0 w-3" />
                  <span className="shrink-0 text-dim"><Ico d={ICON.folder} size={12} /></span>
                  <NameInput value={editState.value}
                    onChange={(v) => setEditState((s) => s ? { ...s, value: v } : s)}
                    onConfirm={handleEditConfirm} onCancel={() => setEditState(null)} />
                </div>
              )}
              {editState?.type === 'new-file' && editState.parentDir === node.entry.id && (
                <div className="flex w-full items-center gap-1 px-2 py-[3px] text-[12px]"
                  style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}>
                  <span className="shrink-0 w-3" />
                  <span className="shrink-0 text-dim"><Ico d={ICON.file} size={12} /></span>
                  <NameInput value={editState.value}
                    onChange={(v) => setEditState((s) => s ? { ...s, value: v } : s)}
                    onConfirm={handleEditConfirm} onCancel={() => setEditState(null)} />
                </div>
              )}
              {renderNodes(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className={['flex items-center gap-1 px-3 py-0.5 shrink-0 rounded-md', dropTargetDir === '' ? 'bg-accent/8 ring-1 ring-inset ring-accent/30' : ''].join(' ')}>
        <p className="ui-section-label flex-1">Knowledge Base</p>
        <button
          type="button"
          className="ui-icon-button ui-icon-button-compact"
          title="Open file palette"
          onClick={() => openCommandPalette({ scope: 'files' })}
        >
          <Ico d={ICON.search} size={12} />
        </button>
        <button
          type="button"
          className="ui-icon-button ui-icon-button-compact"
          title="Import URL"
          onClick={() => openImportUrlModal()}
        >
          <Ico d={ICON.import} size={12} />
        </button>
        <button type="button" className="ui-icon-button ui-icon-button-compact" title="New file"
          onClick={() => setEditState({ type: 'new-file', parentDir: '', value: 'untitled.md' })}>
          <Ico d={ICON.plus} size={12} />
        </button>
        <button type="button" className="ui-icon-button ui-icon-button-compact" title="New folder"
          onClick={() => setEditState({ type: 'new-folder', parentDir: '', value: 'New Folder' })}>
          <Ico d={ICON.folderPlus} size={12} />
        </button>
      </div>

      <div
        className={['flex-1 overflow-y-auto min-h-0 px-1 pb-3', dropTargetDir === '' ? 'bg-accent/4' : ''].join(' ')}
        onDragOver={handleRootDragOver}
        onDrop={(e) => handleDropToDir(e, '')}
      >
        {loading ? (
          <p className="px-3 py-2 text-[12px] text-dim animate-pulse">Loading…</p>
        ) : (
          <div className="space-y-px">
            {editState?.type === 'new-folder' && !editState.parentDir && (
              <div className="flex w-full items-center gap-1 px-2 py-[3px] text-[12px]">
                <span className="shrink-0 w-3" />
                <span className="shrink-0 text-dim"><Ico d={ICON.folder} size={12} /></span>
                <NameInput value={editState.value}
                  onChange={(v) => setEditState((s) => s ? { ...s, value: v } : s)}
                  onConfirm={handleEditConfirm} onCancel={() => setEditState(null)} />
              </div>
            )}
            {editState?.type === 'new-file' && !editState.parentDir && (
              <div className="flex w-full items-center gap-1 px-2 py-[3px] text-[12px]">
                <span className="shrink-0 w-3" />
                <span className="shrink-0 text-dim"><Ico d={ICON.file} size={12} /></span>
                <NameInput value={editState.value}
                  onChange={(v) => setEditState((s) => s ? { ...s, value: v } : s)}
                  onConfirm={handleEditConfirm} onCancel={() => setEditState(null)} />
              </div>
            )}
            {renderNodes(roots, 0)}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu state={contextMenu}
          onRename={() => setEditState({ type: 'rename', id: contextMenu.entry.id, value: contextMenu.entry.name })}
          onMove={() => setMoveEntry(contextMenu.entry)}
          onDelete={() => { void handleDelete(contextMenu.entry); }}
          onClose={() => setContextMenu(null)} />
      )}

      {/* Move modal */}
      {moveEntry && (
        <MoveModal entry={moveEntry}
          onConfirm={(targetDir) => { void handleMove(moveEntry, targetDir); }}
          onClose={() => setMoveEntry(null)} />
      )}

      {importDirectoryId !== null && (
        <ImportUrlModal
          initialDirectoryId={importDirectoryId}
          onImport={handleImportUrl}
          onClose={() => setImportDirectoryId(null)}
        />
      )}
    </div>
  );
}

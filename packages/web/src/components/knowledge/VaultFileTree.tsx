import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  FileTree as TreesModel,
  type ContextMenuItem as FileTreeContextMenuItem,
  type ContextMenuOpenContext as FileTreeContextMenuOpenContext,
  type FileTreeDropContext,
  type FileTreeDropResult,
  type FileTreeRenameEvent,
} from '@pierre/trees';
import { FileTree as TreesFileTree } from '@pierre/trees/react';
import { api, vaultApi } from '../../client/api';
import { useInvalidateOnTopics } from '../../hooks/useInvalidateOnTopics';
import { useApi } from '../../hooks/useApi';
import { getKnowledgeBaseSyncPresentation } from '../../knowledge/knowledgeBaseSyncStatus';
import {
  addOpenFileId,
  normalizeOpenFileIds,
  readStoredOpenFileIds,
  removeOpenFileId,
  renameOpenFileIds,
  writeStoredOpenFileIds,
} from '../../local/knowledgeOpenFiles';
import {
  readStoredRecentlyClosedFileIds,
  recordRecentlyClosedFileId,
  writeStoredRecentlyClosedFileIds,
} from '../../local/knowledgeRecentlyClosedFiles';
import {
  DEFAULT_OPEN_FILES_SECTION_HEIGHT,
  MAX_OPEN_FILES_SECTION_HEIGHT,
  MIN_OPEN_FILES_SECTION_HEIGHT,
  clampOpenFilesSectionHeight,
  readStoredOpenFilesSectionHeight,
  writeStoredOpenFilesSectionHeight,
} from '../../local/knowledgeOpenFilesSectionHeight';
import {
  collapseExpandedFolderIds,
  readStoredExpandedFolderIds,
  renameExpandedFolderIds,
  writeStoredExpandedFolderIds,
} from '../../local/knowledgeTreeState';
import type { VaultEntry } from '../../shared/types';
import { emitKBEvent, onKBEvent } from './knowledgeEvents';
import { canDropVaultEntry, normalizeVaultDir } from './vaultDragAndDrop';
import { cx } from '../ui';
import { shouldUseNativeAppContextMenus } from '../../desktop/desktopBridge';

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
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  plus: 'M12 5v14M5 12h14',
  folderPlus: 'M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z',
  trash: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
  pencil: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125',
  move: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  search: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z',
  import: 'M12 3v12m0 0 4-4m-4 4-4-4m-5 8.25h18',
  x: 'M6 18 18 6M6 6l12 12',
  file: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
};

const TREE_HOST_STYLE = {
  display: 'block',
  height: '100%',
  '--trees-accent-override': 'rgb(var(--color-accent))',
  '--trees-bg-override': 'transparent',
  '--trees-bg-muted-override': 'transparent',
  '--trees-border-color-override': 'rgb(var(--color-border-subtle))',
  '--trees-fg-override': 'rgb(var(--color-secondary))',
  '--trees-fg-muted-override': 'rgb(var(--color-dim))',
  '--trees-focus-ring-color-override': 'rgb(var(--color-accent) / 0.35)',
  '--trees-item-margin-x-override': '4px',
  '--trees-item-padding-x-override': '8px',
  '--trees-padding-inline-override': '0px',
  '--trees-selected-bg-override': 'rgb(var(--color-accent) / 0.14)',
  '--trees-selected-fg-override': 'rgb(var(--color-primary))',
} satisfies CSSProperties & Record<string, string | number>;

const MIN_TREE_HOST_HEIGHT = 120;
const OPEN_FILES_SECTION_RESIZE_STEP = 24;
const OPEN_FILES_SECTION_RESIZER_HEIGHT = 8;

export interface FileTreeProps {
  activeFileId: string | null;
  onFileSelect: (id: string) => void;
}

interface ContextMenuProps {
  onDelete: () => void;
  onMove: () => void;
  onRename: () => void;
}

interface FolderOption {
  id: string;
  label: string;
}

interface CreateEntryState {
  kind: 'file' | 'folder';
  value: string;
}

function normalizeDirectoryId(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function idToDir(id: string): string {
  if (id.endsWith('/')) {
    return id;
  }

  const parts = id.split('/');
  parts.pop();
  return parts.length > 0 ? `${parts.join('/')}/` : '';
}

function formatOpenFileName(fileId: string): string {
  return fileId.split('/').filter(Boolean).pop() ?? fileId;
}

function resolveRenamedFileId(fileId: string | null, oldId: string, newId: string): string | null {
  if (!fileId) {
    return null;
  }

  if (oldId.endsWith('/') && newId.endsWith('/') && fileId.startsWith(oldId)) {
    return `${newId}${fileId.slice(oldId.length)}`;
  }

  if (fileId === oldId) {
    return newId;
  }

  return null;
}

function isPathAffectedByRemoval(path: string | null, removedId: string): boolean {
  if (!path) {
    return false;
  }

  if (removedId.endsWith('/')) {
    return path.startsWith(removedId);
  }

  return path === removedId;
}

function removeOpenFileIdsWithin(openFileIds: readonly string[], removedId: string): string[] {
  if (removedId.endsWith('/')) {
    return openFileIds.filter((fileId) => !fileId.startsWith(removedId));
  }

  return removeOpenFileId(openFileIds, removedId);
}

function getExpandableFolderIds(path: string): string[] {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length === 0) {
    return [];
  }

  const limit = path.endsWith('/') ? parts.length : parts.length - 1;
  const folderIds: string[] = [];
  for (let index = 1; index <= limit; index += 1) {
    folderIds.push(`${parts.slice(0, index).join('/')}/`);
  }
  return folderIds;
}

function getTopLevelDraggedPaths(paths: readonly string[]): string[] {
  const sorted = [...paths].sort((left, right) => left.length - right.length || left.localeCompare(right));
  return sorted.filter((path, index) => !sorted.slice(0, index).some((candidate) => candidate.endsWith('/') && path.startsWith(candidate)));
}

function collectExpandedFolderIds(model: TreesModel, folderIds: readonly string[]): Set<string> {
  const expanded = new Set<string>();
  for (const folderId of folderIds) {
    const item = model.getItem(folderId);
    if (item?.isDirectory()) {
      const directory = item;
      const ancestors = getExpandableFolderIds(folderId).slice(0, -1);
      const ancestorsExpanded = ancestors.every((ancestorId) => {
        const ancestorItem = model.getItem(ancestorId);
        return ancestorItem?.isDirectory() ? ancestorItem.isExpanded() : false;
      });

      if (directory.isExpanded() && ancestorsExpanded) {
        expanded.add(folderId);
      }
    }
  }
  return expanded;
}

function collectRawExpandedFolderIds(model: TreesModel, folderIds: readonly string[]): Set<string> {
  const expanded = new Set<string>();
  for (const folderId of folderIds) {
    const item = model.getItem(folderId);
    if (item?.isDirectory() && item.isExpanded()) {
      expanded.add(folderId);
    }
  }
  return expanded;
}

function hasSameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function createFallbackEntry(path: string, kind: VaultEntry['kind'], name?: string): VaultEntry {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return {
    id: path,
    kind,
    name: name ?? trimmed.split('/').filter(Boolean).pop() ?? trimmed,
    path: trimmed,
    sizeBytes: 0,
    updatedAt: '',
  };
}

function TreeContextMenu({ onDelete, onMove, onRename }: ContextMenuProps) {
  return (
    <div
      className="ui-menu-shell ui-context-menu-shell absolute bottom-auto left-0 right-auto top-0 mb-0 min-w-[224px]"
      role="menu"
      aria-label="Knowledge entry actions"
    >
      <div className="space-y-px">
        <button type="button" className="ui-context-menu-item gap-2" onClick={onRename} role="menuitem">
          <Ico d={ICON.pencil} size={12} />
          Rename
        </button>
        <button type="button" className="ui-context-menu-item gap-2" onClick={onMove} role="menuitem">
          <Ico d={ICON.move} size={12} />
          Move to…
        </button>
        <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
        <button type="button" className="ui-context-menu-item gap-2 text-danger hover:bg-danger/10 focus-visible:bg-danger/10" onClick={onDelete} role="menuitem">
          <Ico d={ICON.trash} size={12} />
          Delete
        </button>
      </div>
    </div>
  );
}

function MoveModal({
  entry,
  folderOptions,
  onConfirm,
  onClose,
}: {
  entry: VaultEntry;
  folderOptions: readonly FolderOption[];
  onConfirm: (targetDir: string) => void;
  onClose: () => void;
}) {
  const currentDir = entry.kind === 'file'
    ? idToDir(entry.id)
    : entry.id;
  const [selected, setSelected] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-elevated border border-border-default rounded-xl shadow-2xl w-80 p-5" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-[13px] font-semibold text-primary mb-1">Move “{entry.name}”</h3>
        <p className="text-[11px] text-dim mb-3">Select destination folder.</p>
        <label className="block space-y-1">
          <span className="text-[11px] text-dim">Destination</span>
          <select
            aria-label="Move destination"
            className="w-full rounded-lg border border-border-default bg-surface text-[12px] text-primary px-3 py-2 outline-none focus:border-accent"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {folderOptions.map((folder) => (
              <option
                key={folder.id}
                value={folder.id}
                disabled={folder.id === currentDir || !canDropVaultEntry(entry, folder.id)}
              >
                {folder.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-4">
          <button type="button" className="ui-action-button text-[12px]" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="ui-action-button text-[12px] bg-accent text-white hover:bg-accent/90"
            onClick={() => {
              onConfirm(selected);
              onClose();
            }}
          >
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

function CreateEntryModal({
  onClose,
  onConfirm,
  state,
}: {
  onClose: () => void;
  onConfirm: (value: string) => Promise<void>;
  state: CreateEntryState;
}) {
  const [value, setValue] = useState(state.value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError(state.kind === 'file' ? 'File name is required.' : 'Folder name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  }, [onClose, onConfirm, state.kind, value]);

  const title = state.kind === 'file' ? 'New file' : 'New folder';
  const label = state.kind === 'file' ? 'File name' : 'Folder name';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!submitting) onClose(); }}>
      <div className="bg-elevated border border-border-default rounded-xl shadow-2xl w-[min(28rem,calc(100vw-2rem))] p-5" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-[13px] font-semibold text-primary mb-1">{title}</h3>
        <p className="text-[11px] text-dim mb-3">Create a new {state.kind === 'file' ? 'markdown file' : 'folder'} at the vault root.</p>
        <form className="space-y-3" onSubmit={(event) => { void handleSubmit(event); }}>
          <label className="block space-y-1">
            <span className="text-[11px] text-dim">{label}</span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={state.kind === 'file' ? 'untitled.md' : 'New Folder'}
              className="w-full rounded-lg border border-border-default bg-surface text-[12px] text-primary px-3 py-2 outline-none focus:border-accent"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="ui-action-button text-[12px]" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="ui-action-button text-[12px] bg-accent text-white hover:bg-accent/90 disabled:opacity-70" disabled={submitting}>
              {submitting ? 'Creating…' : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OpenFilesSection({
  openFileIds,
  activeFileId,
  onSelect,
  onClose,
  bordered = true,
  className = '',
}: {
  openFileIds: readonly string[];
  activeFileId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div className={[
      'flex flex-col px-2 pb-2 pt-1.5',
      bordered ? 'border-t border-border-subtle' : '',
      className,
    ].filter(Boolean).join(' ')}>
      <div className="flex shrink-0 items-center px-1 pb-1">
        <p className="ui-section-label">Open Files</p>
      </div>
      {openFileIds.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-dim">No open files.</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {openFileIds.map((fileId) => {
            const isActive = activeFileId === fileId;
            const fileName = formatOpenFileName(fileId);

            return (
              <div key={fileId} className="group relative">
                <button
                  type="button"
                  aria-label={`Open file ${fileId}`}
                  title={fileId}
                  className={[
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 pr-9 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/35 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
                    isActive ? 'bg-accent/15 text-primary' : 'text-secondary hover:bg-accent/8 hover:text-primary',
                  ].join(' ')}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onSelect(fileId)}
                >
                  <span className="shrink-0 text-dim"><Ico d={ICON.file} size={12} /></span>
                  <span className="block min-w-0 flex-1 truncate text-[12px] font-medium">{fileName.replace(/\.md$/, '')}</span>
                </button>
                <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center">
                  <button
                    type="button"
                    aria-label={`Close file ${fileId}`}
                    className="pointer-events-auto ui-icon-button ui-icon-button-compact shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onClose(fileId);
                    }}
                  >
                    <Ico d={ICON.x} size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function VaultFileTree({ activeFileId, onFileSelect }: FileTreeProps) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [moveEntry, setMoveEntry] = useState<VaultEntry | null>(null);
  const [importDirectoryId, setImportDirectoryId] = useState<string | null>(null);
  const [createEntryState, setCreateEntryState] = useState<CreateEntryState | null>(null);
  const initialOpenFileIds = useRef(activeFileId ? addOpenFileId(readStoredOpenFileIds(), activeFileId) : readStoredOpenFileIds());
  const [openFileIds, setOpenFileIds] = useState<string[]>(initialOpenFileIds.current);
  const openFileIdsRef = useRef<string[]>(initialOpenFileIds.current);
  const recentlyClosedFileIdsRef = useRef<string[]>(readStoredRecentlyClosedFileIds());
  const expandedFolderIdsRef = useRef<Set<string>>(readStoredExpandedFolderIds());
  const visibleExpandedFolderIdsRef = useRef<Set<string>>(new Set(expandedFolderIdsRef.current));
  const initialActiveFileIdRef = useRef(activeFileId);
  const activeFileIdRef = useRef(activeFileId);
  const entryMapRef = useRef<Map<string, VaultEntry>>(new Map());
  const folderIdsRef = useRef<string[]>([]);
  const selectionChangeRef = useRef<(paths: readonly string[]) => void>(() => {});
  const renameRef = useRef<(event: FileTreeRenameEvent) => void>(() => {});
  const canDropRef = useRef<(event: FileTreeDropContext) => boolean>(() => false);
  const dropCompleteRef = useRef<(event: FileTreeDropResult) => void>(() => {});
  const reconcilingExpansionRef = useRef(false);
  const treeHostWrapperRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const useNativeKnowledgeContextMenu = shouldUseNativeAppContextMenus();
  const [desiredOpenFilesSectionHeight, setDesiredOpenFilesSectionHeight] = useState(() => readStoredOpenFilesSectionHeight());
  const [maxOpenFilesSectionHeight, setMaxOpenFilesSectionHeight] = useState(MAX_OPEN_FILES_SECTION_HEIGHT);
  const openFilesSectionHeight = Math.min(desiredOpenFilesSectionHeight, maxOpenFilesSectionHeight);
  const {
    data: knowledgeBaseState,
    loading: knowledgeBaseLoading,
    error: knowledgeBaseError,
    refetch: refetchKnowledgeBase,
  } = useApi(api.knowledgeBase, 'knowledge-base-tree-status');
  const model = useMemo(() => new TreesModel({
    paths: [],
    search: false,
    initialExpandedPaths: [...expandedFolderIdsRef.current],
    initialSelectedPaths: initialActiveFileIdRef.current ? [initialActiveFileIdRef.current] : [],
    composition: {
      contextMenu: useNativeKnowledgeContextMenu
        ? {
            enabled: true,
            triggerMode: 'right-click',
          }
        : {
            triggerMode: 'right-click',
          },
    },
    onSelectionChange: (paths) => selectionChangeRef.current(paths),
    renaming: {
      onRename: (event) => renameRef.current(event),
    },
    dragAndDrop: {
      canDrop: (event) => canDropRef.current(event),
      onDropComplete: (event) => dropCompleteRef.current(event),
      onDropError: (error) => {
        console.error('knowledge tree drop failed', error);
      },
    },
  }), [useNativeKnowledgeContextMenu]);

  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const folderIds = useMemo(() => entries.filter((entry) => entry.kind === 'folder').map((entry) => entry.id), [entries]);
  const folderOptions = useMemo<FolderOption[]>(() => [
    { id: '', label: '/ (vault root)' },
    ...folderIds.map((folderId) => ({ id: folderId, label: folderId })),
  ], [folderIds]);
  const knowledgeBaseDisabled = knowledgeBaseState?.configured === false;
  const knowledgeBaseSyncPresentation = useMemo(() => {
    if (knowledgeBaseError && !knowledgeBaseState && !knowledgeBaseLoading) {
      return {
        text: `Sync status unavailable · ${knowledgeBaseError}`,
        toneClass: 'text-danger',
        dotClass: 'bg-danger',
        pulse: false,
      };
    }

    return getKnowledgeBaseSyncPresentation(knowledgeBaseState);
  }, [knowledgeBaseError, knowledgeBaseLoading, knowledgeBaseState]);

  const persistOpenFileIds = useCallback((nextOpenFileIds: readonly string[]) => {
    const normalized = [...nextOpenFileIds];
    openFileIdsRef.current = normalized;
    setOpenFileIds(normalized);
    writeStoredOpenFileIds(normalized);
  }, []);

  const persistRecentlyClosedFileIds = useCallback((nextRecentlyClosedFileIds: readonly string[]) => {
    const normalized = normalizeOpenFileIds(nextRecentlyClosedFileIds);
    recentlyClosedFileIdsRef.current = normalized;
    writeStoredRecentlyClosedFileIds(normalized);
  }, []);

  const persistExpandedFolderIds = useCallback((nextExpandedFolderIds: ReadonlySet<string>) => {
    const normalized = new Set(nextExpandedFolderIds);
    if (
      hasSameStringSet(expandedFolderIdsRef.current, normalized)
      && hasSameStringSet(visibleExpandedFolderIdsRef.current, normalized)
    ) {
      return;
    }

    expandedFolderIdsRef.current = normalized;
    visibleExpandedFolderIdsRef.current = normalized;
    writeStoredExpandedFolderIds(normalized);
  }, []);

  const persistOpenFilesSectionHeight = useCallback((nextHeight: number) => {
    const normalized = clampOpenFilesSectionHeight(nextHeight);
    setDesiredOpenFilesSectionHeight(normalized);
    writeStoredOpenFilesSectionHeight(normalized);
  }, []);

  const handleOpenFilesSectionResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight = openFilesSectionHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    function handleMouseMove(moveEvent: MouseEvent) {
      const delta = startY - moveEvent.clientY;
      const nextHeight = Math.min(
        maxOpenFilesSectionHeight,
        clampOpenFilesSectionHeight(startHeight + delta),
      );
      persistOpenFilesSectionHeight(nextHeight);
    }

    function handleMouseUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [maxOpenFilesSectionHeight, openFilesSectionHeight, persistOpenFilesSectionHeight]);

  const handleOpenFilesSectionResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        persistOpenFilesSectionHeight(Math.min(maxOpenFilesSectionHeight, openFilesSectionHeight + OPEN_FILES_SECTION_RESIZE_STEP));
        break;
      case 'ArrowDown':
        event.preventDefault();
        persistOpenFilesSectionHeight(openFilesSectionHeight - OPEN_FILES_SECTION_RESIZE_STEP);
        break;
      case 'Home':
        event.preventDefault();
        persistOpenFilesSectionHeight(MIN_OPEN_FILES_SECTION_HEIGHT);
        break;
      case 'End':
        event.preventDefault();
        persistOpenFilesSectionHeight(maxOpenFilesSectionHeight);
        break;
      default:
        break;
    }
  }, [maxOpenFilesSectionHeight, openFilesSectionHeight, persistOpenFilesSectionHeight]);

  const handleOpenFilesSectionResizeReset = useCallback(() => {
    persistOpenFilesSectionHeight(Math.min(DEFAULT_OPEN_FILES_SECTION_HEIGHT, maxOpenFilesSectionHeight));
  }, [maxOpenFilesSectionHeight, persistOpenFilesSectionHeight]);

  const applyRenameEffects = useCallback((oldId: string, newId: string) => {
    persistOpenFileIds(renameOpenFileIds(openFileIdsRef.current, oldId, newId));

    if (oldId.endsWith('/') && newId.endsWith('/')) {
      persistExpandedFolderIds(renameExpandedFolderIds(expandedFolderIdsRef.current, oldId, newId));
    }

    const nextActiveFileId = resolveRenamedFileId(activeFileIdRef.current, oldId, newId);
    if (nextActiveFileId && nextActiveFileId !== activeFileIdRef.current) {
      onFileSelect(nextActiveFileId);
    }
  }, [onFileSelect, persistExpandedFolderIds, persistOpenFileIds]);

  const applyDeleteEffects = useCallback((id: string) => {
    persistOpenFileIds(removeOpenFileIdsWithin(openFileIdsRef.current, id));

    if (id.endsWith('/')) {
      persistExpandedFolderIds(collapseExpandedFolderIds(expandedFolderIdsRef.current, id));
    }

    if (isPathAffectedByRemoval(activeFileIdRef.current, id)) {
      onFileSelect('');
    }
  }, [onFileSelect, persistExpandedFolderIds, persistOpenFileIds]);

  const loadSnapshot = useCallback(async (options?: { keepLoadingState?: boolean }) => {
    if (options?.keepLoadingState !== false) {
      setLoading(true);
    }

    try {
      const result = await api.vaultFiles();
      setEntries(result.files);
      model.resetPaths(result.files.map((entry) => entry.id), {
        initialExpandedPaths: [...expandedFolderIdsRef.current],
      });
    } catch (error) {
      console.error('failed to load knowledge base snapshot', error);
      setEntries([]);
      model.resetPaths([]);
    } finally {
      setLoading(false);
    }
  }, [model]);

  const handleRename = useCallback(async ({ sourcePath, destinationPath }: FileTreeRenameEvent) => {
    try {
      const newName = destinationPath.split('/').filter(Boolean).pop() ?? '';
      const updated = await vaultApi.rename(sourcePath, newName);
      emitKBEvent('kb:file-renamed', { oldId: sourcePath, newId: updated.id });
    } catch (error) {
      console.error('rename failed', error);
      await loadSnapshot({ keepLoadingState: false });
    }
  }, [loadSnapshot]);

  const handleMovePaths = useCallback(async (paths: readonly string[], targetDirInput: string, options?: { emitEntriesChangedOnly?: boolean }) => {
    const targetDir = normalizeVaultDir(targetDirInput);
    const movedPairs: Array<{ oldId: string; newId: string }> = [];

    try {
      for (const path of getTopLevelDraggedPaths(paths)) {
        const updated = await vaultApi.move(path, targetDir);
        movedPairs.push({ oldId: path, newId: updated.id });
      }
    } catch (error) {
      console.error('move failed', error);
      await loadSnapshot({ keepLoadingState: false });
      return;
    }

    if (movedPairs.length === 0) {
      return;
    }

    if (options?.emitEntriesChangedOnly || movedPairs.length > 1) {
      for (const pair of movedPairs) {
        applyRenameEffects(pair.oldId, pair.newId);
      }
      emitKBEvent('kb:entries-changed');
      return;
    }

    const pair = movedPairs[0];
    if (pair) {
      emitKBEvent('kb:file-renamed', { oldId: pair.oldId, newId: pair.newId });
    }
  }, [applyRenameEffects, loadSnapshot]);

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

  const handleCreateEntry = useCallback(async (value: string) => {
    if (!createEntryState) {
      return;
    }

    if (createEntryState.kind === 'file') {
      const fileId = value.endsWith('.md') ? value : `${value}.md`;
      await vaultApi.writeFile(fileId, '');
      emitKBEvent('kb:file-created', { id: fileId });
      onFileSelect(fileId);
      return;
    }

    const folderId = value.endsWith('/') ? value : `${value}/`;
    const created = await vaultApi.createFolder(folderId);
    emitKBEvent('kb:file-created', { id: created.id });
  }, [createEntryState, onFileSelect]);

  const handleDelete = useCallback(async (entry: VaultEntry) => {
    if (!window.confirm(`Delete “${entry.name}”?`)) {
      return;
    }

    try {
      await vaultApi.deleteFile(entry.id);
      emitKBEvent('kb:file-deleted', { id: entry.id });
    } catch (error) {
      console.error('delete failed', error);
    }
  }, []);

  const handleOpenFileClose = useCallback((id: string) => {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return;
    }

    if (openFileIdsRef.current.includes(normalizedId)) {
      const nextRecentlyClosed = recordRecentlyClosedFileId(recentlyClosedFileIdsRef.current, normalizedId);
      persistRecentlyClosedFileIds(nextRecentlyClosed);
    }

    const nextOpenFileIds = removeOpenFileId(openFileIdsRef.current, normalizedId);
    const closedIndex = openFileIdsRef.current.indexOf(normalizedId);
    persistOpenFileIds(nextOpenFileIds);

    if (activeFileIdRef.current !== normalizedId) {
      return;
    }

    const fallbackIndex = Math.min(Math.max(closedIndex, 0), Math.max(nextOpenFileIds.length - 1, 0));
    onFileSelect(nextOpenFileIds[fallbackIndex] ?? '');
  }, [onFileSelect, persistOpenFileIds, persistRecentlyClosedFileIds]);

  const handleReopenLastClosedFile = useCallback(() => {
    const remaining = [...recentlyClosedFileIdsRef.current];
    while (remaining.length > 0) {
      const candidate = remaining.shift()?.trim() ?? '';
      if (!candidate || candidate.endsWith('/')) {
        continue;
      }

      if (openFileIdsRef.current.includes(candidate)) {
        continue;
      }

      const entry = entryMapRef.current.get(candidate);
      if (entry && entry.kind !== 'file') {
        continue;
      }

      persistRecentlyClosedFileIds(remaining);
      persistOpenFileIds(addOpenFileId(openFileIdsRef.current, candidate));
      onFileSelect(candidate);
      return;
    }

    persistRecentlyClosedFileIds(remaining);
  }, [onFileSelect, persistOpenFileIds, persistRecentlyClosedFileIds]);

  useEffect(() => {
    const off = [
      onKBEvent('kb:close-active-file', () => {
        const id = activeFileIdRef.current;
        if (id) {
          handleOpenFileClose(id);
        }
      }),
      onKBEvent('kb:reopen-closed-file', () => {
        handleReopenLastClosedFile();
      }),
    ];

    return () => {
      off.forEach((unsubscribe) => unsubscribe());
    };
  }, [handleOpenFileClose, handleReopenLastClosedFile]);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    entryMapRef.current = entryMap;
    folderIdsRef.current = folderIds;
  }, [entryMap, folderIds]);

  useEffect(() => {
    if (!activeFileId) {
      return;
    }

    persistOpenFileIds(addOpenFileId(openFileIdsRef.current, activeFileId));
  }, [activeFileId, persistOpenFileIds]);

  useEffect(() => {
    selectionChangeRef.current = (paths) => {
      const selectedPath = paths.find((path) => !path.endsWith('/')) ?? null;
      if (selectedPath && selectedPath !== activeFileIdRef.current) {
        onFileSelect(selectedPath);
      }
    };
  }, [onFileSelect]);

  useEffect(() => {
    renameRef.current = (event) => {
      void handleRename(event);
    };
  }, [handleRename]);

  useEffect(() => {
    canDropRef.current = (event) => {
      const targetDir = normalizeVaultDir(event.target.directoryPath ?? '');
      return getTopLevelDraggedPaths(event.draggedPaths).every((path) => {
        const entry = entryMapRef.current.get(path);
        return entry ? canDropVaultEntry(entry, targetDir) : false;
      });
    };
  }, []);

  useEffect(() => {
    dropCompleteRef.current = (event) => {
      void handleMovePaths(event.draggedPaths, event.target.directoryPath ?? '', { emitEntriesChangedOnly: event.draggedPaths.length > 1 });
    };
  }, [handleMovePaths]);

  useEffect(() => {
    const unsubscribe = model.subscribe(() => {
      if (reconcilingExpansionRef.current) {
        return;
      }

      const rawExpandedFolderIds = collectRawExpandedFolderIds(model, folderIdsRef.current);
      const collapsedFolderIds = [...visibleExpandedFolderIdsRef.current].filter((folderId) => !rawExpandedFolderIds.has(folderId));
      const descendantFolderIdsToCollapse = [...rawExpandedFolderIds].filter((folderId) => collapsedFolderIds.some((collapsedFolderId) => folderId !== collapsedFolderId && folderId.startsWith(collapsedFolderId)));

      if (descendantFolderIdsToCollapse.length > 0) {
        reconcilingExpansionRef.current = true;
        try {
          for (const folderId of descendantFolderIdsToCollapse) {
            const item = model.getItem(folderId);
            if (item?.isDirectory()) {
              item.collapse();
            }
          }
        } finally {
          reconcilingExpansionRef.current = false;
        }
      }

      persistExpandedFolderIds(collectExpandedFolderIds(model, folderIdsRef.current));
    });
    return unsubscribe;
  }, [model, persistExpandedFolderIds]);

  useEffect(() => {
    if (!knowledgeBaseState) {
      return;
    }

    if (knowledgeBaseDisabled) {
      setEntries([]);
      model.resetPaths([]);
      setLoading(false);
      return;
    }

    void loadSnapshot();
  }, [knowledgeBaseDisabled, knowledgeBaseState, loadSnapshot, model]);

  useEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (!root || !header || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateMaxOpenFilesSectionHeight = () => {
      const availableHeight = root.getBoundingClientRect().height
        - header.getBoundingClientRect().height
        - OPEN_FILES_SECTION_RESIZER_HEIGHT
        - MIN_TREE_HOST_HEIGHT;
      setMaxOpenFilesSectionHeight(Math.max(
        MIN_OPEN_FILES_SECTION_HEIGHT,
        Math.min(MAX_OPEN_FILES_SECTION_HEIGHT, Math.round(availableHeight)),
      ));
    };

    updateMaxOpenFilesSectionHeight();
    const observer = new ResizeObserver(() => {
      updateMaxOpenFilesSectionHeight();
    });
    observer.observe(root);
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeFileId) {
      for (const selectedPath of model.getSelectedPaths()) {
        model.getItem(selectedPath)?.deselect();
      }
      return;
    }

    for (const folderId of getExpandableFolderIds(activeFileId)) {
      const item = model.getItem(folderId);
      if (item?.isDirectory()) {
        const directory = item;
        directory.expand();
      }
    }

    for (const selectedPath of model.getSelectedPaths()) {
      if (selectedPath !== activeFileId) {
        model.getItem(selectedPath)?.deselect();
      }
    }

    const activeItem = model.getItem(activeFileId);
    if (activeItem && !activeItem.isSelected()) {
      activeItem.select();
    }

    persistExpandedFolderIds(collectExpandedFolderIds(model, folderIdsRef.current));
  }, [activeFileId, entries, model, persistExpandedFolderIds]);

  useInvalidateOnTopics(['knowledgeBase'], refetchKnowledgeBase);

  useEffect(() => () => {
    model.cleanUp();
  }, [model]);

  useEffect(() => {
    if (!knowledgeBaseDisabled) {
      return;
    }

    setMoveEntry(null);
    setImportDirectoryId(null);
    setCreateEntryState(null);
  }, [knowledgeBaseDisabled]);

  useEffect(() => {
    const refreshKnowledgeBaseStatus = () => {
      void refetchKnowledgeBase({ resetLoading: false });
    };

    const off = [
      onKBEvent('kb:entries-changed', () => {
        void loadSnapshot({ keepLoadingState: false });
        refreshKnowledgeBaseStatus();
      }),
      onKBEvent('kb:content-saved', () => {
        refreshKnowledgeBaseStatus();
      }),
      onKBEvent<{ oldId: string; newId: string }>('kb:file-renamed', ({ oldId, newId }) => {
        applyRenameEffects(oldId, newId);
        void loadSnapshot({ keepLoadingState: false });
        refreshKnowledgeBaseStatus();
      }),
      onKBEvent<{ id: string }>('kb:file-created', () => {
        void loadSnapshot({ keepLoadingState: false });
        refreshKnowledgeBaseStatus();
      }),
      onKBEvent<{ id: string }>('kb:file-deleted', ({ id }) => {
        applyDeleteEffects(id);
        void loadSnapshot({ keepLoadingState: false });
        refreshKnowledgeBaseStatus();
      }),
    ];

    return () => {
      off.forEach((unsubscribe) => unsubscribe());
    };
  }, [applyDeleteEffects, applyRenameEffects, loadSnapshot, refetchKnowledgeBase]);

  useEffect(() => {
    const wrapper = treeHostWrapperRef.current;
    const host = wrapper?.querySelector('file-tree-container');
    const shadowRoot = host instanceof HTMLElement ? host.shadowRoot : null;
    if (!shadowRoot || typeof window === 'undefined') {
      return;
    }

    let frameId: number | null = null;

    const syncVisibleLabels = () => {
      frameId = null;
      const rows = shadowRoot.querySelectorAll<HTMLElement>('[role="treeitem"]');
      for (const row of rows) {
        const content = row.querySelector<HTMLElement>('[data-item-section="content"]');
        if (!content) {
          continue;
        }

        const resetContentPresentation = () => {
          content.removeAttribute('data-pa-full-label');
          content.style.display = '';
          content.style.minWidth = '';
          content.style.overflow = '';
          content.style.whiteSpace = '';
          content.style.textOverflow = '';
          content.querySelector('[data-pa-full-label-text="true"]')?.remove();
        };

        if (content.querySelector('[data-item-rename-input]')) {
          resetContentPresentation();
          continue;
        }

        const middleGroup = content.querySelector<HTMLElement>('[data-truncate-group-container="middle"]');
        if (!middleGroup) {
          resetContentPresentation();
          continue;
        }
        middleGroup.style.display = '';

        const label = row.getAttribute('aria-label')?.trim();
        if (label) {
          content.setAttribute('data-pa-full-label', 'true');
          content.style.display = 'block';
          content.style.minWidth = '0';
          content.style.overflow = 'hidden';
          content.style.whiteSpace = 'nowrap';
          content.style.textOverflow = 'ellipsis';
          middleGroup.style.display = 'none';
          let labelText = content.querySelector<HTMLElement>('[data-pa-full-label-text="true"]');
          if (!labelText) {
            labelText = document.createElement('span');
            labelText.setAttribute('data-pa-full-label-text', 'true');
            labelText.style.display = 'block';
            labelText.style.overflow = 'hidden';
            labelText.style.whiteSpace = 'nowrap';
            labelText.style.textOverflow = 'ellipsis';
            content.append(labelText);
          }
          if (labelText.textContent !== label) {
            labelText.textContent = label;
          }
        } else {
          resetContentPresentation();
        }
      }
    };

    const scheduleVisibleLabelSync = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        syncVisibleLabels();
      });
    };

    scheduleVisibleLabelSync();
    const observer = new MutationObserver(() => {
      scheduleVisibleLabelSync();
    });
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [entries, loading]);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div ref={headerRef} className="px-3 pt-1 pb-1 shrink-0 rounded-md">
        <div className="flex items-center gap-1">
          <p className="ui-section-label flex-1">Knowledge Base</p>
          {knowledgeBaseDisabled ? null : (
            <>
              <button
                type="button"
                className="ui-icon-button ui-icon-button-compact"
                title="Import URL"
                aria-label="Import URL"
                onClick={() => setImportDirectoryId(normalizeDirectoryId(activeFileId ? idToDir(activeFileId) : ''))}
              >
                <Ico d={ICON.import} size={12} />
              </button>
              <button
                type="button"
                className="ui-icon-button ui-icon-button-compact"
                title="New file"
                aria-label="New file"
                onClick={() => setCreateEntryState({ kind: 'file', value: 'untitled.md' })}
              >
                <Ico d={ICON.plus} size={12} />
              </button>
              <button
                type="button"
                className="ui-icon-button ui-icon-button-compact"
                title="New folder"
                aria-label="New folder"
                onClick={() => setCreateEntryState({ kind: 'folder', value: 'New Folder' })}
              >
                <Ico d={ICON.folderPlus} size={12} />
              </button>
            </>
          )}
        </div>
        <div className={cx('mt-0.5 flex items-center gap-2 text-[11px]', knowledgeBaseSyncPresentation.toneClass)}>
          <span
            aria-hidden="true"
            className={cx('h-2 w-2 shrink-0 rounded-full', knowledgeBaseSyncPresentation.dotClass, knowledgeBaseSyncPresentation.pulse && 'animate-pulse')}
          />
          <p className="truncate" title={knowledgeBaseSyncPresentation.text}>{knowledgeBaseSyncPresentation.text}</p>
        </div>
      </div>

      {knowledgeBaseDisabled ? (
        <div className="flex flex-1 min-h-0 items-start px-3 pb-3 pt-2">
          <div className="space-y-1.5 text-[12px] leading-5 text-secondary">
            <p className="font-medium text-primary">Sync a repo to enable Knowledge.</p>
            <p>The Knowledge UI stays empty until a managed repo is configured.</p>
          </div>
        </div>
      ) : (
        <>
          <div ref={treeHostWrapperRef} className="flex-1 min-h-0 overflow-hidden px-1 pb-3">
            {loading ? (
              <p className="px-3 py-2 text-[12px] text-dim animate-pulse">Loading…</p>
            ) : (
              <TreesFileTree
                className="h-full"
                model={model}
                {...(!useNativeKnowledgeContextMenu ? {
                  renderContextMenu: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => {
                    const entry = entryMap.get(item.path)
                      ?? createFallbackEntry(item.path, item.kind === 'directory' ? 'folder' : 'file', item.name);

                    return (
                      <TreeContextMenu
                        onRename={() => {
                          context.close({ restoreFocus: false });
                          window.setTimeout(() => {
                            model.startRenaming(entry.id);
                          }, 0);
                        }}
                        onMove={() => {
                          context.close();
                          setMoveEntry(entry);
                        }}
                        onDelete={() => {
                          context.close();
                          void handleDelete(entry);
                        }}
                      />
                    );
                  },
                } : {})}
                style={TREE_HOST_STYLE}
              />
            )}
          </div>

          {openFileIds.length > 0 ? (
            <>
              <div
                role="separator"
                aria-label="Resize open files section"
                aria-orientation="horizontal"
                aria-valuemin={MIN_OPEN_FILES_SECTION_HEIGHT}
                aria-valuemax={maxOpenFilesSectionHeight}
                aria-valuenow={openFilesSectionHeight}
                tabIndex={0}
                className="group relative shrink-0 cursor-row-resize select-none px-2 focus-visible:outline-none"
                onMouseDown={handleOpenFilesSectionResizeMouseDown}
                onKeyDown={handleOpenFilesSectionResizeKeyDown}
                onDoubleClick={handleOpenFilesSectionResizeReset}
              >
                <div className="flex h-2 items-center">
                  <div className="h-px w-full bg-border-subtle transition-colors group-hover:bg-accent/40 group-focus-visible:bg-accent/40" />
                </div>
              </div>
              <div className="shrink-0 overflow-hidden" style={{ height: openFilesSectionHeight }}>
                <OpenFilesSection
                  openFileIds={openFileIds}
                  activeFileId={activeFileId}
                  onSelect={onFileSelect}
                  onClose={handleOpenFileClose}
                  bordered={false}
                  className="h-full"
                />
              </div>
            </>
          ) : (
            <OpenFilesSection
              openFileIds={openFileIds}
              activeFileId={activeFileId}
              onSelect={onFileSelect}
              onClose={handleOpenFileClose}
            />
          )}
        </>
      )}

      {moveEntry ? (
        <MoveModal
          entry={moveEntry}
          folderOptions={folderOptions}
          onConfirm={(targetDir) => { void handleMovePaths([moveEntry.id], targetDir); }}
          onClose={() => setMoveEntry(null)}
        />
      ) : null}

      {importDirectoryId !== null ? (
        <ImportUrlModal
          initialDirectoryId={importDirectoryId}
          onImport={handleImportUrl}
          onClose={() => setImportDirectoryId(null)}
        />
      ) : null}

      {createEntryState ? (
        <CreateEntryModal
          state={createEntryState}
          onConfirm={handleCreateEntry}
          onClose={() => setCreateEntryState(null)}
        />
      ) : null}
    </div>
  );
}

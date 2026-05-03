import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import {
  type ContextMenuItem as FileTreeContextMenuItem,
  type ContextMenuOpenContext as FileTreeContextMenuOpenContext,
  FileTree as TreesModel,
  type FileTreeRenameEvent,
} from '@pierre/trees';
import { FileTree as TreesFileTree } from '@pierre/trees/react';
import CodeMirror from '@uiw/react-codemirror';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../client/api';
import { buildApiPath } from '../../client/apiBase';
import { getDesktopBridge, shouldUseNativeAppContextMenus } from '../../desktop/desktopBridge';
import type {
  WorkspaceDiffOverlay,
  WorkspaceDirectoryListing,
  WorkspaceEntry,
  WorkspaceFileContent,
  WorkspaceGitStatusChange,
} from '../../shared/types';
import { useTheme } from '../../ui-state/theme';
import { cx, EmptyState, LoadingState, Pill } from '../ui';

interface WorkspaceExplorerProps {
  cwd: string | null;
  onDraftPrompt: (prompt: string) => void;
  onOpenFile?: (file: { cwd: string; path: string }) => void;
  activeFilePath?: string | null;
  railOnly?: boolean;
}

type LoadState<T> = { status: 'idle' | 'loading'; data: T | null; error: string | null };

type TreeNodeState = {
  expanded: boolean;
  loading: boolean;
  entries: WorkspaceEntry[] | null;
  error: string | null;
};

interface DiffDecorationSpec {
  addedLines: number[];
  deletedBlocks: Array<{ afterLine: number; lines: string[] }>;
}

const WORKSPACE_EXPLORER_OPEN_KEY = 'pa:workspace-explorer-open';
const WORKSPACE_EXPLORER_DIFF_KEY = 'pa:workspace-explorer-diff-overlay';
const WORKSPACE_OPEN_FILES_KEY_PREFIX = 'pa:workspace-open-files:';
const MAX_WORKSPACE_OPEN_FILES = 24;
const WATCH_DEBOUNCE_MS = 180;
const GIT_REFRESH_DEBOUNCE_MS = 450;
const STATUS_LABELS: Record<WorkspaceGitStatusChange, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!',
};

const STATUS_TITLES: Record<WorkspaceGitStatusChange, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  typechange: 'Type changed',
  untracked: 'Untracked',
  conflicted: 'Conflicted',
};

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
  file: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  folderPlus:
    'M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z',
  folderOpen:
    'M3.75 6.75h5.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H20.25m-16.5-3A2.25 2.25 0 0 0 1.5 9v8.25A2.25 2.25 0 0 0 3.75 19.5h16.5a2.25 2.25 0 0 0 2.25-2.25v-5.25a2.25 2.25 0 0 0-2.25-2.25H3.75',
  pencil:
    'M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125',
  move: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  save: 'M4.5 3.75h12.19c.398 0 .779.158 1.06.44l2.06 2.06c.282.281.44.663.44 1.06v12.19a.75.75 0 0 1-.75.75h-15a.75.75 0 0 1-.75-.75v-15a.75.75 0 0 1 .75-.75Zm3 0v5.25h8.25V3.75M7.5 20.25v-6h9v6',
  check: 'M4.5 12.75 9.75 18 19.5 6.75',
  trash:
    'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
  x: 'M6 18 18 6M6 6l12 12',
};

const tokyoNightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#bb9af7' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#ff9e64' },
  { tag: [t.number, t.integer, t.float], color: '#ff9e64' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#9ece6a' },
  { tag: [t.escape, t.character], color: '#7dcfff' },
  { tag: [t.definition(t.variableName), t.function(t.variableName), t.function(t.propertyName)], color: '#7aa2f7' },
  { tag: [t.variableName, t.self], color: '#c0caf5' },
  { tag: [t.className, t.typeName, t.namespace], color: '#2ac3de' },
  { tag: [t.propertyName, t.attributeName], color: '#7dcfff' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#89ddff' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#565f89', fontStyle: 'italic' },
  { tag: [t.meta, t.labelName], color: '#bb9af7' },
  { tag: [t.heading, t.strong], color: '#7aa2f7', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#73daca', textDecoration: 'underline' },
  { tag: t.invalid, color: '#f7768e' },
]);

const TREE_HOST_STYLE = {
  display: 'block',
  height: '100%',
  '--trees-accent-override': 'rgb(var(--color-accent))',
  '--trees-bg-override': 'transparent',
  '--trees-bg-muted-override': 'rgb(var(--color-hover))',
  '--trees-border-color-override': 'rgb(var(--color-border-subtle))',
  '--trees-fg-override': 'rgb(var(--color-primary))',
  '--trees-fg-muted-override': 'rgb(var(--color-secondary))',
  '--trees-focus-ring-color-override': 'rgb(var(--color-accent) / 0.55)',
  '--trees-font-size-override': '12px',
  '--trees-font-family-override': '"DM Sans Variable", "DM Sans", system-ui, sans-serif',
  '--trees-item-margin-x-override': '4px',
  '--trees-item-padding-x-override': '8px',
  '--trees-padding-inline-override': '0px',
  '--trees-selected-bg-override': 'rgb(var(--color-accent) / 0.24)',
  '--trees-selected-fg-override': 'rgb(var(--color-primary))',
  '--trees-selected-focused-border-color-override': 'rgb(var(--color-accent) / 0.7)',
  '--trees-scrollbar-thumb-override': 'rgb(var(--color-border-default))',
  '--trees-git-added-color-override': 'rgb(var(--color-success))',
  '--trees-git-modified-color-override': 'rgb(var(--color-warning))',
  '--trees-git-renamed-color-override': 'rgb(var(--color-steel))',
  '--trees-git-untracked-color-override': 'rgb(var(--color-success))',
  '--trees-git-deleted-color-override': 'rgb(var(--color-danger))',
  '--trees-file-icon-color-default': 'rgb(var(--color-steel))',
} satisfies CSSProperties & Record<string, string | number>;

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeStoredBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function formatWorkspaceEntrySize(size: number | null): string {
  if (size === null) return '';
  if (!Number.isSafeInteger(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(entry: WorkspaceEntry): string {
  if (entry.kind === 'directory') return '▸';
  if (entry.kind === 'symlink') return '↗';
  return '·';
}

function statusTone(status: WorkspaceGitStatusChange | null): 'muted' | 'success' | 'warning' | 'danger' | 'steel' {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'success';
    case 'deleted':
    case 'conflicted':
      return 'danger';
    case 'renamed':
    case 'copied':
      return 'steel';
    case 'modified':
    case 'typechange':
      return 'warning';
    default:
      return 'muted';
  }
}

function extensionForPath(path: string) {
  const lower = path.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) {
    return javascript({ jsx: /\.(tsx|jsx)$/.test(lower), typescript: /\.(ts|tsx)$/.test(lower) });
  }
  if (/\.jsonc?$/.test(lower)) return json();
  if (/\.(md|mdx|markdown)$/.test(lower)) return markdown();
  if (/\.py$/.test(lower)) return python();
  if (/\.(html|xml|svg)$/.test(lower)) return html();
  if (/\.(css|scss|sass|less)$/.test(lower)) return css();
  if (/\.(ya?ml)$/.test(lower)) return yaml();
  return [];
}

class DeletedLinesWidget extends WidgetType {
  constructor(private readonly lines: string[]) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'workspace-deleted-lines';
    for (const line of this.lines) {
      const row = document.createElement('div');
      row.className = 'workspace-deleted-line';
      const marker = document.createElement('span');
      marker.className = 'workspace-diff-marker';
      marker.textContent = '−';
      const text = document.createElement('span');
      text.textContent = line || ' ';
      row.append(marker, text);
      wrapper.append(row);
    }
    return wrapper;
  }
}

const setDiffDecorations = StateEffect.define<DiffDecorationSpec>();

function buildDiffDecorations(spec: DiffDecorationSpec, state: EditorState): DecorationSet {
  const added = new Set(spec.addedLines);
  const builder = new RangeSetBuilder<Decoration>();
  const blocksByLine = new Map<number, string[]>();
  for (const block of spec.deletedBlocks) {
    blocksByLine.set(block.afterLine, [...(blocksByLine.get(block.afterLine) ?? []), ...block.lines]);
  }

  const beforeFirst = blocksByLine.get(0);
  if (beforeFirst?.length) {
    builder.add(0, 0, Decoration.widget({ widget: new DeletedLinesWidget(beforeFirst), side: -1, block: true }));
  }

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    if (added.has(lineNumber)) {
      builder.add(line.from, line.from, Decoration.line({ class: 'workspace-added-line' }));
    }
    const deleted = blocksByLine.get(lineNumber);
    if (deleted?.length) {
      builder.add(line.to, line.to, Decoration.widget({ widget: new DeletedLinesWidget(deleted), side: 1, block: true }));
    }
  }

  return builder.finish();
}

const diffDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDiffDecorations)) {
        return buildDiffDecorations(effect.value, transaction.state);
      }
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function useWorkspaceWatcher(cwd: string | null, enabled: boolean, onEvent: () => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!cwd || !enabled || typeof window === 'undefined') return;
    let timer: number | null = null;
    const source = new EventSource(buildApiPath(`/workspace/events?cwd=${encodeURIComponent(cwd)}`));
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => onEventRef.current(), WATCH_DEBOUNCE_MS);
    };
    source.addEventListener('workspace', schedule);
    source.onerror = () => {
      source.close();
      schedule();
    };
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      source.close();
    };
  }, [cwd, enabled]);
}

function buildPrompt(root: string | null, action: string, path: string): string {
  const rootText = root ? `In repo ${root}, ` : '';
  return `${rootText}${action} \`${path}\`.`;
}

function workspaceEntryToTreePath(entry: WorkspaceEntry): string {
  return entry.kind === 'directory' ? `${entry.path}/` : entry.path;
}

function treePathToWorkspacePath(path: string): string {
  return path.replace(/\/+$/g, '');
}

function collectExpandedWorkspaceFolderPaths(model: TreesModel, entries: Iterable<WorkspaceEntry>): string[] {
  const expanded: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'directory') {
      continue;
    }
    const item = model.getItem(workspaceEntryToTreePath(entry));
    if (item?.isDirectory() && item.isExpanded()) {
      expanded.push(workspaceEntryToTreePath(entry));
    }
  }
  return expanded;
}

function buildWorkspaceBreadcrumbs(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 4) {
    return parts;
  }

  return ['…', ...parts.slice(-3)];
}

function workspaceOpenFilesKey(cwd: string): string {
  return `${WORKSPACE_OPEN_FILES_KEY_PREFIX}${cwd}`;
}

function readWorkspaceOpenFiles(cwd: string | null): string[] {
  if (!cwd) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(workspaceOpenFilesKey(cwd)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, MAX_WORKSPACE_OPEN_FILES)
      : [];
  } catch {
    return [];
  }
}

function writeWorkspaceOpenFiles(cwd: string | null, paths: readonly string[]): void {
  if (!cwd) return;
  try {
    localStorage.setItem(workspaceOpenFilesKey(cwd), JSON.stringify([...new Set(paths)].slice(0, MAX_WORKSPACE_OPEN_FILES)));
  } catch {
    /* ignore */
  }
}

function addWorkspaceOpenFile(paths: readonly string[], path: string): string[] {
  return [path, ...paths.filter((value) => value !== path)].slice(0, MAX_WORKSPACE_OPEN_FILES);
}

function removeWorkspaceOpenFile(paths: readonly string[], path: string): string[] {
  return paths.filter((value) => value !== path);
}

function parentDirectory(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function WorkspaceOpenFilesSection({
  openFilePaths,
  activePath,
  onSelect,
  onClose,
  onCloseAll,
}: {
  openFilePaths: readonly string[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
}) {
  return (
    <div className="flex flex-col px-2 pb-2 pt-1.5">
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-1">
        <p className="ui-section-label">Open Files</p>
        {openFilePaths.length > 0 ? (
          <button
            type="button"
            aria-label="Close all open files"
            title="Close all open files"
            className="ui-icon-button ui-icon-button-compact text-dim hover:text-primary"
            onClick={onCloseAll}
          >
            <Ico d={ICON.x} size={11} />
          </button>
        ) : null}
      </div>
      {openFilePaths.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-dim">No open files.</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {openFilePaths.map((path) => {
            const isActive = activePath === path;
            const fileName = path.split('/').filter(Boolean).pop() ?? path;
            return (
              <div key={path} className="group relative">
                <button
                  type="button"
                  title={path}
                  className={cx(
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 pr-9 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/35',
                    isActive ? 'bg-accent/15 text-primary' : 'text-secondary hover:bg-accent/8 hover:text-primary',
                  )}
                  onClick={() => onSelect(path)}
                >
                  <span className="shrink-0 text-dim">
                    <Ico d={ICON.file} size={12} />
                  </span>
                  <span className="block min-w-0 flex-1 truncate text-[12px] font-medium">{fileName}</span>
                </button>
                <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center">
                  <button
                    type="button"
                    aria-label={`Close file ${path}`}
                    className="pointer-events-auto ui-icon-button ui-icon-button-compact shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onClose(path);
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

function WorkspaceTreeContextMenu({
  onCreateFile,
  onCreateFolder,
  onDelete,
  onOpenInFinder,
  onMove,
  onRename,
}: {
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onOpenInFinder?: () => void;
  onMove: () => void;
  onRename: () => void;
}) {
  return (
    <div
      className="ui-menu-shell ui-context-menu-shell absolute bottom-auto left-0 right-auto top-0 mb-0 min-w-[224px]"
      role="menu"
      aria-label="Workspace entry actions"
    >
      <div className="space-y-px">
        <button type="button" className="ui-context-menu-item gap-2" onClick={onCreateFile} role="menuitem">
          <Ico d={ICON.file} size={12} />
          New File
        </button>
        <button type="button" className="ui-context-menu-item gap-2" onClick={onCreateFolder} role="menuitem">
          <Ico d={ICON.folderPlus} size={12} />
          New Folder
        </button>
        <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
        {onOpenInFinder ? (
          <>
            <button type="button" className="ui-context-menu-item gap-2" onClick={onOpenInFinder} role="menuitem">
              <Ico d={ICON.folderOpen} size={12} />
              Open in Finder
            </button>
            <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
          </>
        ) : null}
        <button type="button" className="ui-context-menu-item gap-2" onClick={onRename} role="menuitem">
          <Ico d={ICON.pencil} size={12} />
          Rename
        </button>
        <button type="button" className="ui-context-menu-item gap-2" onClick={onMove} role="menuitem">
          <Ico d={ICON.move} size={12} />
          Move to…
        </button>
        <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
        <button
          type="button"
          className="ui-context-menu-item gap-2 text-danger hover:bg-danger/10 focus-visible:bg-danger/10"
          onClick={onDelete}
          role="menuitem"
        >
          <Ico d={ICON.trash} size={12} />
          Delete
        </button>
      </div>
    </div>
  );
}

function createWorkspaceEditorExtensions(path: string, theme: 'light' | 'dark') {
  return [
    diffDecorationsField,
    EditorView.lineWrapping,
    EditorView.theme(
      {
        '&': {
          height: '100%',
          background: 'rgb(var(--color-base))',
          color: 'rgb(var(--color-primary))',
          fontSize: '12px',
        },
        '.cm-editor': {
          height: '100%',
          backgroundColor: 'rgb(var(--color-base))',
        },
        '.cm-scroller': {
          backgroundColor: 'rgb(var(--color-base))',
          fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          lineHeight: '1.55',
        },
        '.cm-content': {
          padding: '8px 0 24px',
        },
        '.cm-line': {
          paddingLeft: '0',
        },
        '.cm-gutters': {
          background: 'rgb(var(--color-base))',
          color: 'rgb(var(--color-dim))',
          borderRight: '0',
          fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '11px',
        },
        '.cm-activeLine': {
          backgroundColor: 'rgb(var(--color-surface) / 0.55)',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'rgb(var(--color-surface) / 0.55)',
        },
        '.cm-cursor': {
          borderLeftColor: 'rgb(var(--color-primary))',
        },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
          backgroundColor: 'rgb(var(--color-accent) / 0.24)',
        },
        '.workspace-added-line': { backgroundColor: 'rgba(34, 197, 94, 0.12)' },
        '.workspace-deleted-lines': {
          backgroundColor: 'rgba(239, 68, 68, 0.10)',
          color: 'rgb(var(--color-danger))',
          borderLeft: '2px solid rgba(239, 68, 68, 0.6)',
          padding: '2px 0 2px 8px',
          fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '12px',
        },
        '.workspace-deleted-line': { whiteSpace: 'pre', minHeight: '1.4em' },
        '.workspace-diff-marker': { display: 'inline-block', width: '1.5em', opacity: '0.75' },
      },
      { dark: theme === 'dark' },
    ),
    syntaxHighlighting(theme === 'dark' ? tokyoNightHighlightStyle : defaultHighlightStyle),
    extensionForPath(path),
  ];
}

function getSelectedTextWithin(container: HTMLElement | null): string {
  if (!container || typeof window === 'undefined') {
    return '';
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return '';
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const target = commonAncestor instanceof HTMLElement ? commonAncestor : commonAncestor.parentElement;
  if (!target || !container.contains(target)) {
    return '';
  }

  return selection.toString().trim();
}

function WorkspaceStatusBadge({ status, count }: { status: WorkspaceGitStatusChange | null; count?: number }) {
  if (!status && !count) return null;
  if (status) {
    return (
      <Pill tone={statusTone(status)} mono className="px-1.5 py-0 text-[10px]" title={STATUS_TITLES[status]}>
        {STATUS_LABELS[status]}
      </Pill>
    );
  }
  return (
    <span
      className="rounded-sm bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent"
      title={`${count} changed descendant${count === 1 ? '' : 's'}`}
    >
      {count}
    </span>
  );
}

function WorkspaceTreeRow({
  entry,
  depth,
  selectedPath,
  node,
  nodes,
  onToggle,
  onSelect,
  onDraftPrompt,
  root,
}: {
  entry: WorkspaceEntry;
  depth: number;
  selectedPath: string | null;
  node: TreeNodeState | undefined;
  nodes: Record<string, TreeNodeState>;
  onToggle: (entry: WorkspaceEntry) => void;
  onSelect: (entry: WorkspaceEntry) => void;
  onDraftPrompt: (prompt: string) => void;
  root: string | null;
}) {
  const selected = selectedPath === entry.path;
  const isDirectory = entry.kind === 'directory';
  return (
    <div>
      <div
        className={cx(
          'group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-secondary hover:bg-surface/70 hover:text-primary',
          selected && 'bg-accent/10 text-primary',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => (isDirectory ? onToggle(entry) : onSelect(entry))}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            isDirectory ? onToggle(entry) : onSelect(entry);
          }
        }}
      >
        <span className={cx('w-3 shrink-0 text-dim transition-transform', isDirectory && node?.expanded && 'rotate-90')}>
          {fileIcon(entry)}
        </span>
        <span className={cx('min-w-0 flex-1 truncate', isDirectory ? 'font-medium' : 'font-mono')}>{entry.name}</span>
        {entry.size !== null && (
          <span className="hidden shrink-0 text-[10px] text-dim group-hover:inline">{formatWorkspaceEntrySize(entry.size)}</span>
        )}
        <WorkspaceStatusBadge status={entry.gitStatus} count={entry.descendantGitStatusCount} />
        <button
          type="button"
          className="hidden shrink-0 rounded px-1 py-0.5 text-[10px] text-dim hover:bg-elevated hover:text-primary group-hover:inline"
          title="Draft an agent prompt for this path"
          onClick={(event) => {
            event.stopPropagation();
            onDraftPrompt(buildPrompt(root, 'inspect this path', entry.path));
          }}
        >
          ask
        </button>
      </div>
      {isDirectory && node?.expanded && (
        <div>
          {node.loading && (
            <div className="px-3 py-1 text-[11px] text-dim" style={{ paddingLeft: `${24 + depth * 14}px` }}>
              Loading…
            </div>
          )}
          {node.error && (
            <div className="px-3 py-1 text-[11px] text-danger" style={{ paddingLeft: `${24 + depth * 14}px` }}>
              {node.error}
            </div>
          )}
          {node.entries?.map((child) => (
            <WorkspaceTreeBranch
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              node={nodes[child.path]}
              nodes={nodes}
              onToggle={onToggle}
              onSelect={onSelect}
              onDraftPrompt={onDraftPrompt}
              root={root}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceTreeBranch(props: Parameters<typeof WorkspaceTreeRow>[0]) {
  return <WorkspaceTreeRow {...props} />;
}

export function WorkspaceExplorer({ cwd, onDraftPrompt, onOpenFile, activeFilePath = null, railOnly = false }: WorkspaceExplorerProps) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(() => readStoredBoolean(WORKSPACE_EXPLORER_OPEN_KEY, true));
  const [showDiff, setShowDiff] = useState(() => readStoredBoolean(WORKSPACE_EXPLORER_DIFF_KEY, true));
  const [rootListing, setRootListing] = useState<LoadState<WorkspaceDirectoryListing>>({ status: 'idle', data: null, error: null });
  const [nodes, setNodes] = useState<Record<string, TreeNodeState>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>(() => readWorkspaceOpenFiles(cwd));
  const [fileState, setFileState] = useState<LoadState<WorkspaceFileContent>>({ status: 'idle', data: null, error: null });
  const [diffState, setDiffState] = useState<LoadState<WorkspaceDiffOverlay>>({ status: 'idle', data: null, error: null });
  const refreshSerial = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const selectionChangeRef = useRef<(paths: readonly string[]) => void>(() => {});
  const renameRef = useRef<(event: FileTreeRenameEvent) => void>(() => {});
  const nativeContextMenuOpenRef = useRef<(item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => void>(() => {});
  const useNativeWorkspaceContextMenu = shouldUseNativeAppContextMenus();
  const model = useMemo(
    () =>
      new TreesModel({
        paths: [],
        search: false,
        composition: {
          contextMenu: useNativeWorkspaceContextMenu
            ? { enabled: true, triggerMode: 'right-click', onOpen: (item, context) => nativeContextMenuOpenRef.current(item, context) }
            : { triggerMode: 'right-click' },
        },
        onSelectionChange: (paths) => selectionChangeRef.current(paths),
        renaming: { onRename: (event) => renameRef.current(event) },
      }),
    [useNativeWorkspaceContextMenu],
  );

  const loadRoot = useCallback(async () => {
    if (!cwd) return;
    const serial = ++refreshSerial.current;
    setRootListing((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const data = await api.workspaceTree(cwd, '');
      if (refreshSerial.current !== serial) return;
      setRootListing({ status: 'idle', data, error: null });
    } catch (error) {
      if (refreshSerial.current !== serial) return;
      setRootListing({ status: 'idle', data: null, error: error instanceof Error ? error.message : String(error) });
    }
  }, [cwd]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      void loadRoot();
    }, GIT_REFRESH_DEBOUNCE_MS);
  }, [loadRoot]);

  useWorkspaceWatcher(cwd, open || railOnly, scheduleRefresh);

  useEffect(() => {
    setNodes({});
    setSelectedPath(null);
    setOpenFilePaths(readWorkspaceOpenFiles(cwd));
    setFileState({ status: 'idle', data: null, error: null });
    setDiffState({ status: 'idle', data: null, error: null });
    void loadRoot();
  }, [cwd, loadRoot]);

  useEffect(() => {
    if (!cwd || !activeFilePath) return;
    setOpenFilePaths((current) => {
      const next = addWorkspaceOpenFile(current, activeFilePath);
      writeWorkspaceOpenFiles(cwd, next);
      return next;
    });
  }, [activeFilePath, cwd]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!cwd) return;
      setNodes((current) => ({
        ...current,
        [path]: { ...(current[path] ?? { expanded: true, entries: null, error: null }), expanded: true, loading: true, error: null },
      }));
      try {
        const listing = await api.workspaceTree(cwd, path);
        setNodes((current) => ({ ...current, [path]: { expanded: true, loading: false, entries: listing.entries, error: null } }));
      } catch (error) {
        setNodes((current) => ({
          ...current,
          [path]: {
            ...(current[path] ?? { expanded: true, entries: null }),
            expanded: true,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    },
    [cwd],
  );

  const toggleDirectory = useCallback(
    (entry: WorkspaceEntry) => {
      setNodes((current) => {
        const existing = current[entry.path];
        if (existing?.expanded) {
          return { ...current, [entry.path]: { ...existing, expanded: false } };
        }
        return {
          ...current,
          [entry.path]: { expanded: true, loading: !existing?.entries, entries: existing?.entries ?? null, error: null },
        };
      });
      if (!nodes[entry.path]?.entries) void loadDirectory(entry.path);
    },
    [loadDirectory, nodes],
  );

  const selectFile = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!cwd) return;
      setSelectedPath(entry.path);
      setFileState({ status: 'loading', data: null, error: null });
      setDiffState({ status: 'idle', data: null, error: null });
      try {
        const file = await api.workspaceFile(cwd, entry.path);
        setFileState({ status: 'idle', data: file, error: null });
        if (file.gitStatus) {
          setDiffState({ status: 'loading', data: null, error: null });
          try {
            const diff = await api.workspaceDiff(cwd, entry.path);
            setDiffState({ status: 'idle', data: diff, error: null });
          } catch {
            setDiffState({ status: 'idle', data: null, error: null });
          }
        }
      } catch (error) {
        setFileState({ status: 'idle', data: null, error: error instanceof Error ? error.message : String(error) });
      }
    },
    [cwd],
  );

  const openWorkspaceFile = useCallback(
    (path: string) => {
      if (!cwd) return;
      setOpenFilePaths((current) => {
        const next = addWorkspaceOpenFile(current, path);
        writeWorkspaceOpenFiles(cwd, next);
        return next;
      });
      if (onOpenFile) {
        onOpenFile({ cwd, path });
        return;
      }
      onDraftPrompt(buildPrompt(rootListing.data?.root ?? cwd, 'inspect this file', path));
    },
    [cwd, onDraftPrompt, onOpenFile, rootListing.data?.root],
  );

  const closeWorkspaceFile = useCallback(
    (path: string) => {
      setOpenFilePaths((current) => {
        const next = removeWorkspaceOpenFile(current, path);
        writeWorkspaceOpenFiles(cwd, next);
        return next;
      });
    },
    [cwd],
  );

  const closeAllWorkspaceFiles = useCallback(() => {
    setOpenFilePaths([]);
    writeWorkspaceOpenFiles(cwd, []);
  }, [cwd]);

  const createPath = useCallback(
    async (kind: 'file' | 'folder', directory: string) => {
      if (!cwd) return;
      const label = kind === 'file' ? 'New file name' : 'New folder name';
      const fallback = kind === 'file' ? 'untitled.txt' : 'New Folder';
      const name = window.prompt(label, fallback)?.trim();
      if (!name) return;
      const path = [directory, name].filter(Boolean).join('/');
      if (kind === 'file') {
        await api.createWorkspaceFile(cwd, path, '');
        openWorkspaceFile(path);
      } else {
        await api.createWorkspaceFolder(cwd, path);
      }
      await loadRoot();
      if (directory) await loadDirectory(directory);
    },
    [cwd, loadDirectory, loadRoot, openWorkspaceFile],
  );

  const deletePath = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!cwd) return;
      if (!window.confirm(`Delete ${entry.path}? This cannot be undone.`)) return;
      await api.deleteWorkspacePath(cwd, entry.path);
      setOpenFilePaths((current) => {
        const next =
          entry.kind === 'directory'
            ? current.filter((path) => !path.startsWith(`${entry.path}/`))
            : removeWorkspaceOpenFile(current, entry.path);
        writeWorkspaceOpenFiles(cwd, next);
        return next;
      });
      await loadRoot();
      const parent = parentDirectory(entry.path);
      if (parent) await loadDirectory(parent);
    },
    [cwd, loadDirectory, loadRoot],
  );

  const movePath = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!cwd) return;
      const targetDir = window.prompt('Move to folder (blank for workspace root)', parentDirectory(entry.path));
      if (targetDir === null) return;
      const moved = await api.moveWorkspacePath(cwd, entry.path, targetDir.trim());
      setOpenFilePaths((current) => {
        const next = current.map((path) =>
          path === entry.path
            ? moved.path
            : path.startsWith(`${entry.path}/`)
              ? `${moved.path}/${path.slice(entry.path.length + 1)}`
              : path,
        );
        writeWorkspaceOpenFiles(cwd, next);
        return next;
      });
      await loadRoot();
      await loadDirectory(parentDirectory(entry.path));
      if (targetDir.trim()) await loadDirectory(targetDir.trim());
    },
    [cwd, loadDirectory, loadRoot],
  );

  const root = rootListing.data?.root ?? null;
  const changes = rootListing.data?.changes ?? [];
  const workspaceEntryMap = useMemo(() => {
    const map = new Map<string, WorkspaceEntry>();
    for (const entry of rootListing.data?.entries ?? []) {
      map.set(entry.path, entry);
    }
    for (const node of Object.values(nodes)) {
      for (const entry of node.entries ?? []) {
        map.set(entry.path, entry);
      }
    }
    return map;
  }, [nodes, rootListing.data?.entries]);
  const workspaceTreePaths = useMemo(() => [...workspaceEntryMap.values()].map(workspaceEntryToTreePath), [workspaceEntryMap]);
  const selectedFile = fileState.data;
  const diffSpec = showDiff && diffState.data ? diffState.data : { addedLines: [], deletedBlocks: [] };
  const editorExtensions = useMemo(() => createWorkspaceEditorExtensions(selectedFile?.path ?? '', theme), [selectedFile?.path, theme]);

  const onEditorCreate = useCallback(
    (view: EditorView) => {
      view.dispatch({ effects: setDiffDecorations.of(diffSpec) });
    },
    [diffSpec],
  );

  useEffect(() => {
    writeStoredBoolean(WORKSPACE_EXPLORER_OPEN_KEY, open);
  }, [open]);

  useEffect(() => {
    writeStoredBoolean(WORKSPACE_EXPLORER_DIFF_KEY, showDiff);
  }, [showDiff]);

  useEffect(() => {
    model.resetPaths(workspaceTreePaths, {
      initialExpandedPaths: collectExpandedWorkspaceFolderPaths(model, workspaceEntryMap.values()),
    });
  }, [model, workspaceEntryMap, workspaceTreePaths]);

  useEffect(() => {
    selectionChangeRef.current = (paths: readonly string[]) => {
      const selected = paths[0];
      if (!selected) return;
      const workspacePath = treePathToWorkspacePath(selected);
      const entry = workspaceEntryMap.get(workspacePath);
      if (!entry) return;
      if (entry.kind === 'directory') {
        return;
      }
      if (cwd && onOpenFile) {
        openWorkspaceFile(entry.path);
        return;
      }
      onDraftPrompt(buildPrompt(root, 'inspect this file', entry.path));
    };
  }, [cwd, onDraftPrompt, onOpenFile, openWorkspaceFile, root, workspaceEntryMap]);

  useEffect(() => {
    renameRef.current = ({ sourcePath, destinationPath }: FileTreeRenameEvent) => {
      if (!cwd) return;
      const entry = workspaceEntryMap.get(treePathToWorkspacePath(sourcePath));
      const nextName = destinationPath.split('/').filter(Boolean).pop()?.trim() ?? '';
      if (!entry || !nextName || nextName === entry.name) return;
      void api
        .renameWorkspacePath(cwd, entry.path, nextName)
        .then((renamed) => {
          setOpenFilePaths((current) => {
            const next = current.map((path) =>
              path === entry.path
                ? renamed.path
                : path.startsWith(`${entry.path}/`)
                  ? `${renamed.path}/${path.slice(entry.path.length + 1)}`
                  : path,
            );
            writeWorkspaceOpenFiles(cwd, next);
            return next;
          });
          void loadRoot();
          const parent = parentDirectory(entry.path);
          if (parent) void loadDirectory(parent);
        })
        .catch((error) => window.alert(error instanceof Error ? error.message : String(error)));
    };
  }, [cwd, loadDirectory, loadRoot, workspaceEntryMap]);

  useEffect(() => {
    nativeContextMenuOpenRef.current = (item, context) => {
      const entry = workspaceEntryMap.get(treePathToWorkspacePath(item.path));
      if (!entry || !cwd) return;
      const desktopBridge = getDesktopBridge();
      if (!desktopBridge?.showKnowledgeEntryContextMenu) return;
      context.close({ restoreFocus: false });
      void desktopBridge
        .showKnowledgeEntryContextMenu({
          x: context.anchorRect.left,
          y: context.anchorRect.bottom,
          canCreateFile: true,
          canCreateFolder: true,
          canOpenInFinder: Boolean(desktopBridge.openPath),
          canRename: true,
          canMove: true,
          canDelete: true,
        })
        .then(({ action }) => {
          if (action === 'new-file') void createPath('file', entry.kind === 'directory' ? entry.path : parentDirectory(entry.path));
          if (action === 'new-folder') void createPath('folder', entry.kind === 'directory' ? entry.path : parentDirectory(entry.path));
          if (action === 'open-in-finder') {
            void desktopBridge.openPath(
              entry.kind === 'directory' ? `${root ?? cwd}/${entry.path}` : `${root ?? cwd}/${parentDirectory(entry.path)}`,
            );
          }
          if (action === 'rename') model.startRenaming(workspaceEntryToTreePath(entry));
          if (action === 'move') void movePath(entry);
          if (action === 'delete') void deletePath(entry);
        });
    };
  }, [createPath, cwd, deletePath, model, movePath, root, workspaceEntryMap]);

  useEffect(() => {
    if (!railOnly) return;
    const unsubscribe = model.subscribe(() => {
      for (const entry of workspaceEntryMap.values()) {
        if (entry.kind !== 'directory') continue;
        const item = model.getItem(workspaceEntryToTreePath(entry));
        if (item?.isDirectory() && item.isExpanded() && !nodes[entry.path]?.entries && !nodes[entry.path]?.loading) {
          void loadDirectory(entry.path);
        }
      }
    });
    return unsubscribe;
  }, [loadDirectory, model, nodes, railOnly, workspaceEntryMap]);

  useEffect(() => () => model.cleanUp(), [model]);

  if (!cwd) return null;

  if (!open && !railOnly) {
    return (
      <button
        type="button"
        className="absolute right-3 top-3 z-40 rounded-md border border-border-subtle bg-base/90 px-2 py-1 text-[11px] text-secondary shadow-sm hover:text-primary"
        onClick={() => setOpen(true)}
      >
        Files
      </button>
    );
  }

  if (railOnly) {
    return (
      <div className="flex h-full flex-col bg-base/96 text-sm">
        <div className="max-h-[45%] shrink-0 overflow-hidden">
          <WorkspaceOpenFilesSection
            openFilePaths={openFilePaths}
            activePath={activeFilePath}
            onSelect={openWorkspaceFile}
            onClose={closeWorkspaceFile}
            onCloseAll={closeAllWorkspaceFiles}
          />
        </div>
        <div className="px-3 pt-1 pb-1 shrink-0 rounded-md">
          <div className="flex items-center gap-1">
            <p className="ui-section-label flex-1">File Explorer</p>
            <button
              type="button"
              className="ui-icon-button ui-icon-button-compact"
              title="Refresh workspace"
              onClick={() => {
                void loadRoot();
              }}
            >
              ↻
            </button>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-dim" title={rootListing.data?.root ?? cwd}>
            {rootListing.data?.rootName ?? 'Workspace'} · {rootListing.data?.branch ?? 'no branch'}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-1 pb-3">
          {rootListing.status === 'loading' && !rootListing.data ? (
            <p className="px-3 py-2 text-[12px] text-dim animate-pulse">Loading…</p>
          ) : rootListing.error ? (
            <EmptyState title="Workspace unavailable" body={rootListing.error} className="px-3 py-8" />
          ) : (
            <TreesFileTree
              className="h-full"
              model={model}
              {...(!useNativeWorkspaceContextMenu
                ? {
                    renderContextMenu: (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => {
                      const entry = workspaceEntryMap.get(treePathToWorkspacePath(item.path));
                      if (!entry) return null;
                      const directory = entry.kind === 'directory' ? entry.path : parentDirectory(entry.path);
                      const desktopBridge = getDesktopBridge();
                      return (
                        <WorkspaceTreeContextMenu
                          onCreateFile={() => {
                            context.close();
                            void createPath('file', directory);
                          }}
                          onCreateFolder={() => {
                            context.close();
                            void createPath('folder', directory);
                          }}
                          onOpenInFinder={
                            desktopBridge?.openPath
                              ? () => {
                                  context.close();
                                  void desktopBridge.openPath(
                                    entry.kind === 'directory' ? `${root ?? cwd}/${entry.path}` : `${root ?? cwd}/${directory}`,
                                  );
                                }
                              : undefined
                          }
                          onRename={() => {
                            context.close({ restoreFocus: false });
                            window.setTimeout(() => model.startRenaming(workspaceEntryToTreePath(entry)), 0);
                          }}
                          onMove={() => {
                            context.close();
                            void movePath(entry);
                          }}
                          onDelete={() => {
                            context.close();
                            void deletePath(entry);
                          }}
                        />
                      );
                    },
                  }
                : {})}
              style={TREE_HOST_STYLE}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        'flex h-full bg-base/96 text-sm',
        railOnly
          ? 'w-full flex-col'
          : 'w-[min(42vw,560px)] min-w-[360px] shrink-0 border-l border-border-subtle shadow-[-12px_0_28px_rgba(0,0,0,0.08)]',
      )}
    >
      <div className={cx('flex h-full flex-col', railOnly ? 'w-full' : 'w-[45%] min-w-[180px] border-r border-border-subtle/80')}>
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-primary">{rootListing.data?.rootName ?? 'Workspace'}</div>
            <div className="truncate font-mono text-[10px] text-dim" title={rootListing.data?.root ?? cwd}>
              {rootListing.data?.rootKind === 'git' ? 'repo root' : 'cwd'} · {rootListing.data?.branch ?? 'no branch'}
            </div>
          </div>
          {changes.length > 0 && (
            <Pill tone="warning" mono className="px-1.5 py-0 text-[10px]">
              {changes.length}
            </Pill>
          )}
          <button
            type="button"
            className="ui-icon-button ui-icon-button-compact"
            title="Refresh workspace"
            onClick={() => {
              void loadRoot();
            }}
          >
            ↻
          </button>
          {!railOnly && (
            <button
              type="button"
              className="ui-icon-button ui-icon-button-compact"
              title="Hide file explorer"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          {rootListing.status === 'loading' && !rootListing.data ? <LoadingState label="Loading files…" className="px-3 py-6" /> : null}
          {rootListing.error ? <EmptyState title="Workspace unavailable" body={rootListing.error} className="px-3 py-8" /> : null}
          {rootListing.data?.entries.map((entry) => (
            <WorkspaceTreeRow
              key={entry.path}
              entry={entry}
              depth={0}
              selectedPath={selectedPath}
              node={nodes[entry.path]}
              nodes={nodes}
              onToggle={toggleDirectory}
              onSelect={selectFile}
              onDraftPrompt={onDraftPrompt}
              root={root}
            />
          ))}
        </div>
      </div>

      {!railOnly && (
        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedPath ? (
            <EmptyState
              className="flex h-full flex-col justify-center px-5"
              title="Select a file"
              body="Files open read-only. Dirty files can show inline git decorations over the current source."
            />
          ) : fileState.status === 'loading' ? (
            <LoadingState label="Opening file…" className="h-full justify-center" />
          ) : fileState.error ? (
            <EmptyState className="flex h-full flex-col justify-center px-5" title="File unavailable" body={fileState.error} />
          ) : selectedFile ? (
            <>
              <div className="flex items-center gap-2 bg-base/70 px-3 py-2 text-secondary">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px] font-medium text-secondary" title={selectedFile.path}>
                    {selectedFile.path}
                  </div>
                  <div className="text-[10px] text-dim">
                    {formatWorkspaceEntrySize(selectedFile.size)} {selectedFile.binary ? '· binary' : ''}{' '}
                    {selectedFile.tooLarge ? '· large' : ''}
                  </div>
                </div>
                <WorkspaceStatusBadge status={selectedFile.gitStatus} />
                {selectedFile.gitStatus && !selectedFile.binary && !selectedFile.tooLarge && (
                  <button
                    type="button"
                    className={cx('ui-toolbar-button text-[11px]', showDiff && 'text-accent')}
                    onClick={() => setShowDiff((value) => !value)}
                  >
                    {showDiff ? 'Diff on' : 'Diff off'}
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {selectedFile.binary || (selectedFile.tooLarge && !selectedFile.content) ? (
                  <EmptyState
                    className="flex h-full flex-col justify-center px-5"
                    title={selectedFile.binary ? 'Binary file' : 'Large file'}
                    body="Metadata and git status are shown by default. Open anyway when you explicitly want to load the text."
                    action={
                      !selectedFile.binary ? (
                        <button
                          type="button"
                          className="ui-action-button"
                          onClick={async () => {
                            if (!cwd) return;
                            setFileState({ status: 'loading', data: selectedFile, error: null });
                            const file = await api.workspaceFile(cwd, selectedFile.path, { force: true });
                            setFileState({ status: 'idle', data: file, error: null });
                          }}
                        >
                          Open anyway
                        </button>
                      ) : undefined
                    }
                  />
                ) : (
                  <CodeMirror
                    value={selectedFile.content ?? ''}
                    height="100%"
                    theme="none"
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false, highlightActiveLineGutter: false }}
                    editable={false}
                    readOnly={true}
                    extensions={editorExtensions}
                    onCreateEditor={onEditorCreate}
                    style={{ backgroundColor: 'rgb(var(--color-base))', color: 'rgb(var(--color-primary))', height: '100%' }}
                    key={`${selectedFile.path}:${showDiff}:${diffState.data?.addedLines.length ?? 0}:${
                      diffState.data?.deletedBlocks.length ?? 0
                    }`}
                  />
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
                <button
                  type="button"
                  className="ui-toolbar-button text-[11px]"
                  onClick={() => onDraftPrompt(buildPrompt(root, 'explain this file', selectedFile.path))}
                >
                  Ask about file
                </button>
                <button
                  type="button"
                  className="ui-toolbar-button text-[11px]"
                  onClick={() => onDraftPrompt(buildPrompt(root, 'rename this file', selectedFile.path))}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="ui-toolbar-button text-[11px] text-danger"
                  onClick={() => onDraftPrompt(buildPrompt(root, 'delete this file after confirming it is safe', selectedFile.path))}
                >
                  Delete
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function WorkspaceFileDocument({
  cwd,
  path,
  onReplyWithSelection,
}: {
  cwd: string;
  path: string;
  onReplyWithSelection?: (selection: { filePath: string; text: string }) => void;
}) {
  const { theme } = useTheme();
  const [showDiff, setShowDiff] = useState(() => readStoredBoolean(WORKSPACE_EXPLORER_DIFF_KEY, true));
  const [fileState, setFileState] = useState<LoadState<WorkspaceFileContent>>({ status: 'loading', data: null, error: null });
  const [diffState, setDiffState] = useState<LoadState<WorkspaceDiffOverlay>>({ status: 'idle', data: null, error: null });
  const [draftContent, setDraftContent] = useState('');
  const [saveState, setSaveState] = useState<{ status: 'idle' | 'saving'; error: string | null }>({ status: 'idle', error: null });
  const [selectionContextMenu, setSelectionContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const selectionContextMenuRef = useRef<HTMLDivElement | null>(null);

  const loadFile = useCallback(
    async (options?: { force?: boolean }) => {
      setFileState((current) => ({ status: 'loading', data: current.data, error: null }));
      setDiffState({ status: 'idle', data: null, error: null });
      try {
        const file = await api.workspaceFile(cwd, path, { force: options?.force });
        setFileState({ status: 'idle', data: file, error: null });
        setDraftContent(file.content ?? '');
        setSaveState({ status: 'idle', error: null });
        if (file.gitStatus && !file.binary && !file.tooLarge) {
          setDiffState({ status: 'loading', data: null, error: null });
          try {
            const diff = await api.workspaceDiff(cwd, path);
            setDiffState({ status: 'idle', data: diff, error: null });
          } catch {
            // Diff is best-effort; don't let a diff failure cascade.
            setDiffState({ status: 'idle', data: null, error: null });
          }
        }
      } catch (error) {
        setFileState({ status: 'idle', data: null, error: error instanceof Error ? error.message : String(error) });
      }
    },
    [cwd, path],
  );

  const selectedFile = fileState.data;
  const dirty = Boolean(
    selectedFile &&
    !selectedFile.binary &&
    !(selectedFile.tooLarge && !selectedFile.content) &&
    draftContent !== (selectedFile.content ?? ''),
  );

  const saveFile = useCallback(async () => {
    if (!selectedFile || selectedFile.binary || (selectedFile.tooLarge && !selectedFile.content) || saveState.status === 'saving') return;
    setSaveState({ status: 'saving', error: null });
    try {
      const saved = await api.writeWorkspaceFile(cwd, selectedFile.path, draftContent);
      setFileState({ status: 'idle', data: saved, error: null });
      setDraftContent(saved.content ?? draftContent);
      setSaveState({ status: 'idle', error: null });
      if (saved.gitStatus && !saved.binary && !saved.tooLarge) {
        try {
          const diff = await api.workspaceDiff(cwd, saved.path);
          setDiffState({ status: 'idle', data: diff, error: null });
        } catch {
          setDiffState({ status: 'idle', data: null, error: null });
        }
      }
    } catch (error) {
      setSaveState({ status: 'idle', error: error instanceof Error ? error.message : String(error) });
    }
  }, [cwd, draftContent, saveState.status, selectedFile]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  useEffect(() => {
    writeStoredBoolean(WORKSPACE_EXPLORER_DIFF_KEY, showDiff);
  }, [showDiff]);

  const closeSelectionContextMenu = useCallback(() => {
    setSelectionContextMenu(null);
  }, []);

  useEffect(() => {
    if (!selectionContextMenu || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && selectionContextMenuRef.current?.contains(target)) {
        return;
      }

      closeSelectionContextMenu();
    };
    const handleSelectionChange = () => {
      if (!getSelectedTextWithin(editorContainerRef.current)) {
        closeSelectionContextMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSelectionContextMenu();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', closeSelectionContextMenu);
    window.addEventListener('resize', closeSelectionContextMenu);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', closeSelectionContextMenu);
      window.removeEventListener('resize', closeSelectionContextMenu);
    };
  }, [closeSelectionContextMenu, selectionContextMenu]);

  const diffSpec = showDiff && diffState.data ? diffState.data : { addedLines: [], deletedBlocks: [] };
  const editorExtensions = useMemo(
    () => createWorkspaceEditorExtensions(selectedFile?.path ?? path, theme),
    [path, selectedFile?.path, theme],
  );

  const onEditorCreate = useCallback(
    (view: EditorView) => {
      view.dispatch({ effects: setDiffDecorations.of(diffSpec) });
    },
    [diffSpec],
  );

  const copySelectedText = useCallback(
    async (text: string) => {
      closeSelectionContextMenu();
      if (!text || typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
        return;
      }

      await navigator.clipboard.writeText(text);
    },
    [closeSelectionContextMenu],
  );

  const replyWithSelectedText = useCallback(
    (text: string) => {
      closeSelectionContextMenu();
      if (!selectedFile || !text || !onReplyWithSelection) {
        return;
      }

      onReplyWithSelection({ filePath: selectedFile.path, text });
    },
    [closeSelectionContextMenu, onReplyWithSelection, selectedFile],
  );

  const handleEditorContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const text = getSelectedTextWithin(editorContainerRef.current);
      if (!text) {
        closeSelectionContextMenu();
        return;
      }

      event.preventDefault();

      const desktopBridge = shouldUseNativeAppContextMenus() ? getDesktopBridge() : null;
      if (desktopBridge?.showSelectionContextMenu) {
        closeSelectionContextMenu();
        void desktopBridge
          .showSelectionContextMenu({
            x: event.clientX,
            y: event.clientY,
            canReply: Boolean(onReplyWithSelection),
            canCopy: true,
          })
          .then(({ action }) => {
            if (action === 'reply') {
              replyWithSelectedText(text);
              return;
            }
            if (action === 'copy') {
              void copySelectedText(text);
            }
          })
          .catch(() => {
            setSelectionContextMenu({ x: event.clientX, y: event.clientY, text });
          });
        return;
      }

      setSelectionContextMenu({ x: event.clientX, y: event.clientY, text });
    },
    [closeSelectionContextMenu, copySelectedText, onReplyWithSelection, replyWithSelectedText],
  );

  if (fileState.status === 'loading' && !selectedFile) {
    return <LoadingState label="Opening file…" className="h-full justify-center" />;
  }

  if (fileState.error) {
    return <EmptyState className="flex h-full flex-col justify-center px-5" title="File unavailable" body={fileState.error} />;
  }

  if (!selectedFile) {
    return <EmptyState className="flex h-full flex-col justify-center px-5" title="File unavailable" body="No file is selected." />;
  }

  const breadcrumbs = buildWorkspaceBreadcrumbs(selectedFile.path);

  return (
    <div className="flex h-full min-w-0 flex-col bg-base select-text">
      <div className="flex items-center gap-2 bg-base/70 px-3 py-1.5 text-secondary">
        <div className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden font-mono text-[11px] leading-5 text-secondary">
          {breadcrumbs.map((segment, index) => (
            <div key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <span className="shrink-0 text-dim/80">›</span> : null}
              <span className="truncate" title={index === breadcrumbs.length - 1 ? selectedFile.path : undefined}>
                {segment}
              </span>
            </div>
          ))}
        </div>
        {selectedFile.gitStatus && !selectedFile.binary && !selectedFile.tooLarge && (
          <button
            type="button"
            className={cx('ui-toolbar-button px-2 text-[10px]', showDiff && 'text-accent')}
            onClick={() => setShowDiff((value) => !value)}
          >
            {showDiff ? 'Diff on' : 'Diff off'}
          </button>
        )}
        {!selectedFile.binary && !(selectedFile.tooLarge && !selectedFile.content) ? (
          <button
            type="button"
            className={cx(
              'ui-icon-button ui-icon-button-compact',
              dirty && saveState.status !== 'saving' && 'text-accent hover:bg-accent/10',
              saveState.status === 'saving' && 'text-warning animate-pulse',
              !dirty && saveState.status !== 'saving' && 'text-dim opacity-60',
            )}
            title={saveState.status === 'saving' ? 'Saving…' : dirty ? 'Save file' : 'Saved'}
            aria-label={saveState.status === 'saving' ? 'Saving file' : dirty ? 'Save file' : 'File saved'}
            onClick={() => {
              void saveFile();
            }}
            disabled={!dirty || saveState.status === 'saving'}
          >
            <Ico d={dirty ? ICON.save : ICON.check} size={12} />
          </button>
        ) : null}
        <button
          type="button"
          className="ui-icon-button ui-icon-button-compact"
          title="Refresh file"
          onClick={() => {
            void loadFile();
          }}
        >
          ↻
        </button>
      </div>
      {saveState.error ? <div className="bg-danger/5 px-3 py-1 text-[11px] text-danger">{saveState.error}</div> : null}
      <div ref={editorContainerRef} className="min-h-0 flex-1 overflow-hidden" onContextMenu={handleEditorContextMenu}>
        {selectedFile.binary || (selectedFile.tooLarge && !selectedFile.content) ? (
          <EmptyState
            className="flex h-full flex-col justify-center px-5"
            title={selectedFile.binary ? 'Binary file' : 'Large file'}
            body="Metadata and git status are shown by default. Open anyway when you explicitly want to load the text."
            action={
              !selectedFile.binary ? (
                <button
                  type="button"
                  className="ui-action-button"
                  onClick={() => {
                    void loadFile({ force: true });
                  }}
                >
                  Open anyway
                </button>
              ) : undefined
            }
          />
        ) : (
          <CodeMirror
            value={draftContent}
            height="100%"
            theme="none"
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false, highlightActiveLineGutter: false }}
            editable={true}
            readOnly={false}
            extensions={editorExtensions}
            onChange={setDraftContent}
            onCreateEditor={onEditorCreate}
            style={{ backgroundColor: 'rgb(var(--color-base))', color: 'rgb(var(--color-primary))', height: '100%' }}
            key={`${selectedFile.path}:${showDiff}:${diffState.data?.addedLines.length ?? 0}:${diffState.data?.deletedBlocks.length ?? 0}`}
          />
        )}
      </div>
      {selectionContextMenu ? (
        <div
          ref={selectionContextMenuRef}
          className="ui-menu-shell ui-context-menu-shell fixed bottom-auto left-auto right-auto top-auto mb-0 min-w-[224px]"
          style={{ left: selectionContextMenu.x, top: selectionContextMenu.y }}
          role="menu"
          aria-label="Selected file text actions"
        >
          <div className="space-y-px">
            {onReplyWithSelection ? (
              <>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={() => replyWithSelectedText(selectionContextMenu.text)}
                  className="ui-context-menu-item"
                  role="menuitem"
                >
                  Reply with Selection
                </button>
                <div className="mx-1 my-1 h-px bg-border-subtle" role="separator" />
              </>
            ) : null}
            <button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => {
                void copySelectedText(selectionContextMenu.text);
              }}
              className="ui-context-menu-item"
              role="menuitem"
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

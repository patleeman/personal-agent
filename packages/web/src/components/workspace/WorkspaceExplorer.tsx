import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, Decoration, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { api } from '../../client/api';
import { buildApiPath } from '../../client/apiBase';
import type { WorkspaceDiffOverlay, WorkspaceDirectoryListing, WorkspaceEntry, WorkspaceFileContent, WorkspaceGitStatusChange } from '../../shared/types';
import { cx, EmptyState, LoadingState, Pill } from '../ui';

interface WorkspaceExplorerProps {
  cwd: string | null;
  onDraftPrompt: (prompt: string) => void;
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

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch { /* ignore */ }
  return fallback;
}

function writeStoredBoolean(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ }
}

function formatBytes(size: number | null): string {
  if (size === null) return '';
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
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) return javascript({ jsx: /\.(tsx|jsx)$/.test(lower), typescript: /\.(ts|tsx)$/.test(lower) });
  if (/\.jsonc?$/.test(lower)) return json();
  if (/\.(md|mdx|markdown)$/.test(lower)) return markdown();
  if (/\.py$/.test(lower)) return python();
  if (/\.(html|xml|svg)$/.test(lower)) return html();
  if (/\.(css|scss|sass|less)$/.test(lower)) return css();
  if (/\.(ya?ml)$/.test(lower)) return yaml();
  return [];
}

class DeletedLinesWidget extends WidgetType {
  constructor(private readonly lines: string[]) { super(); }

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
const diffDecorationsField = StateField.define<DiffDecorationSpec>({
  create: () => ({ addedLines: [], deletedBlocks: [] }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDiffDecorations)) return effect.value;
    }
    return value;
  },
});

const diffDecorationPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: { docChanged: boolean; viewportChanged: boolean; startState: unknown; state: typeof EditorView.prototype.state; view: EditorView }) {
    if (update.docChanged || update.viewportChanged || update.startState !== update.state) {
      this.decorations = this.build(update.view);
    }
  }

  build(view: EditorView): DecorationSet {
    const spec = view.state.field(diffDecorationsField, false) ?? { addedLines: [], deletedBlocks: [] };
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

    for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
      const line = view.state.doc.line(lineNumber);
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
}, { decorations: (plugin) => plugin.decorations });

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

function WorkspaceStatusBadge({ status, count }: { status: WorkspaceGitStatusChange | null; count?: number }) {
  if (!status && !count) return null;
  if (status) {
    return <Pill tone={statusTone(status)} mono className="px-1.5 py-0 text-[10px]" title={STATUS_TITLES[status]}>{STATUS_LABELS[status]}</Pill>;
  }
  return <span className="rounded-sm bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent" title={`${count} changed descendant${count === 1 ? '' : 's'}`}>{count}</span>;
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
        className={cx('group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-secondary hover:bg-surface/70 hover:text-primary', selected && 'bg-accent/10 text-primary')}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => isDirectory ? onToggle(entry) : onSelect(entry)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            isDirectory ? onToggle(entry) : onSelect(entry);
          }
        }}
      >
        <span className={cx('w-3 shrink-0 text-dim transition-transform', isDirectory && node?.expanded && 'rotate-90')}>{fileIcon(entry)}</span>
        <span className={cx('min-w-0 flex-1 truncate', isDirectory ? 'font-medium' : 'font-mono')}>{entry.name}</span>
        {entry.size !== null && <span className="hidden shrink-0 text-[10px] text-dim group-hover:inline">{formatBytes(entry.size)}</span>}
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
          {node.loading && <div className="px-3 py-1 text-[11px] text-dim" style={{ paddingLeft: `${24 + depth * 14}px` }}>Loading…</div>}
          {node.error && <div className="px-3 py-1 text-[11px] text-danger" style={{ paddingLeft: `${24 + depth * 14}px` }}>{node.error}</div>}
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

export function WorkspaceExplorer({ cwd, onDraftPrompt, railOnly = false }: WorkspaceExplorerProps) {
  const [open, setOpen] = useState(() => readStoredBoolean(WORKSPACE_EXPLORER_OPEN_KEY, true));
  const [showDiff, setShowDiff] = useState(() => readStoredBoolean(WORKSPACE_EXPLORER_DIFF_KEY, true));
  const [rootListing, setRootListing] = useState<LoadState<WorkspaceDirectoryListing>>({ status: 'idle', data: null, error: null });
  const [nodes, setNodes] = useState<Record<string, TreeNodeState>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileState, setFileState] = useState<LoadState<WorkspaceFileContent>>({ status: 'idle', data: null, error: null });
  const [diffState, setDiffState] = useState<LoadState<WorkspaceDiffOverlay>>({ status: 'idle', data: null, error: null });
  const refreshSerial = useRef(0);
  const refreshTimer = useRef<number | null>(null);

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
    refreshTimer.current = window.setTimeout(() => { void loadRoot(); }, GIT_REFRESH_DEBOUNCE_MS);
  }, [loadRoot]);

  useWorkspaceWatcher(cwd, open, scheduleRefresh);

  useEffect(() => {
    setNodes({});
    setSelectedPath(null);
    setFileState({ status: 'idle', data: null, error: null });
    setDiffState({ status: 'idle', data: null, error: null });
    void loadRoot();
  }, [loadRoot]);

  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

  const loadDirectory = useCallback(async (path: string) => {
    if (!cwd) return;
    setNodes((current) => ({ ...current, [path]: { ...(current[path] ?? { expanded: true, entries: null, error: null }), expanded: true, loading: true, error: null } }));
    try {
      const listing = await api.workspaceTree(cwd, path);
      setNodes((current) => ({ ...current, [path]: { expanded: true, loading: false, entries: listing.entries, error: null } }));
    } catch (error) {
      setNodes((current) => ({ ...current, [path]: { ...(current[path] ?? { expanded: true, entries: null }), expanded: true, loading: false, error: error instanceof Error ? error.message : String(error) } }));
    }
  }, [cwd]);

  const toggleDirectory = useCallback((entry: WorkspaceEntry) => {
    setNodes((current) => {
      const existing = current[entry.path];
      if (existing?.expanded) {
        return { ...current, [entry.path]: { ...existing, expanded: false } };
      }
      return { ...current, [entry.path]: { expanded: true, loading: !existing?.entries, entries: existing?.entries ?? null, error: null } };
    });
    if (!nodes[entry.path]?.entries) void loadDirectory(entry.path);
  }, [loadDirectory, nodes]);

  const selectFile = useCallback(async (entry: WorkspaceEntry) => {
    if (!cwd) return;
    setSelectedPath(entry.path);
    setFileState({ status: 'loading', data: null, error: null });
    setDiffState({ status: 'idle', data: null, error: null });
    try {
      const file = await api.workspaceFile(cwd, entry.path);
      setFileState({ status: 'idle', data: file, error: null });
      if (file.gitStatus) {
        setDiffState({ status: 'loading', data: null, error: null });
        const diff = await api.workspaceDiff(cwd, entry.path);
        setDiffState({ status: 'idle', data: diff, error: null });
      }
    } catch (error) {
      setFileState({ status: 'idle', data: null, error: error instanceof Error ? error.message : String(error) });
    }
  }, [cwd]);

  const root = rootListing.data?.root ?? null;
  const changes = rootListing.data?.changes ?? [];
  const selectedFile = fileState.data;
  const diffSpec = showDiff && diffState.data ? diffState.data : { addedLines: [], deletedBlocks: [] };
  const editorExtensions = useMemo(() => [
    diffDecorationsField,
    diffDecorationPlugin,
    EditorView.lineWrapping,
    EditorView.theme({
      '&': { height: '100%', background: 'transparent' },
      '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)' },
      '.workspace-added-line': { backgroundColor: 'rgba(34, 197, 94, 0.15)' },
      '.workspace-deleted-lines': { backgroundColor: 'rgba(239, 68, 68, 0.12)', color: 'rgb(var(--color-danger, 239 68 68))', borderLeft: '2px solid rgba(239, 68, 68, 0.7)', padding: '2px 0 2px 8px', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)' },
      '.workspace-deleted-line': { whiteSpace: 'pre', minHeight: '1.4em' },
      '.workspace-diff-marker': { display: 'inline-block', width: '1.5em', opacity: '0.75' },
    }),
    extensionForPath(selectedFile?.path ?? ''),
  ], [selectedFile?.path]);

  const onEditorCreate = useCallback((view: EditorView) => {
    view.dispatch({ effects: setDiffDecorations.of(diffSpec) });
  }, [diffSpec]);

  useEffect(() => {
    writeStoredBoolean(WORKSPACE_EXPLORER_OPEN_KEY, open);
  }, [open]);

  useEffect(() => {
    writeStoredBoolean(WORKSPACE_EXPLORER_DIFF_KEY, showDiff);
  }, [showDiff]);

  if (!cwd) return null;

  if (!open && !railOnly) {
    return (
      <button type="button" className="absolute right-3 top-3 z-40 rounded-md border border-border-subtle bg-base/90 px-2 py-1 text-[11px] text-secondary shadow-sm hover:text-primary" onClick={() => setOpen(true)}>
        Files
      </button>
    );
  }

  return (
    <div className={cx('flex h-full bg-base/96 text-sm', railOnly ? 'w-full flex-col' : 'w-[min(42vw,560px)] min-w-[360px] shrink-0 border-l border-border-subtle shadow-[-12px_0_28px_rgba(0,0,0,0.08)]')}>
      <div className={cx('flex h-full flex-col', railOnly ? 'w-full' : 'w-[45%] min-w-[180px] border-r border-border-subtle/80')}>
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-primary">{rootListing.data?.rootName ?? 'Workspace'}</div>
            <div className="truncate font-mono text-[10px] text-dim" title={rootListing.data?.root ?? cwd}>{rootListing.data?.rootKind === 'git' ? 'repo root' : 'cwd'} · {rootListing.data?.branch ?? 'no branch'}</div>
          </div>
          {changes.length > 0 && <Pill tone="warning" mono className="px-1.5 py-0 text-[10px]">{changes.length}</Pill>}
          <button type="button" className="ui-icon-button ui-icon-button-compact" title="Refresh workspace" onClick={() => { void loadRoot(); }}>↻</button>
          {!railOnly && <button type="button" className="ui-icon-button ui-icon-button-compact" title="Hide file explorer" onClick={() => setOpen(false)}>×</button>}
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
        <div className="border-t border-border-subtle px-3 py-2 text-[10px] text-dim">
          Realtime watcher active; git refresh is debounced.
        </div>
      </div>

      {!railOnly && <div className="flex min-w-0 flex-1 flex-col">
        {!selectedPath ? (
          <EmptyState className="flex h-full flex-col justify-center px-5" title="Select a file" body="Files open read-only. Dirty files can show inline git decorations over the current source." />
        ) : fileState.status === 'loading' ? (
          <LoadingState label="Opening file…" className="h-full justify-center" />
        ) : fileState.error ? (
          <EmptyState className="flex h-full flex-col justify-center px-5" title="File unavailable" body={fileState.error} />
        ) : selectedFile ? (
          <>
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] font-semibold text-primary" title={selectedFile.path}>{selectedFile.path}</div>
                <div className="text-[10px] text-dim">{formatBytes(selectedFile.size)} {selectedFile.binary ? '· binary' : ''} {selectedFile.tooLarge ? '· large' : ''}</div>
              </div>
              <WorkspaceStatusBadge status={selectedFile.gitStatus} />
              {selectedFile.gitStatus && !selectedFile.binary && !selectedFile.tooLarge && (
                <button type="button" className={cx('ui-toolbar-button text-[11px]', showDiff && 'text-accent')} onClick={() => setShowDiff((value) => !value)}>
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
                  action={!selectedFile.binary ? (
                    <button type="button" className="ui-action-button" onClick={async () => {
                      if (!cwd) return;
                      setFileState({ status: 'loading', data: selectedFile, error: null });
                      const file = await api.workspaceFile(cwd, selectedFile.path, { force: true });
                      setFileState({ status: 'idle', data: file, error: null });
                    }}>Open anyway</button>
                  ) : undefined}
                />
              ) : (
                <CodeMirror
                  value={selectedFile.content ?? ''}
                  height="100%"
                  basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false, highlightActiveLineGutter: false }}
                  editable={false}
                  readOnly={true}
                  theme={oneDark}
                  extensions={editorExtensions}
                  onCreateEditor={onEditorCreate}
                  key={`${selectedFile.path}:${showDiff}:${diffState.data?.addedLines.length ?? 0}:${diffState.data?.deletedBlocks.length ?? 0}`}
                />
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
              <button type="button" className="ui-toolbar-button text-[11px]" onClick={() => onDraftPrompt(buildPrompt(root, 'explain this file', selectedFile.path))}>Ask about file</button>
              <button type="button" className="ui-toolbar-button text-[11px]" onClick={() => onDraftPrompt(buildPrompt(root, 'rename this file', selectedFile.path))}>Rename</button>
              <button type="button" className="ui-toolbar-button text-[11px] text-danger" onClick={() => onDraftPrompt(buildPrompt(root, 'delete this file after confirming it is safe', selectedFile.path))}>Delete</button>
            </div>
          </>
        ) : null}
      </div>}
    </div>
  );
}

import type { ReactNode } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { diffLines, diffWordsWithSpace } from 'diff';
import type { WorkspaceChangeKind, WorkspaceTreeNode } from './types';

export const WORKSPACE_CWD_SEARCH_PARAM = 'cwd';
export const WORKSPACE_FILE_SEARCH_PARAM = 'file';

const TREE_ROW_CLASS = 'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors';
const TREE_ROW_IDLE_CLASS = 'text-secondary hover:bg-surface hover:text-primary';
const TREE_ROW_ACTIVE_CLASS = 'bg-accent/10 text-primary';

export function readWorkspaceCwdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(WORKSPACE_CWD_SEARCH_PARAM)?.trim() || null;
}

export function readWorkspaceFileFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(WORKSPACE_FILE_SEARCH_PARAM)?.trim() || null;
}

export function buildWorkspaceSearch(locationSearch: string, patch: {
  cwd?: string | null;
  file?: string | null;
}): string {
  const params = new URLSearchParams(locationSearch);

  if (patch.cwd !== undefined) {
    const nextCwd = patch.cwd?.trim() ?? '';
    if (nextCwd) {
      params.set(WORKSPACE_CWD_SEARCH_PARAM, nextCwd);
    } else {
      params.delete(WORKSPACE_CWD_SEARCH_PARAM);
    }
  }

  if (patch.file !== undefined) {
    const nextFile = patch.file?.trim() ?? '';
    if (nextFile) {
      params.set(WORKSPACE_FILE_SEARCH_PARAM, nextFile);
    } else {
      params.delete(WORKSPACE_FILE_SEARCH_PARAM);
    }
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= 1_048_576) {
    return `${(sizeBytes / 1_048_576).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${sizeBytes} B`;
}

export function changeLabel(change: WorkspaceChangeKind): string {
  switch (change) {
    case 'modified':
      return 'modified';
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'copied';
    case 'typechange':
      return 'type changed';
    case 'untracked':
      return 'untracked';
    case 'conflicted':
      return 'conflicted';
  }
}

export function changeShortLabel(change: WorkspaceChangeKind): string {
  switch (change) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'typechange':
      return 'T';
    case 'untracked':
      return '?';
    case 'conflicted':
      return '!';
  }
}

export function changeTone(change: WorkspaceChangeKind): 'warning' | 'accent' | 'danger' | 'teal' {
  switch (change) {
    case 'deleted':
    case 'conflicted':
      return 'danger';
    case 'added':
    case 'untracked':
      return 'teal';
    case 'renamed':
    case 'copied':
      return 'accent';
    default:
      return 'warning';
  }
}

export function summarizeChanges(count: number): string {
  if (count === 0) {
    return 'working tree clean';
  }

  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

export function flattenFiles(nodes: WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  return nodes.flatMap((node) => node.kind === 'directory' ? flattenFiles(node.children ?? []) : [node]);
}

export function treeContainsPath(nodes: WorkspaceTreeNode[], relativePath: string): boolean {
  return nodes.some((node) => {
    if (node.relativePath === relativePath) {
      return true;
    }

    return node.kind === 'directory' && treeContainsPath(node.children ?? [], relativePath);
  });
}

export function parentPaths(relativePath: string | null | undefined): string[] {
  if (!relativePath) {
    return [];
  }

  const parts = relativePath.split('/').filter(Boolean);
  const result: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    result.push(parts.slice(0, index).join('/'));
  }
  return result;
}

export function buildInitialExpandedPaths(snapshot: {
  tree: WorkspaceTreeNode[];
  focusPath: string | null;
  changes: Array<{ relativePath: string }>;
} | null, selectedFilePath: string | null): Set<string> {
  if (!snapshot) {
    return new Set();
  }

  const expanded = new Set<string>();
  for (const node of snapshot.tree) {
    if (node.kind === 'directory') {
      expanded.add(node.relativePath);
    }
  }

  for (const path of parentPaths(snapshot.focusPath)) {
    expanded.add(path);
  }

  if (snapshot.focusPath) {
    expanded.add(snapshot.focusPath);
  }

  for (const change of snapshot.changes) {
    for (const path of parentPaths(change.relativePath)) {
      expanded.add(path);
    }
  }

  for (const path of parentPaths(selectedFilePath)) {
    expanded.add(path);
  }

  return expanded;
}

export function filterWorkspaceTree(nodes: WorkspaceTreeNode[], options: {
  query: string;
  changedOnly: boolean;
}): WorkspaceTreeNode[] {
  const normalizedQuery = options.query.trim().toLowerCase();

  return nodes.flatMap((node) => {
    if (node.kind === 'file') {
      const matchesQuery = !normalizedQuery || node.relativePath.toLowerCase().includes(normalizedQuery);
      const matchesChange = !options.changedOnly || node.change !== null;
      return matchesQuery && matchesChange ? [node] : [];
    }

    const children = filterWorkspaceTree(node.children ?? [], options);
    const selfMatchesQuery = !normalizedQuery || node.relativePath.toLowerCase().includes(normalizedQuery);
    if (children.length > 0 || (selfMatchesQuery && !options.changedOnly)) {
      return [{ ...node, children }];
    }

    return [];
  });
}

export function languageExtensionForPath(path: string): Extension | null {
  const normalized = path.toLowerCase();

  if (normalized.endsWith('.ts')) {
    return javascript({ typescript: true });
  }
  if (normalized.endsWith('.tsx')) {
    return javascript({ typescript: true, jsx: true });
  }
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return javascript();
  }
  if (normalized.endsWith('.jsx')) {
    return javascript({ jsx: true });
  }
  if (normalized.endsWith('.json') || normalized.endsWith('.jsonc')) {
    return json();
  }
  if (normalized.endsWith('.md') || normalized.endsWith('.mdx')) {
    return markdown();
  }
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return html();
  }
  if (normalized.endsWith('.css') || normalized.endsWith('.scss')) {
    return css();
  }
  if (normalized.endsWith('.yml') || normalized.endsWith('.yaml')) {
    return yaml();
  }
  if (normalized.endsWith('.py')) {
    return python();
  }

  return null;
}

export function editorChromeTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
      lineHeight: '1.7',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '18px 20px',
    },
    '.cm-gutters': {
      minHeight: '100%',
      border: 'none',
      backgroundColor: 'transparent',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'rgba(120, 131, 155, 0.08)',
    },
    '.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor': {
      borderLeftWidth: '2px',
    },
  });
}

export function TreeRowChange({ change }: { change: WorkspaceChangeKind | null }) {
  if (!change) {
    return <span className="w-4 shrink-0" aria-hidden="true" />;
  }

  return (
    <span className="w-4 shrink-0 text-center" title={changeLabel(change)}>
      <span className={[
        'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold',
        changeTone(change) === 'danger'
          ? 'bg-danger/12 text-danger'
          : changeTone(change) === 'teal'
            ? 'bg-teal/12 text-teal'
            : changeTone(change) === 'accent'
              ? 'bg-accent/12 text-accent'
              : 'bg-warning/12 text-warning',
      ].join(' ')}>
        {changeShortLabel(change)}
      </span>
    </span>
  );
}

export function WorkspaceTreeView({
  nodes,
  selectedPath,
  expandedPaths,
  onToggle,
  onSelect,
  depth = 0,
}: {
  nodes: WorkspaceTreeNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const isSelected = node.kind === 'file' && node.relativePath === selectedPath;
        const isExpanded = node.kind === 'directory' && expandedPaths.has(node.relativePath);
        const rowClassName = [
          TREE_ROW_CLASS,
          isSelected ? TREE_ROW_ACTIVE_CLASS : TREE_ROW_IDLE_CLASS,
          !node.exists && 'opacity-70',
        ].filter(Boolean).join(' ');

        return (
          <div key={node.relativePath || node.name}>
            {node.kind === 'directory' ? (
              <button
                type="button"
                className={rowClassName}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                onClick={() => onToggle(node.relativePath)}
                title={node.path}
              >
                <span className="w-4 shrink-0 text-center text-dim">{isExpanded ? '▾' : '▸'}</span>
                <TreeRowChange change={null} />
                <span className="truncate">{node.name}</span>
              </button>
            ) : (
              <button
                type="button"
                className={rowClassName}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                onClick={() => onSelect(node.relativePath)}
                title={node.path}
              >
                <span className="w-4 shrink-0 text-center text-dim">·</span>
                <TreeRowChange change={node.change} />
                <span className={[
                  'truncate',
                  !node.exists && 'line-through',
                ].filter(Boolean).join(' ')}>
                  {node.name}
                </span>
              </button>
            )}

            {node.kind === 'directory' && isExpanded && (node.children?.length ?? 0) > 0 && (
              <WorkspaceTreeView
                nodes={node.children ?? []}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                onSelect={onSelect}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type DiffWordSegment = {
  text: string;
  tone: 'base' | 'added' | 'removed';
};

type DiffRow =
  | {
      kind: 'context';
      leftLine: number;
      rightLine: number;
      leftSegments: DiffWordSegment[];
      rightSegments: DiffWordSegment[];
    }
  | {
      kind: 'removed';
      leftLine: number;
      rightLine: null;
      leftSegments: DiffWordSegment[];
      rightSegments: DiffWordSegment[];
    }
  | {
      kind: 'added';
      leftLine: null;
      rightLine: number;
      leftSegments: DiffWordSegment[];
      rightSegments: DiffWordSegment[];
    }
  | {
      kind: 'changed';
      leftLine: number | null;
      rightLine: number | null;
      leftSegments: DiffWordSegment[];
      rightSegments: DiffWordSegment[];
    }
  | {
      kind: 'collapsed';
      hiddenCount: number;
    };

function splitDiffLines(text: string): string[] {
  if (!text) {
    return [];
  }

  const hasTrailingNewline = text.endsWith('\n');
  const parts = text.split('\n');
  if (hasTrailingNewline) {
    parts.pop();
  }

  return parts.map((part, index) => {
    const shouldAppendNewline = hasTrailingNewline || index < parts.length - 1;
    return shouldAppendNewline ? `${part}\n` : part;
  });
}

function buildWordSegments(beforeText: string, afterText: string): {
  leftSegments: DiffWordSegment[];
  rightSegments: DiffWordSegment[];
} {
  const leftSegments: DiffWordSegment[] = [];
  const rightSegments: DiffWordSegment[] = [];

  for (const token of diffWordsWithSpace(beforeText, afterText)) {
    if (token.added) {
      rightSegments.push({ text: token.value, tone: 'added' });
      continue;
    }

    if (token.removed) {
      leftSegments.push({ text: token.value, tone: 'removed' });
      continue;
    }

    leftSegments.push({ text: token.value, tone: 'base' });
    rightSegments.push({ text: token.value, tone: 'base' });
  }

  return { leftSegments, rightSegments };
}

function buildDiffRows(originalContent: string, currentContent: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const lineDiff = diffLines(originalContent, currentContent);
  let leftLine = 1;
  let rightLine = 1;

  for (let index = 0; index < lineDiff.length; index += 1) {
    const change = lineDiff[index];
    if (!change) {
      continue;
    }

    if (!change.added && !change.removed) {
      const contextLines = splitDiffLines(change.value);
      if (contextLines.length > 8) {
        const leading = contextLines.slice(0, 3);
        const trailing = contextLines.slice(-3);
        for (const line of leading) {
          rows.push({
            kind: 'context',
            leftLine,
            rightLine,
            leftSegments: [{ text: line, tone: 'base' }],
            rightSegments: [{ text: line, tone: 'base' }],
          });
          leftLine += 1;
          rightLine += 1;
        }

        rows.push({ kind: 'collapsed', hiddenCount: contextLines.length - leading.length - trailing.length });
        leftLine += contextLines.length - leading.length - trailing.length;
        rightLine += contextLines.length - leading.length - trailing.length;

        for (const line of trailing) {
          rows.push({
            kind: 'context',
            leftLine,
            rightLine,
            leftSegments: [{ text: line, tone: 'base' }],
            rightSegments: [{ text: line, tone: 'base' }],
          });
          leftLine += 1;
          rightLine += 1;
        }
        continue;
      }

      for (const line of contextLines) {
        rows.push({
          kind: 'context',
          leftLine,
          rightLine,
          leftSegments: [{ text: line, tone: 'base' }],
          rightSegments: [{ text: line, tone: 'base' }],
        });
        leftLine += 1;
        rightLine += 1;
      }
      continue;
    }

    if (change.removed && lineDiff[index + 1]?.added) {
      const removed = splitDiffLines(change.value);
      const added = splitDiffLines(lineDiff[index + 1]?.value ?? '');
      const rowCount = Math.max(removed.length, added.length);
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const beforeText = removed[rowIndex] ?? '';
        const afterText = added[rowIndex] ?? '';
        const wordSegments = buildWordSegments(beforeText, afterText);
        rows.push({
          kind: 'changed',
          leftLine: removed[rowIndex] !== undefined ? leftLine++ : null,
          rightLine: added[rowIndex] !== undefined ? rightLine++ : null,
          leftSegments: wordSegments.leftSegments,
          rightSegments: wordSegments.rightSegments,
        });
      }
      index += 1;
      continue;
    }

    if (change.removed) {
      for (const line of splitDiffLines(change.value)) {
        rows.push({
          kind: 'removed',
          leftLine,
          rightLine: null,
          leftSegments: [{ text: line, tone: 'removed' }],
          rightSegments: [],
        });
        leftLine += 1;
      }
      continue;
    }

    for (const line of splitDiffLines(change.value)) {
      rows.push({
        kind: 'added',
        leftLine: null,
        rightLine,
        leftSegments: [],
        rightSegments: [{ text: line, tone: 'added' }],
      });
      rightLine += 1;
    }
  }

  return rows;
}

function renderSegments(segments: DiffWordSegment[], emptyLabel: string): ReactNode {
  if (segments.length === 0) {
    return <span className="text-dim/55">{emptyLabel}</span>;
  }

  return segments.map((segment, index) => (
    <span
      key={`${segment.tone}-${index}-${segment.text}`}
      className={segment.tone === 'added'
        ? 'bg-teal/12 text-teal rounded px-0.5'
        : segment.tone === 'removed'
          ? 'bg-danger/12 text-danger rounded px-0.5'
          : undefined}
    >
      {segment.text}
    </span>
  ));
}

function diffSideTone(kind: DiffRow['kind'], side: 'left' | 'right'): string {
  switch (kind) {
    case 'removed':
      return side === 'left' ? 'bg-danger/6' : 'bg-transparent';
    case 'added':
      return side === 'right' ? 'bg-teal/6' : 'bg-transparent';
    case 'changed':
      return side === 'left' ? 'bg-danger/5' : 'bg-teal/5';
    default:
      return 'bg-transparent';
  }
}

export function WorkspaceWordDiffView({
  originalContent,
  currentContent,
}: {
  originalContent: string;
  currentContent: string;
}) {
  const rows = buildDiffRows(originalContent, currentContent);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface/30 overflow-hidden">
      <div className="grid grid-cols-[3rem,minmax(0,1fr),3rem,minmax(0,1fr)] border-b border-border-subtle bg-surface/70 text-[10px] uppercase tracking-[0.16em] text-dim">
        <div className="px-3 py-2 text-right">Old</div>
        <div className="px-3 py-2">Original</div>
        <div className="px-3 py-2 text-right">New</div>
        <div className="px-3 py-2">Current</div>
      </div>

      <div className="max-h-[24rem] overflow-auto">
        {rows.map((row, index) => {
          if (row.kind === 'collapsed') {
            return (
              <div key={`collapsed-${index}`} className="border-b border-border-subtle/70 bg-surface/20 px-3 py-2 text-center text-[11px] text-dim font-mono">
                … {row.hiddenCount} unchanged {row.hiddenCount === 1 ? 'line' : 'lines'} hidden …
              </div>
            );
          }

          return (
            <div
              key={`row-${index}-${row.leftLine ?? 'x'}-${row.rightLine ?? 'x'}`}
              className="grid grid-cols-[3rem,minmax(0,1fr),3rem,minmax(0,1fr)] border-b border-border-subtle/70 text-[12px] leading-6 font-mono"
            >
              <div className={[
                'border-r border-border-subtle/60 px-3 py-1 text-right text-dim/80 select-none',
                diffSideTone(row.kind, 'left'),
              ].join(' ')}>
                {row.leftLine ?? ''}
              </div>
              <div className={[
                'border-r border-border-subtle/60 px-3 py-1 text-secondary whitespace-pre-wrap break-words',
                diffSideTone(row.kind, 'left'),
              ].join(' ')}>
                {renderSegments(row.leftSegments, row.kind === 'added' ? '∅' : '')}
              </div>
              <div className={[
                'border-r border-border-subtle/60 px-3 py-1 text-right text-dim/80 select-none',
                diffSideTone(row.kind, 'right'),
              ].join(' ')}>
                {row.rightLine ?? ''}
              </div>
              <div className={[
                'px-3 py-1 text-secondary whitespace-pre-wrap break-words',
                diffSideTone(row.kind, 'right'),
              ].join(' ')}>
                {renderSegments(row.rightSegments, row.kind === 'removed' ? '∅' : '')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

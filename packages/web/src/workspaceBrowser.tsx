import type { ReactNode } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';
import { diffLines, diffWordsWithSpace } from 'diff';
import type { WorkspaceChangeKind, WorkspaceTreeNode } from './types';

export const WORKSPACE_CWD_SEARCH_PARAM = 'cwd';
export const WORKSPACE_FILE_SEARCH_PARAM = 'file';

const TREE_ROW_CLASS = 'group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] leading-5 transition-colors';
const TREE_ROW_IDLE_CLASS = 'text-secondary hover:bg-surface/80 hover:text-primary';
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

export function countVisibleTreeFiles(nodes: WorkspaceTreeNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.kind === 'file') {
      return count + 1;
    }

    return count + countVisibleTreeFiles(node.children ?? []);
  }, 0);
}

export function collectDirectoryPaths(nodes: WorkspaceTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind !== 'directory') {
      return [];
    }

    return [node.relativePath, ...collectDirectoryPaths(node.children ?? [])];
  });
}

function countChangedDescendants(node: WorkspaceTreeNode): number {
  if (node.kind === 'file') {
    return node.change ? 1 : 0;
  }

  return (node.children ?? []).reduce((count, child) => count + countChangedDescendants(child), 0);
}

export function editorChromeTheme(isDark: boolean): Extension {
  const highlightTheme = HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier], color: isDark ? 'rgb(224 152 48)' : 'rgb(149 90 16)' },
    { tag: [tags.atom, tags.bool, tags.number, tags.integer, tags.float], color: isDark ? 'rgb(91 144 204)' : 'rgb(30 90 150)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: isDark ? 'rgb(61 168 168)' : 'rgb(26 120 120)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'rgb(var(--color-dim))', fontStyle: 'italic' },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)], color: isDark ? 'rgb(242 239 232)' : 'rgb(28 26 20)' },
    { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'rgb(var(--color-primary))' },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.labelName], color: isDark ? 'rgb(242 239 232)' : 'rgb(28 26 20)' },
    { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'rgb(var(--color-secondary))' },
    { tag: [tags.meta, tags.docString], color: 'rgb(var(--color-dim))' },
    { tag: tags.invalid, color: 'rgb(var(--color-danger))' },
  ]);

  return [
    EditorView.theme({
      '&': {
        height: '100%',
        color: 'rgb(var(--color-primary))',
        backgroundColor: 'rgb(var(--color-panel))',
        fontSize: '12px',
        fontWeight: '400',
      },
      '.cm-scroller': {
        fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
        lineHeight: '1.65',
        fontWeight: '400',
        backgroundColor: 'rgb(var(--color-panel))',
      },
      '.cm-content': {
        minHeight: '100%',
        padding: '14px 16px',
        caretColor: 'rgb(var(--color-accent))',
      },
      '.cm-gutters': {
        minHeight: '100%',
        border: 'none',
        borderRight: '1px solid rgb(var(--color-border-subtle))',
        backgroundColor: isDark ? 'rgb(60 57 51)' : 'rgb(237 233 226)',
        color: 'rgb(var(--color-dim))',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 6px',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.09)' : 'rgb(149 90 16 / 0.055)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.18)' : 'rgb(149 90 16 / 0.13)',
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'rgb(var(--color-accent))',
        borderLeftWidth: '2px',
      },
      '.cm-tooltip, .cm-panels, .cm-completionInfo': {
        backgroundColor: 'rgb(var(--color-surface))',
        borderColor: 'rgb(var(--color-border-default))',
        color: 'rgb(var(--color-primary))',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.12)' : 'rgb(149 90 16 / 0.08)',
        color: 'rgb(var(--color-primary))',
      },
      '.cm-searchMatch': {
        backgroundColor: isDark ? 'rgb(224 152 48 / 0.14)' : 'rgb(149 90 16 / 0.10)',
        outline: '1px solid rgb(var(--color-border-default))',
      },
      '.cm-matchingBracket, .cm-nonmatchingBracket': {
        backgroundColor: isDark ? 'rgb(91 144 204 / 0.12)' : 'rgb(30 90 150 / 0.10)',
        outline: '1px solid rgb(var(--color-border-subtle))',
      },
    }, { dark: isDark }),
    syntaxHighlighting(highlightTheme),
  ];
}

function TreeChevron({ expanded }: { expanded: boolean }) {
  return <span className="w-3 shrink-0 text-center text-dim">{expanded ? '▾' : '▸'}</span>;
}

function FolderTreeIcon({ open }: { open: boolean }) {
  return (
    <svg className={[ 'h-3 w-3 shrink-0', open ? 'text-accent' : 'text-dim' ].join(' ')} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.75 5.75a1.25 1.25 0 0 1 1.25-1.25h3.18a1.25 1.25 0 0 1 .88.36l.96.97a1.25 1.25 0 0 0 .88.36h5.1a1.25 1.25 0 0 1 1.25 1.25v6.75a1.25 1.25 0 0 1-1.25 1.25H4a1.25 1.25 0 0 1-1.25-1.25V5.75Z" />
      <path d="M2.75 7.5h13.5" />
    </svg>
  );
}

function FileTreeIcon({ deleted }: { deleted: boolean }) {
  return (
    <svg className={[ 'h-3 w-3 shrink-0', deleted ? 'text-danger' : 'text-secondary' ].join(' ')} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2.75h5.25L15.5 7v10.25A1.25 1.25 0 0 1 14.25 18.5h-8.5A1.25 1.25 0 0 1 4.5 17.25V4A1.25 1.25 0 0 1 5.75 2.75H6Z" />
      <path d="M11.25 2.75V7h4.25" />
    </svg>
  );
}

export function TreeRowChange({ change }: { change: WorkspaceChangeKind | null }) {
  if (!change) {
    return <span className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }

  return (
    <span className="h-4 w-4 shrink-0 text-center" title={changeLabel(change)}>
      <span className={[
        'inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold',
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
}: {
  nodes: WorkspaceTreeNode[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="space-y-px">
      {nodes.map((node) => {
        const isSelected = node.kind === 'file' && node.relativePath === selectedPath;
        const isExpanded = node.kind === 'directory' && expandedPaths.has(node.relativePath);
        const rowClassName = [
          TREE_ROW_CLASS,
          isSelected ? TREE_ROW_ACTIVE_CLASS : TREE_ROW_IDLE_CLASS,
          !node.exists && 'opacity-70',
        ].filter(Boolean).join(' ');

        if (node.kind === 'directory') {
          const changedChildren = countChangedDescendants(node);
          return (
            <div key={node.relativePath || node.name}>
              <button
                type="button"
                className={rowClassName}
                onClick={() => onToggle(node.relativePath)}
                title={node.path}
              >
                <TreeChevron expanded={isExpanded} />
                <FolderTreeIcon open={isExpanded} />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                {changedChildren > 0 && (
                  <span className="shrink-0 rounded bg-warning/10 px-1 py-0.5 text-[10px] font-semibold text-warning">
                    {changedChildren}
                  </span>
                )}
              </button>

              {isExpanded && (node.children?.length ?? 0) > 0 && (
                <div className="ml-2.5 border-l border-border-subtle/70 pl-1.5">
                  <WorkspaceTreeView
                    nodes={node.children ?? []}
                    selectedPath={selectedPath}
                    expandedPaths={expandedPaths}
                    onToggle={onToggle}
                    onSelect={onSelect}
                  />
                </div>
              )}
            </div>
          );
        }

        return (
          <button
            key={node.relativePath || node.name}
            type="button"
            className={rowClassName}
            onClick={() => onSelect(node.relativePath)}
            title={node.path}
          >
            <span className="w-3 shrink-0" aria-hidden="true" />
            <FileTreeIcon deleted={!node.exists} />
            <span className={[
              'min-w-0 flex-1 truncate',
              !node.exists && 'line-through',
            ].filter(Boolean).join(' ')}>
              {node.name}
            </span>
            <TreeRowChange change={node.change} />
          </button>
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

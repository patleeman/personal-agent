import { type ComponentProps, type ReactNode, useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, lineNumbers } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { buildMentionLookup, renderChildrenWithMentionLinks } from '../mentionRendering';
import { useNodeMentionItems } from '../useNodeMentionItems';
import { editorChromeTheme, languageExtensionForPath } from '../workspaceBrowser';
import { useTheme } from '../theme';
import { InlineMarkdownCode } from './MarkdownInlineCode';
import { ToolbarButton, cx } from './ui';

export interface NodeWorkspaceTab {
  id: string;
  label: ReactNode;
  to?: string;
  selected?: boolean;
  onSelect?: () => void;
}

export type MarkdownDocumentMode = 'edit' | 'preview' | 'split';

function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return (match?.[1] ?? normalized).replace(/^\n+/, '');
}

function TabButton({ tab }: { tab: NodeWorkspaceTab }) {
  const className = tab.selected ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button';

  if (tab.to) {
    return <Link to={tab.to} className={className}>{tab.label}</Link>;
  }

  return (
    <button type="button" onClick={tab.onSelect} className={className}>
      {tab.label}
    </button>
  );
}

export function NodeWorkspaceShell({
  eyebrow,
  title,
  summary,
  meta,
  resourceTabs,
  modeTabs,
  actions,
  notice,
  children,
  inspector,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  meta?: ReactNode;
  resourceTabs?: NodeWorkspaceTab[];
  modeTabs?: NodeWorkspaceTab[];
  actions?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-base/70 shadow-sm">
      <div className="shrink-0 border-b border-border-subtle px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            {eyebrow && <p className="ui-section-label">{eyebrow}</p>}
            <div className="space-y-1">
              <h2 className="break-words text-[22px] font-semibold tracking-tight text-primary">{title}</h2>
              {summary && <p className="max-w-3xl text-[13px] leading-relaxed text-secondary">{summary}</p>}
            </div>
            {meta && <div className="ui-card-meta flex flex-wrap items-center gap-1.5">{meta}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>

        {(resourceTabs || modeTabs || notice) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {resourceTabs ? (
              <div className="ui-segmented-control" role="tablist" aria-label="Node resources">
                {resourceTabs.map((tab) => <TabButton key={tab.id} tab={tab} />)}
              </div>
            ) : <div />}
            {modeTabs ? (
              <div className="ui-segmented-control" role="tablist" aria-label="Document mode">
                {modeTabs.map((tab) => <TabButton key={tab.id} tab={tab} />)}
              </div>
            ) : null}
          </div>
        )}

        {notice && <div className="mt-3">{notice}</div>}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

      {inspector && (
        <div className="shrink-0 border-t border-border-subtle bg-surface/25 px-4 py-4">
          <div className="space-y-4">{inspector}</div>
        </div>
      )}
    </div>
  );
}

export function NodeInspectorSection({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-section-label">{title}</p>
        {meta ? <div className="ui-card-meta">{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function NodeMetadataList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">{item.label}</p>
          <div className="text-[13px] leading-relaxed text-secondary">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function RenderedMarkdownDocument({
  content,
  emptyText = 'Nothing to preview yet.',
  className,
}: {
  content: string;
  emptyText?: string;
  className?: string;
}) {
  const footnoteId = useId();
  const footnotePrefix = `node-doc-${footnoteId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-`;
  const body = stripFrontmatter(content).trim();
  const { data: mentionItems } = useNodeMentionItems();
  const mentionLookup = useMemo(() => buildMentionLookup(mentionItems ?? []), [mentionItems]);

  if (body.length === 0) {
    return <p className="text-[13px] text-dim">{emptyText}</p>;
  }

  return (
    <div className={cx('ui-markdown max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        components={{
          code: ({ className: codeClassName, children }) => <InlineMarkdownCode className={codeClassName}>{children}</InlineMarkdownCode>,
          h1: ({ children, node: _node, ...props }) => <h1 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</h1>,
          h2: ({ children, node: _node, ...props }) => <h2 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</h2>,
          h3: ({ children, node: _node, ...props }) => <h3 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</h3>,
          h4: ({ children, node: _node, ...props }) => <h4 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</h4>,
          h5: ({ children, node: _node, ...props }) => <h5 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</h5>,
          h6: ({ children, node: _node, ...props }) => <h6 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</h6>,
          p: ({ children, node: _node, ...props }) => <p {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</p>,
          li: ({ children, node: _node, ...props }) => <li {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</li>,
          th: ({ children, node: _node, ...props }) => <th {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</th>,
          td: ({ children, node: _node, ...props }) => <td {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'main' })}</td>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownDocumentSurface({
  value,
  path,
  mode,
  onChange,
  readOnly = false,
  emptyPreviewText,
}: {
  value: string;
  path: string;
  mode: MarkdownDocumentMode;
  onChange: (nextValue: string) => void;
  readOnly?: boolean;
  emptyPreviewText?: string;
}) {
  const { theme } = useTheme();
  const editorExtensions = useMemo(() => {
    const extensions: Extension[] = [editorChromeTheme(theme === 'dark'), EditorView.lineWrapping, lineNumbers()];
    const languageExtension = languageExtensionForPath(path);
    if (languageExtension) {
      extensions.push(languageExtension);
    }
    return extensions;
  }, [path, theme]);

  const editor = (
    <div className="h-full bg-panel">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={editorExtensions}
        editable={!readOnly}
        readOnly={readOnly}
        className="h-full"
      />
    </div>
  );

  const preview = (
    <div className="h-full overflow-y-auto bg-surface/15 px-5 py-5">
      <div className="ui-note-document min-h-full">
        <RenderedMarkdownDocument content={value} emptyText={emptyPreviewText} />
      </div>
    </div>
  );

  if (mode === 'preview') {
    return preview;
  }

  if (mode === 'split') {
    return (
      <div className="grid h-full min-h-0 grid-cols-1 divide-y divide-border-subtle lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="min-h-[18rem] lg:min-h-0">{editor}</div>
        <div className="min-h-[18rem] lg:min-h-0">{preview}</div>
      </div>
    );
  }

  return editor;
}

export function MarkdownDocumentModeTabs({
  mode,
  onModeChange,
}: {
  mode: MarkdownDocumentMode;
  onModeChange: (mode: MarkdownDocumentMode) => void;
}) {
  const tabs: NodeWorkspaceTab[] = [
    { id: 'edit', label: 'Edit', selected: mode === 'edit', onSelect: () => onModeChange('edit') },
    { id: 'preview', label: 'Preview', selected: mode === 'preview', onSelect: () => onModeChange('preview') },
    { id: 'split', label: 'Split', selected: mode === 'split', onSelect: () => onModeChange('split') },
  ];

  return (
    <div className="ui-segmented-control" role="tablist" aria-label="Document mode">
      {tabs.map((tab) => <TabButton key={tab.id} tab={tab} />)}
    </div>
  );
}

export function WorkspaceActionNotice({
  tone,
  children,
}: {
  tone: 'accent' | 'danger' | 'warning';
  children: ReactNode;
}) {
  const className = tone === 'danger'
    ? 'text-[12px] text-danger'
    : tone === 'warning'
      ? 'text-[12px] text-warning'
      : 'text-[12px] text-accent';
  return <p className={className}>{children}</p>;
}

export function NodePrimaryToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function NodeActionButton({ children, ...props }: ComponentProps<typeof ToolbarButton>) {
  return <ToolbarButton {...props}>{children}</ToolbarButton>;
}

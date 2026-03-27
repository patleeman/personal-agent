import { useId, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import type { NodeMentionSurface } from '../../nodeMentionRoutes';
import { buildMentionLookup, renderChildrenWithMentionLinks } from '../../mentionRendering';
import { useNodeMentionItems } from '../../useNodeMentionItems';
import { InlineMarkdownCode } from '../MarkdownInlineCode';
import { cx } from '../ui';
import { parseFieldsBlockItems, type FieldsBlockItem } from '../../editorExtensions/FieldsBlockExtension';
import { stripMarkdownFrontmatter } from '../../markdownDocument';

function stringifyDirectiveText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  if ('type' in node && node.type === 'text') {
    return typeof (node as { value?: unknown }).value === 'string' ? (node as { value: string }).value : '';
  }

  if ('type' in node && (node.type === 'break' || node.type === 'thematicBreak')) {
    return '\n';
  }

  if ('type' in node && node.type === 'paragraph') {
    const children = Array.isArray((node as { children?: unknown }).children) ? (node as { children: unknown[] }).children : [];
    return children.map((child) => stringifyDirectiveText(child)).join('');
  }

  const children = Array.isArray((node as { children?: unknown }).children) ? (node as { children: unknown[] }).children : [];
  return children.map((child) => stringifyDirectiveText(child)).join('');
}

function fieldsDirectivePlugin() {
  return (tree: unknown) => {
    function visit(node: unknown): void {
      if (!node || typeof node !== 'object') {
        return;
      }

      const record = node as {
        type?: string;
        name?: string;
        children?: unknown[];
        data?: Record<string, unknown>;
      };

      if (record.type === 'containerDirective' && record.name === 'fields') {
        const rawValue = (record.children ?? [])
          .map((child) => stringifyDirectiveText(child))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        const items = parseFieldsBlockItems(rawValue);
        record.data = {
          ...(record.data ?? {}),
          hName: 'div',
          hProperties: {
            'data-rich-fields-block': 'true',
            'data-rich-fields-items': JSON.stringify(items),
          },
        };
        record.children = [];
        return;
      }

      for (const child of record.children ?? []) {
        visit(child);
      }
    }

    visit(tree);
  };
}

function normalizeFieldsBlockValue(value: unknown): FieldsBlockItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const key = typeof (item as { key?: unknown }).key === 'string' ? (item as { key: string }).key.trim() : '';
    const fieldValue = typeof (item as { value?: unknown }).value === 'string' ? (item as { value: string }).value.trim() : '';
    if (key.length === 0 && fieldValue.length === 0) {
      return [];
    }

    return [{ key, value: fieldValue } satisfies FieldsBlockItem];
  });
}

function FieldsBlockPreview({ items }: { items: FieldsBlockItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="ui-rich-fields-block">
      <div className="ui-rich-fields-block-header">
        <p className="ui-section-label">Fields</p>
      </div>
      <div className="ui-rich-fields-grid">
        {items.map((item, index) => (
          <div key={`${index}:${item.key}`} className="ui-rich-fields-row">
            <span className="ui-rich-fields-key">{item.key}</span>
            <span className="ui-rich-fields-value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RichMarkdownRenderer({
  content,
  emptyText = 'Nothing to show yet.',
  className,
  surface = 'main',
  stripFrontmatter = false,
}: {
  content: string;
  emptyText?: string;
  className?: string;
  surface?: NodeMentionSurface;
  stripFrontmatter?: boolean;
}) {
  const footnoteId = useId();
  const footnotePrefix = `rich-doc-${footnoteId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-`;
  const { data: mentionItems } = useNodeMentionItems();
  const mentionLookup = useMemo(() => buildMentionLookup(mentionItems ?? []), [mentionItems]);
  const body = useMemo(() => {
    const normalized = stripFrontmatter ? stripMarkdownFrontmatter(content) : content;
    return normalized.trim();
  }, [content, stripFrontmatter]);

  if (body.length === 0) {
    return <p className="text-[13px] text-dim">{emptyText}</p>;
  }

  return (
    <div className={cx('ui-markdown max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkDirective, fieldsDirectivePlugin, remarkGfm, remarkBreaks]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        components={{
          code: ({ className: codeClassName, children }) => <InlineMarkdownCode className={codeClassName}>{children}</InlineMarkdownCode>,
          h1: ({ children, node: _node, ...props }) => <h1 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</h1>,
          h2: ({ children, node: _node, ...props }) => <h2 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</h2>,
          h3: ({ children, node: _node, ...props }) => <h3 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</h3>,
          h4: ({ children, node: _node, ...props }) => <h4 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</h4>,
          h5: ({ children, node: _node, ...props }) => <h5 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</h5>,
          h6: ({ children, node: _node, ...props }) => <h6 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</h6>,
          p: ({ children, node: _node, ...props }) => <p {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</p>,
          li: ({ children, node: _node, ...props }) => <li {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</li>,
          th: ({ children, node: _node, ...props }) => <th {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</th>,
          td: ({ children, node: _node, ...props }) => <td {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface })}</td>,
          div: ({ children, node: _node, ...props }) => {
            const fieldItemsValue = typeof props['data-rich-fields-items'] === 'string' ? props['data-rich-fields-items'] : null;
            const isFieldsBlock = props['data-rich-fields-block'] === 'true';
            if (isFieldsBlock && fieldItemsValue) {
              let items: FieldsBlockItem[] = [];
              try {
                items = normalizeFieldsBlockValue(JSON.parse(fieldItemsValue));
              } catch {
                items = [];
              }

              return <FieldsBlockPreview items={items} />;
            }

            return <div {...props}>{children as ReactNode}</div>;
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

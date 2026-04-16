import { useId, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { NodeMentionSurface } from '../../knowledge/nodeMentionRoutes';
import { buildMentionLookup, renderChildrenWithMentionLinks } from '../../knowledge/mentionRendering';
import { useNodeMentionItems } from '../../hooks';
import { InlineMarkdownCode } from '../MarkdownInlineCode';
import { cx } from '../ui';
import { stripMarkdownFrontmatter } from '../../knowledge/markdownDocument';

function allowInlineImageDataUrls(url: string, key: string): string {
  if (key === 'src' && /^data:image\//i.test(url)) {
    return url;
  }

  return defaultUrlTransform(url);
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
        remarkPlugins={[remarkGfm, remarkBreaks]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        urlTransform={allowInlineImageDataUrls}
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
          div: ({ children, node: _node, ...props }) => <div {...props}>{children as ReactNode}</div>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

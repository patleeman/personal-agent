import { useId, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { InlineMarkdownCode } from '../components/MarkdownInlineCode';
import { buildMentionLookup, renderChildrenWithMentionLinks } from '../mentionRendering';
import { useNodeMentionItems } from '../useNodeMentionItems';

export function CompanionMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const footnoteId = useId();
  const footnotePrefix = `companion-${footnoteId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-`;
  const { data: mentionItems } = useNodeMentionItems();
  const mentionLookup = useMemo(() => buildMentionLookup(mentionItems ?? []), [mentionItems]);

  return (
    <div className={className ?? 'ui-markdown max-w-none text-[14px] leading-relaxed'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        components={{
          code: ({ className: codeClassName, children }) => <InlineMarkdownCode className={codeClassName}>{children}</InlineMarkdownCode>,
          h1: ({ children, node: _node, ...props }) => <h1 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</h1>,
          h2: ({ children, node: _node, ...props }) => <h2 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</h2>,
          h3: ({ children, node: _node, ...props }) => <h3 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</h3>,
          h4: ({ children, node: _node, ...props }) => <h4 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</h4>,
          h5: ({ children, node: _node, ...props }) => <h5 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</h5>,
          h6: ({ children, node: _node, ...props }) => <h6 {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</h6>,
          p: ({ children, node: _node, ...props }) => <p {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</p>,
          li: ({ children, node: _node, ...props }) => <li {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</li>,
          th: ({ children, node: _node, ...props }) => <th {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</th>,
          td: ({ children, node: _node, ...props }) => <td {...props}>{renderChildrenWithMentionLinks(children, { lookup: mentionLookup, surface: 'companion' })}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

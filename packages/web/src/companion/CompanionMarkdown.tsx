import { useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { InlineMarkdownCode } from '../components/MarkdownInlineCode';

export function CompanionMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const footnoteId = useId();
  const footnotePrefix = `companion-${footnoteId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-`;

  return (
    <div className={className ?? 'ui-markdown max-w-none text-[14px] leading-relaxed'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        components={{
          code: ({ className: codeClassName, children }) => <InlineMarkdownCode className={codeClassName}>{children}</InlineMarkdownCode>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

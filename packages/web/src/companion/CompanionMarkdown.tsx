import { RichMarkdownRenderer } from '../components/editor/RichMarkdownRenderer';

export function CompanionMarkdown({
  content,
  className,
  stripFrontmatter = false,
}: {
  content: string;
  className?: string;
  stripFrontmatter?: boolean;
}) {
  return (
    <RichMarkdownRenderer
      content={content}
      className={className ?? 'ui-markdown max-w-none text-[14px] leading-relaxed'}
      surface="companion"
      stripFrontmatter={stripFrontmatter}
    />
  );
}

import { Children, isValidElement, type ReactNode } from 'react';
import { FilePathButton, normalizeDetectedFilePath } from '../filePathLinks';

const DEFAULT_INLINE_CODE_CLASS = 'font-mono text-[0.82em] bg-elevated px-1 py-0.5 rounded text-accent';

export function extractMarkdownTextContent(children: ReactNode): string {
  let text = '';

  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint') {
      text += String(child);
      return;
    }

    if (!isValidElement(child)) {
      return;
    }

    const props = child.props as { children?: ReactNode };
    if (props.children !== undefined) {
      text += extractMarkdownTextContent(props.children);
    }
  });

  return text;
}

export function InlineMarkdownCode({
  className,
  children,
  inlineCodeClassName = DEFAULT_INLINE_CODE_CLASS,
  onOpenFilePath,
}: {
  className?: string;
  children?: ReactNode;
  inlineCodeClassName?: string;
  onOpenFilePath?: (path: string) => void;
}) {
  const content = extractMarkdownTextContent(children).replace(/\n$/, '');
  const isBlock = content.includes('\n') || Boolean(className?.includes('language-'));

  if (!isBlock) {
    const filePath = onOpenFilePath ? normalizeDetectedFilePath(content) : null;
    if (filePath && onOpenFilePath) {
      return <FilePathButton path={filePath} displayText={content} variant="code" onOpenFilePath={onOpenFilePath} />;
    }

    return <code className={inlineCodeClassName}>{content}</code>;
  }

  return <code className={className}>{content}</code>;
}

import { cx } from './ui';

const INLINE_CODE_CLASS = 'font-mono text-[0.82em] bg-elevated px-1 py-0.5 rounded text-accent';

export function LocalPathActions() {
  return null;
}

export function InlineLocalPath({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  return <code className={cx(INLINE_CODE_CLASS, className)}>{path}</code>;
}

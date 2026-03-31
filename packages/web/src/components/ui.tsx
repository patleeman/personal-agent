import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const PILL_TONE_CLASSES = {
  muted: 'ui-pill-muted',
  accent: 'ui-pill-accent',
  success: 'ui-pill-success',
  warning: 'ui-pill-warning',
  danger: 'ui-pill-danger',
  steel: 'ui-pill-steel',
  teal: 'ui-pill-teal',
  solidAccent: 'ui-pill-solid-accent',
} as const;

export type PillTone = keyof typeof PILL_TONE_CLASSES;

export function pillToneClass(tone: PillTone) {
  return PILL_TONE_CLASSES[tone];
}

export function PageHeader({
  children,
  actions,
  leading,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('ui-page-header', className)}>
      {leading && <div className="flex items-center shrink-0 pr-3">{leading}</div>}
      <div className="flex-1 min-w-0">{children}</div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function PageHeading({
  title,
  meta,
}: {
  title: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div>
      <h1 className="ui-page-title">{title}</h1>
      {meta && <div className="ui-page-meta">{meta}</div>}
    </div>
  );
}

export function ToolbarButton({
  className,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cx('ui-toolbar-button', className)} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  className,
  children,
  compact = false,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { compact?: boolean }) {
  return (
    <button
      type={type}
      className={cx('ui-icon-button', compact && 'ui-icon-button-compact', className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function Pill({
  tone = 'muted',
  mono = false,
  children,
  className,
  ...props
}: {
  tone?: PillTone;
  mono?: boolean;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('ui-pill', pillToneClass(tone), mono && 'font-mono', className)} {...props}>{children}</span>;
}

export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('ui-kbd', className)}>{children}</kbd>;
}

export function SurfacePanel({
  className,
  muted = false,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { muted?: boolean }) {
  return (
    <div className={cx(muted ? 'ui-panel-muted' : 'ui-panel', className)} {...props}>
      {children}
    </div>
  );
}

export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cx('ui-loading-state', className)}>
      <span className="animate-pulse">●</span>
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, className }: { message: string; className?: string }) {
  return <div className={cx('ui-error-state', className)}>{message}</div>;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('ui-empty-state', className)}>
      {icon && <div className="ui-empty-icon">{icon}</div>}
      <p className="ui-empty-title">{title}</p>
      {body && <div className="ui-empty-body">{body}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function SectionLabel({
  label,
  count,
  className,
}: {
  label: ReactNode;
  count?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <p className="ui-section-label">{label}</p>
      {count !== undefined && <span className="ui-section-count">{count}</span>}
    </div>
  );
}

function rowClass(selected: boolean | undefined, className?: string) {
  return cx('group', 'ui-list-row', selected ? 'ui-list-row-selected' : 'ui-list-row-hover', className);
}

interface BaseRowProps {
  selected?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function BrowserRecordRow({
  to,
  selected,
  label,
  aside,
  heading,
  summary,
  meta,
  className,
  headerClassName,
  titleClassName,
  summaryClassName,
  metaClassName,
  ...props
}: LinkProps & {
  selected?: boolean;
  label?: ReactNode;
  aside?: ReactNode;
  heading: ReactNode;
  summary?: ReactNode;
  meta?: ReactNode;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  summaryClassName?: string;
  metaClassName?: string;
}) {
  return (
    <Link
      to={to}
      className={cx('group', 'ui-browser-entry', selected ? 'ui-browser-entry-selected' : 'ui-browser-entry-hover', className)}
      {...props}
    >
      {(label || aside) && (
        <div className={cx('ui-browser-entry-header', headerClassName)}>
          {label ? <p className="ui-browser-entry-label">{label}</p> : null}
          {aside ? <p className="ui-browser-entry-aside">{aside}</p> : null}
        </div>
      )}
      <p className={cx('ui-browser-entry-title', titleClassName)}>{heading}</p>
      {summary ? <p className={cx('ui-browser-entry-summary', summaryClassName)}>{summary}</p> : null}
      {meta ? <div className={cx('ui-browser-entry-meta', metaClassName)}>{meta}</div> : null}
    </Link>
  );
}

export function ListLinkRow({
  to,
  selected,
  leading,
  trailing,
  className,
  children,
  ...props
}: BaseRowProps & LinkProps) {
  return (
    <Link to={to} className={rowClass(selected, className)} {...props}>
      {leading}
      <div className="flex-1 min-w-0">{children}</div>
      {trailing}
    </Link>
  );
}


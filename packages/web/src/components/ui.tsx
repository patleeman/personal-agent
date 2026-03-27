import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type SVGProps } from 'react';
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
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('ui-page-header', className)}>
      <div className="min-w-0">{children}</div>
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

export type ResourceGlyphKind = 'note' | 'project' | 'skill';

function GlyphSvg({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('h-4 w-4', className)}
      {...props}
    />
  );
}

export function ResourceGlyph({ kind, className }: { kind: ResourceGlyphKind; className?: string }) {
  return (
    <span className={cx('ui-browser-entry-glyph', className)} aria-hidden="true">
      {kind === 'note' ? (
        <GlyphSvg>
          <path d="M6.25 2.75h5.4L15.75 6.9v10.35a1 1 0 0 1-1 1H6.25a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
          <path d="M11.5 2.75V7h4.25" />
          <path d="M7.75 10.25h4.75" />
          <path d="M7.75 13.25h4.75" />
        </GlyphSvg>
      ) : kind === 'project' ? (
        <GlyphSvg>
          <rect x="3.25" y="4.25" width="13.5" height="11.5" rx="1.75" />
          <path d="M7.5 4.25v11.5" />
          <path d="M12.5 4.25v11.5" />
          <path d="M3.25 8.25h13.5" />
        </GlyphSvg>
      ) : (
        <GlyphSvg>
          <circle cx="6" cy="5.75" r="1.75" />
          <circle cx="14" cy="5.75" r="1.75" />
          <circle cx="14" cy="14.25" r="1.75" />
          <path d="M7.75 5.75h4.5" />
          <path d="M6 7.5v4.75c0 .97.78 1.75 1.75 1.75h4.5" />
        </GlyphSvg>
      )}
    </span>
  );
}

export function BrowserRecordRow({
  to,
  selected,
  icon,
  label,
  aside,
  heading,
  summary,
  meta,
  className,
  ...props
}: LinkProps & {
  selected?: boolean;
  icon: ReactNode;
  label?: ReactNode;
  aside?: ReactNode;
  heading: ReactNode;
  summary?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cx('group', 'ui-browser-entry', selected ? 'ui-browser-entry-selected' : 'ui-browser-entry-hover', className)}
      {...props}
    >
      {icon}
      <div className="min-w-0 flex-1">
        {(label || aside) && (
          <div className="ui-browser-entry-header">
            {label ? <p className="ui-browser-entry-label">{label}</p> : null}
            {aside ? <p className="ui-browser-entry-aside">{aside}</p> : null}
          </div>
        )}
        <p className="ui-browser-entry-title">{heading}</p>
        {summary ? <p className="ui-browser-entry-summary">{summary}</p> : null}
        {meta ? <div className="ui-browser-entry-meta">{meta}</div> : null}
      </div>
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

export function ListButtonRow({
  selected,
  leading,
  trailing,
  className,
  children,
  type = 'button',
  ...props
}: BaseRowProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cx('w-full text-left', rowClass(selected, className))} {...props}>
      {leading}
      <div className="flex-1 min-w-0">{children}</div>
      {trailing}
    </button>
  );
}

import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

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

type PillTone = keyof typeof PILL_TONE_CLASSES;

function pillToneClass(tone: PillTone) {
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

export interface AppPageTocItem<TId extends string = string> {
  id: TId;
  label: ReactNode;
  summary?: ReactNode;
}

export function AppPageLayout({
  children,
  aside,
  shellClassName,
  gridClassName,
  contentClassName,
  asideClassName,
}: {
  children: ReactNode;
  aside?: ReactNode;
  shellClassName?: string;
  gridClassName?: string;
  contentClassName?: string;
  asideClassName?: string;
}) {
  if (!aside) {
    return (
      <div className={cx('ui-app-page-shell', shellClassName)}>
        <div className={cx('ui-app-page-main', contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <div className={cx('ui-app-page-shell', shellClassName)}>
      <div className={cx('ui-app-page-grid', gridClassName)}>
        <div className={cx('ui-app-page-main', contentClassName)}>{children}</div>
        <div className={cx('ui-app-page-aside', asideClassName)}>{aside}</div>
      </div>
    </div>
  );
}

export function AppPageIntro({
  eyebrow,
  title,
  summary,
  actions,
  className,
  titleClassName,
  summaryClassName,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  summaryClassName?: string;
}) {
  return (
    <section className={cx('ui-app-page-intro', className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow ? <div className="ui-app-page-eyebrow">{eyebrow}</div> : null}
        <div className="space-y-1.5">
          <h1 className={cx('ui-app-page-title', titleClassName)}>{title}</h1>
          {summary ? <div className={cx('ui-app-page-summary', summaryClassName)}>{summary}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </section>
  );
}

export function AppPageSection({
  id,
  title,
  description,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={cx('ui-app-page-section', className)}>
      {title || description ? (
        <div className="space-y-2">
          {title ? <h2 className="text-[28px] font-semibold tracking-[-0.035em] text-primary sm:text-[30px]">{title}</h2> : null}
          {description ? <div className="max-w-3xl text-[13px] leading-6 text-secondary">{description}</div> : null}
        </div>
      ) : null}
      <div className={cx('ui-app-page-section-body', bodyClassName)}>{children}</div>
    </section>
  );
}

export function AppPageToc<TId extends string>({
  items,
  activeId,
  onNavigate,
  ariaLabel = 'Page sections',
  title = 'On this page',
}: {
  items: readonly AppPageTocItem<TId>[];
  activeId: TId;
  onNavigate: (sectionId: TId) => void;
  ariaLabel?: string;
  title?: ReactNode;
}) {
  return (
    <aside>
      <nav aria-label={ariaLabel} className="space-y-3">
        <div className="ui-app-page-toc-title">{title}</div>
        <div className="space-y-2">
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(item.id);
                }}
                className={cx('ui-app-page-toc-link', active && 'ui-app-page-toc-link-active')}
                aria-current={active ? 'location' : undefined}
              >
                <span className="block text-[13px] font-medium">{item.label}</span>
                {item.summary ? (
                  <span className={cx('mt-0.5 block text-[11px] leading-5', active ? 'text-primary/75' : 'text-dim')}>
                    {item.summary}
                  </span>
                ) : null}
              </a>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}

export function AppPageEmptyState({
  icon,
  title,
  body,
  action,
  align = 'center',
  className,
  contentClassName,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  align?: 'start' | 'center';
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      className={cx(
        'ui-app-page-empty-shell',
        align === 'start' ? 'ui-app-page-empty-shell-start' : 'ui-app-page-empty-shell-center',
        className,
      )}
    >
      <EmptyState
        icon={icon}
        title={title}
        body={body}
        action={action}
        className={cx('w-full max-w-[34rem]', contentClassName)}
      />
    </div>
  );
}



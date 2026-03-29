import { type ComponentProps, type ElementType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconButton, ToolbarButton, cx } from './ui';

export interface NodeWorkspaceTab {
  id: string;
  label: ReactNode;
  to?: string;
  selected?: boolean;
  onSelect?: () => void;
}

function TabButton({ tab }: { tab: NodeWorkspaceTab }) {
  const className = tab.selected ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button';

  if (tab.to) {
    return <Link to={tab.to} className={className}>{tab.label}</Link>;
  }

  return (
    <button type="button" onClick={tab.onSelect} className={className}>
      {tab.label}
    </button>
  );
}

export function NodeWorkspaceShell({
  eyebrow,
  breadcrumbs,
  backHref,
  backLabel = 'Back',
  title,
  titleAs: TitleTag = 'h1',
  summary,
  summaryClassName,
  meta,
  status,
  resourceTabs,
  actions,
  notice,
  children,
  inspector,
  compactTitle = false,
}: {
  eyebrow?: ReactNode;
  breadcrumbs?: ReactNode;
  backHref?: string;
  backLabel?: string;
  title: ReactNode;
  titleAs?: ElementType;
  summary?: ReactNode;
  summaryClassName?: string;
  meta?: ReactNode;
  status?: ReactNode;
  resourceTabs?: NodeWorkspaceTab[];
  actions?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  compactTitle?: boolean;
}) {
  const topRowContent = breadcrumbs ?? eyebrow;
  const hasTopRow = Boolean(backHref || topRowContent || status || actions);
  const mainContent = (
    <div className="min-w-0 space-y-6">
      <div className="ui-node-workspace-chrome border-b border-border-subtle pb-5">
        <div className="space-y-4">
          {hasTopRow ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {backHref ? (
                  <Link
                    to={backHref}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-base/40 text-secondary transition-colors hover:bg-surface hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
                    aria-label={backLabel}
                    title={backLabel}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15.25 18 8.75 12l6.5-6" />
                    </svg>
                  </Link>
                ) : null}
                {topRowContent ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-dim">
                    {topRowContent}
                  </div>
                ) : null}
              </div>

              {(status || actions) ? (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {status ? <div className="text-[11px]">{status}</div> : null}
                  {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="min-w-0 space-y-2">
            <TitleTag className={compactTitle ? 'break-words text-[15px] font-medium text-secondary' : 'break-words text-[32px] font-semibold tracking-tight text-primary'}>{title}</TitleTag>
            {summary ? <div className={cx('text-[15px] leading-relaxed text-secondary', summaryClassName ?? 'max-w-3xl')}>{summary}</div> : null}
            {meta ? <div className="ui-card-meta flex flex-wrap items-center gap-x-2 gap-y-1">{meta}</div> : null}
          </div>
        </div>

        {(resourceTabs || notice) ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {resourceTabs ? (
              <div className="ui-segmented-control" role="tablist" aria-label="Node resources">
                {resourceTabs.map((tab) => <TabButton key={tab.id} tab={tab} />)}
              </div>
            ) : <div />}
          </div>
        ) : null}

        {notice ? <div className="mt-3">{notice}</div> : null}
      </div>

      {children}
    </div>
  );

  if (!inspector) {
    return mainContent;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18.5rem]">
      {mainContent}
      <aside className="ui-node-workspace-chrome space-y-3 xl:sticky xl:top-4 xl:self-start">
        {inspector}
      </aside>
    </div>
  );
}

export function NodeMainSection({
  title,
  meta,
  action,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border-subtle pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-primary">{title}</h2>
          {meta ? <div className="mt-0.5 text-[12px] leading-relaxed text-secondary">{meta}</div> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function NodeRailSection({
  title,
  meta,
  action,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-primary">{title}</h3>
          {meta ? <div className="mt-0.5 text-[11px] leading-relaxed text-secondary">{meta}</div> : null}
        </div>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export function NodePropertyList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={typeof item.label === 'string' ? item.label : String(item.label)} className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.14em] text-dim">{item.label}</p>
          <div className="text-[13px] leading-relaxed text-primary">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function NodeInspectorSection({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-section-label">{title}</p>
        {meta ? <div className="ui-card-meta">{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function NodeMetadataList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">{item.label}</p>
          <div className="text-[13px] leading-relaxed text-secondary">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceActionNotice({
  tone,
  children,
}: {
  tone: 'accent' | 'danger' | 'warning';
  children: ReactNode;
}) {
  const className = tone === 'danger'
    ? 'text-[12px] text-danger'
    : tone === 'warning'
      ? 'text-[12px] text-warning'
      : 'text-[12px] text-accent';
  return <p className={className}>{children}</p>;
}

export function NodePrimaryToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function NodeToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-base/30 p-1">{children}</div>;
}

export function NodeActionButton({ children, ...props }: ComponentProps<typeof ToolbarButton>) {
  return <ToolbarButton {...props}>{children}</ToolbarButton>;
}

export function NodeIconActionButton({
  children,
  className,
  tone = 'default',
  ...props
}: ComponentProps<typeof IconButton> & { tone?: 'default' | 'accent' | 'danger' }) {
  return (
    <IconButton
      {...props}
      className={cx(
        'h-8 w-8 rounded-full border border-border-subtle bg-base/40 text-secondary transition-colors hover:bg-surface hover:text-primary disabled:cursor-default disabled:opacity-40',
        tone === 'accent' && 'border-accent/25 bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent',
        tone === 'danger' && 'text-danger hover:bg-danger/10 hover:text-danger',
        className,
      )}
    >
      {children}
    </IconButton>
  );
}

export function NodeWorkspaceBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-6 py-6', className)}>{children}</div>;
}

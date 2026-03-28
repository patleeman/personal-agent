import { type ComponentProps, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ToolbarButton, cx } from './ui';

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
  title,
  summary,
  meta,
  resourceTabs,
  actions,
  notice,
  children,
  inspector,
  compactTitle = false,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  meta?: ReactNode;
  resourceTabs?: NodeWorkspaceTab[];
  actions?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  compactTitle?: boolean;
}) {
  const mainContent = (
    <div className="min-w-0 space-y-6">
      <div className="border-b border-border-subtle pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            {eyebrow && <p className="ui-section-label">{eyebrow}</p>}
            <div className="space-y-1">
              <h2 className={compactTitle ? 'break-words text-[13px] font-medium text-secondary' : 'break-words text-[22px] font-semibold tracking-tight text-primary'}>{title}</h2>
              {summary && <p className="max-w-3xl text-[13px] leading-relaxed text-secondary">{summary}</p>}
            </div>
            {meta && <div className="ui-card-meta flex flex-wrap items-center gap-1.5">{meta}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>

        {(resourceTabs || notice) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {resourceTabs ? (
              <div className="ui-segmented-control" role="tablist" aria-label="Node resources">
                {resourceTabs.map((tab) => <TabButton key={tab.id} tab={tab} />)}
              </div>
            ) : <div />}
          </div>
        )}

        {notice && <div className="mt-3">{notice}</div>}
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
      <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        {inspector}
      </aside>
    </div>
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
          {meta ? <p className="mt-0.5 text-[11px] text-secondary">{meta}</p> : null}
        </div>
        {action}
      </div>
      {children}
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

export function NodeActionButton({ children, ...props }: ComponentProps<typeof ToolbarButton>) {
  return <ToolbarButton {...props}>{children}</ToolbarButton>;
}

export function NodeWorkspaceBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-6 py-6', className)}>{children}</div>;
}

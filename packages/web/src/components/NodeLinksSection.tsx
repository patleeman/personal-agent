import { Link } from 'react-router-dom';
import { buildNodeMentionHref, type NodeMentionSurface } from '../nodeMentionRoutes';
import type { NodeLinkSummary } from '../types';
import { Pill } from './ui';

function NodeLinkRow({ item, surface }: { item: NodeLinkSummary; surface: NodeMentionSurface }) {
  const href = buildNodeMentionHref({
    id: `@${item.id}`,
    label: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
  }, surface);

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-[13px] font-medium text-primary">{item.title}</p>
        <Pill tone="muted">{item.kind}</Pill>
      </div>
      <p className="mt-1 break-words text-[11px] font-mono text-accent">@{item.id}</p>
      {item.summary ? <p className="mt-1 text-[12px] leading-relaxed text-secondary">{item.summary}</p> : null}
    </>
  );

  if (!href) {
    return <div className="rounded-xl border border-border-subtle bg-base/65 px-3 py-3">{content}</div>;
  }

  return (
    <Link to={href} className="block rounded-xl border border-border-subtle bg-base/65 px-3 py-3 transition-colors hover:bg-base">
      {content}
    </Link>
  );
}

export function NodeLinkList({
  title,
  items,
  surface,
  emptyText,
}: {
  title: string;
  items: NodeLinkSummary[] | undefined;
  surface: NodeMentionSurface;
  emptyText: string;
}) {
  const normalized = items ?? [];

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">{title}</p>
      {normalized.length === 0 ? (
        <p className="text-[13px] text-dim">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {normalized.map((item) => (
            <NodeLinkRow key={`${item.kind}:${item.id}`} item={item} surface={surface} />
          ))}
        </div>
      )}
    </div>
  );
}

export function UnresolvedNodeLinks({ ids }: { ids: string[] | undefined }) {
  const unresolved = ids ?? [];
  if (unresolved.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Unresolved refs</p>
      <p className="text-[13px] leading-relaxed text-dim">
        {unresolved.map((id) => `@${id}`).join(' · ')}
      </p>
    </div>
  );
}

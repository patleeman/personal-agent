import type { SessionMeta } from '../shared/types';
import { buildConversationForkTree } from '../conversation/conversationForkTree';
import { cx } from './ui';

interface ConversationForkMapProps {
  currentId: string;
  sessions: SessionMeta[] | null;
  onOpenConversation: (conversationId: string) => void;
}

function formatForkMapTime(session: SessionMeta): string {
  const value = session.lastActivityAt ?? session.timestamp;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatForkMapMeta(session: SessionMeta): string {
  const parts = [
    session.messageCount === 1 ? '1 block' : `${session.messageCount} blocks`,
    formatForkMapTime(session),
  ].filter(Boolean);

  return parts.join(' · ');
}

export function ConversationForkMap({ currentId, sessions, onOpenConversation }: ConversationForkMapProps) {
  const tree = buildConversationForkTree(sessions, currentId);
  if (!tree) {
    return null;
  }

  return (
    <section className="mt-3 max-w-5xl" aria-label="Conversation forks">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-dim/80">
        <span>Fork map</span>
        <span className="h-px flex-1 bg-border-subtle/40" aria-hidden="true" />
        <span className="normal-case tracking-normal text-secondary/80">{tree.relatedCount + 1} branches</span>
      </div>
      <div className="overflow-x-auto py-1">
        <div className="flex min-w-max items-stretch gap-1.5">
          {tree.nodes.map((node, index) => {
            const isRoot = node.depth === 0;
            const isLeaf = node.childCount === 0;
            return (
              <button
                key={node.session.id}
                type="button"
                onClick={() => onOpenConversation(node.session.id)}
                disabled={node.isCurrent}
                title={node.session.title}
                className={cx(
                  'group relative flex min-w-[12rem] max-w-[18rem] items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                  node.isCurrent
                    ? 'cursor-default bg-accent/10 text-primary'
                    : 'text-secondary hover:bg-surface/70 hover:text-primary',
                )}
                style={{ marginLeft: index === 0 ? 0 : Math.max(0, node.depth - 1) * 16 }}
              >
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
                  {!isRoot && <span className="absolute -left-4 top-1/2 h-px w-4 bg-border-default/70" />}
                  {!isLeaf && <span className="absolute left-1/2 top-1/2 h-7 w-px bg-border-default/70" />}
                  <span className={cx(
                    'relative z-10 h-3 w-3 rounded-full border bg-base transition-colors',
                    node.isCurrent ? 'border-accent bg-accent' : node.isAncestor ? 'border-accent/70' : 'border-border-strong group-hover:border-accent/70',
                  )} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium">{node.session.title || 'Untitled conversation'}</span>
                    {node.session.isRunning && <span className="shrink-0 text-[10px] text-accent">running</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-dim">{formatForkMapMeta(node.session)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

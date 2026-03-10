import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../hooks';
import type { WorkstreamSummary } from '../types';
import { kindMeta, stripMarkdownListMarker, timeAgo } from '../utils';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-2xs font-semibold uppercase tracking-widest text-secondary mb-2">
      {children}
    </p>
  );
}

function PlanProgress({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-2xs text-dim font-mono">
        <span>{completed}/{total} steps</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-surface overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function WorkstreamCard({ ws }: { ws: WorkstreamSummary }) {
  const status = stripMarkdownListMarker(ws.status);
  const blockers = stripMarkdownListMarker(ws.blockers);
  const isBlocked = blockers !== 'None';

  return (
    <Link
      to={`/workstreams/${ws.id}`}
      className="block p-3 rounded-lg bg-surface border border-border-subtle hover:border-border-default hover:bg-elevated transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-2xs font-mono text-dim truncate">{ws.id}</span>
        <span className="text-2xs text-dim shrink-0">{timeAgo(ws.updatedAt)}</span>
      </div>
      <p className="text-xs text-primary font-medium leading-snug line-clamp-2 mb-2">
        {ws.objective}
      </p>
      <p className="text-2xs text-secondary leading-snug">{status}</p>
      {isBlocked && (
        <p className="mt-1 text-2xs text-warning">⚠ {blockers}</p>
      )}
    </Link>
  );
}

export function ContextRail() {
  const { data: workstreams } = usePolling(api.workstreams, 15_000);
  const { data: activity } = usePolling(api.activity, 15_000);

  const topWorkstreams = workstreams?.slice(0, 3) ?? [];
  const recentActivity = activity?.slice(0, 5) ?? [];

  return (
    <aside className="flex-1 min-w-0 flex flex-col h-full bg-panel overflow-y-auto">
      <div className="flex-1 px-5 pt-5 space-y-5">
        {/* Workstreams section */}
        <section>
          <SectionLabel>Workstreams</SectionLabel>
          {topWorkstreams.length === 0 ? (
            <p className="text-xs text-secondary">No workstreams yet.</p>
          ) : (
            <div className="space-y-2">
              {topWorkstreams.map((ws) => (
                <WorkstreamCard key={ws.id} ws={ws} />
              ))}
            </div>
          )}
          {(workstreams?.length ?? 0) > 3 && (
            <Link
              to="/workstreams"
              className="mt-2 block text-2xs text-accent hover:text-accent/80 transition-colors"
            >
              View all {workstreams!.length} workstreams →
            </Link>
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-border-subtle" />

        {/* Recent activity section */}
        <section>
          <SectionLabel>Activity</SectionLabel>
          {recentActivity.length === 0 ? (
            <p className="text-xs text-secondary">No activity yet.</p>
          ) : (
            <div className="space-y-1">
              {recentActivity.map((entry) => {
                const meta = kindMeta(entry.kind);
                return (
                  <Link
                    key={entry.id}
                    to={`/inbox/${entry.id}`}
                    className="flex items-start gap-2.5 px-2 py-2 -mx-2 rounded-md hover:bg-surface transition-colors group"
                  >
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-secondary group-hover:text-primary truncate leading-tight">
                        {entry.summary}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-2xs px-1.5 py-px rounded ${meta.color}`}>
                          {meta.label}
                        </span>
                        <span className="text-2xs text-dim font-mono">
                          {timeAgo(entry.createdAt)}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          {(activity?.length ?? 0) > 5 && (
            <Link
              to="/inbox"
              className="mt-2 block text-2xs text-accent hover:text-accent/80 transition-colors"
            >
              View all {activity!.length} items →
            </Link>
          )}
        </section>

        {/* Placeholder for artifact previews */}
        <section>
          <SectionLabel>Artifacts</SectionLabel>
          <p className="text-xs text-secondary">Coming soon.</p>
        </section>
      </div>
    </aside>
  );
}

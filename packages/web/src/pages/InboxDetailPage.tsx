import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { formatDate, kindMeta } from '../utils';

export function InboxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: entry, loading, error } = useApi(() => api.activityById(id!));

  if (loading) {
    return (
      <div className="px-6 py-8 text-sm text-dim flex items-center gap-2">
        <span className="animate-pulse">●</span>
        <span>Loading…</span>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="px-6 py-8">
        <Link to="/inbox" className="text-xs text-accent hover:underline">
          ← Back to inbox
        </Link>
        <p className="mt-4 text-sm text-danger/80">{error ?? 'Activity not found.'}</p>
      </div>
    );
  }

  const meta = kindMeta(entry.kind);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4">
        <Link to="/inbox" className="text-xs text-accent hover:underline">
          ← Inbox
        </Link>
        <div className="flex items-center gap-3 mt-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${meta.color}`}>
            {meta.label}
          </span>
          <span className="text-xs text-dim font-mono">{formatDate(entry.createdAt)}</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-6 py-6 space-y-6 max-w-2xl">
        {/* Summary */}
        <section>
          <p className="text-lg font-medium text-primary leading-snug">{entry.summary}</p>
        </section>

        {/* Details */}
        {entry.details && (
          <section>
            <p className="text-2xs font-semibold uppercase tracking-widest text-dim mb-2">
              Details
            </p>
            <div className="bg-surface border border-border-subtle rounded-lg px-4 py-3">
              <p className="text-sm text-secondary leading-relaxed whitespace-pre-wrap font-mono text-xs">
                {entry.details}
              </p>
            </div>
          </section>
        )}

        {/* Related workstreams */}
        {entry.relatedWorkstreamIds && entry.relatedWorkstreamIds.length > 0 && (
          <section>
            <p className="text-2xs font-semibold uppercase tracking-widest text-dim mb-2">
              Related workstreams
            </p>
            <div className="flex flex-wrap gap-2">
              {entry.relatedWorkstreamIds.map((wsId) => (
                <Link
                  key={wsId}
                  to={`/workstreams/${wsId}`}
                  className="text-xs font-mono px-2 py-1 rounded bg-accent-bg text-accent hover:bg-accent/20 transition-colors"
                >
                  {wsId}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Metadata */}
        <section className="border-t border-border-subtle pt-4">
          <p className="text-2xs font-semibold uppercase tracking-widest text-dim mb-3">
            Metadata
          </p>
          <dl className="space-y-2">
            {[
              { label: 'ID', value: entry.id },
              { label: 'Profile', value: entry.profile },
              { label: 'Kind', value: entry.kind },
              { label: 'Created', value: formatDate(entry.createdAt) },
              ...(entry.notificationState
                ? [{ label: 'Notification', value: entry.notificationState }]
                : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex items-baseline gap-4">
                <dt className="text-2xs text-dim w-24 shrink-0">{label}</dt>
                <dd className="text-xs text-secondary font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

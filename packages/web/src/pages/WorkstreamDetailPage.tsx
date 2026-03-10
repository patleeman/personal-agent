import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { formatDate, stripMarkdownListMarker } from '../utils';

function PlanChecklist({ steps }: { steps: { text: string; completed: boolean }[] }) {
  const completed = steps.filter((s) => s.completed).length;
  const pct = steps.length === 0 ? 0 : Math.round((completed / steps.length) * 100);

  return (
    <div className="space-y-3">
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-dim font-mono mb-1">
        <span>{completed}/{steps.length} complete</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-surface overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps */}
      <ul className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 text-2xs ${
                step.completed
                  ? 'border-success/50 bg-success/10 text-success'
                  : 'border-border-default text-transparent'
              }`}
            >
              ✓
            </span>
            <span
              className={`text-sm leading-snug ${
                step.completed ? 'text-dim line-through' : 'text-secondary'
              }`}
            >
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WorkstreamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useApi(() => api.workstreamById(id!));

  if (loading) {
    return (
      <div className="px-6 py-8 text-sm text-dim flex items-center gap-2">
        <span className="animate-pulse">●</span>
        <span>Loading…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-6 py-8">
        <Link to="/workstreams" className="text-xs text-accent hover:underline">
          ← Back to workstreams
        </Link>
        <p className="mt-4 text-sm text-danger/80">{error ?? 'Workstream not found.'}</p>
      </div>
    );
  }

  const { summary, plan, taskCount, artifactCount } = data;
  const status = stripMarkdownListMarker(summary.status);
  const blockers = stripMarkdownListMarker(summary.blockers);
  const isBlocked = blockers !== 'None';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4">
        <Link to="/workstreams" className="text-xs text-accent hover:underline">
          ← Workstreams
        </Link>
        <div className="flex items-baseline gap-3 mt-3">
          <h1 className="text-base font-semibold text-primary font-mono">{id}</h1>
          <span className="text-xs text-dim">
            updated {formatDate(summary.updatedAt)}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-6 py-6 space-y-8 max-w-2xl">
        {/* Objective */}
        <section>
          <p className="text-2xs font-semibold uppercase tracking-widest text-dim mb-2">
            Objective
          </p>
          <p className="text-sm text-primary leading-relaxed">{summary.objective}</p>
        </section>

        {/* Status + blockers */}
        <section>
          <p className="text-2xs font-semibold uppercase tracking-widest text-dim mb-3">
            Status
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <span className="text-2xs text-dim w-16 shrink-0 pt-0.5">Status</span>
              <span className="text-sm text-secondary">{status}</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xs text-dim w-16 shrink-0 pt-0.5">Blockers</span>
              <span className={`text-sm ${isBlocked ? 'text-warning' : 'text-dim'}`}>
                {blockers}
              </span>
            </div>
          </div>
        </section>

        {/* Plan */}
        <section>
          <p className="text-2xs font-semibold uppercase tracking-widest text-dim mb-4">
            Plan
          </p>
          {plan.steps.length === 0 ? (
            <p className="text-xs text-dim">No steps defined.</p>
          ) : (
            <PlanChecklist steps={plan.steps} />
          )}
        </section>

        {/* Counts */}
        <section className="border-t border-border-subtle pt-4">
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-xl font-semibold font-mono text-primary">{taskCount}</p>
              <p className="text-2xs text-dim mt-0.5">task records</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-semibold font-mono text-primary">{artifactCount}</p>
              <p className="text-2xs text-dim mt-0.5">artifacts</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

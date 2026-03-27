import type { CodexPlanCredits, CodexPlanUsageState, CodexPlanUsageWindow } from '../types';

function formatResetAt(iso: string | null): string {
  if (!iso) {
    return 'Reset time unavailable';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Reset time unavailable';
  }

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, sameYear
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatCreditsValue(credits: CodexPlanCredits | null): string {
  if (!credits) {
    return '—';
  }

  if (credits.unlimited) {
    return 'Unlimited';
  }

  if (credits.balance) {
    return credits.balance;
  }

  return credits.hasCredits ? 'Available' : '—';
}

function renderMeterWidth(window: CodexPlanUsageWindow | null): string {
  const percent = window?.remainingPercent ?? 0;
  return `${Math.min(100, Math.max(0, percent))}%`;
}

function UsageWindowMetric({
  label,
  window,
}: {
  label: string;
  window: CodexPlanUsageWindow | null;
}) {
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-dim/70">{label}</p>
          <p className="mt-1 text-[15px] font-medium leading-none text-primary">
            {window ? `${Math.round(window.remainingPercent)}%` : '—'}
            <span className="ml-1 text-[11px] font-normal text-secondary">remaining</span>
          </p>
        </div>
        {window?.resetsAt && (
          <p className="shrink-0 text-right text-[10px] leading-tight text-dim">
            Resets {formatResetAt(window.resetsAt)}
          </p>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-border-subtle/80">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: renderMeterWidth(window) }}
        />
      </div>
    </div>
  );
}

function CreditsMetric({ credits }: { credits: CodexPlanCredits | null }) {
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-dim/70">Credits</p>
          <p className="mt-1 text-[15px] font-medium leading-none text-primary">{formatCreditsValue(credits)}</p>
        </div>
        <p className="shrink-0 text-right text-[10px] leading-tight text-dim">
          {credits?.unlimited
            ? 'Top-ups not needed'
            : credits?.hasCredits
              ? 'Balance available'
              : 'No credits'}
        </p>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-border-subtle/80">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: credits?.unlimited ? '100%' : credits?.hasCredits ? '82%' : '0%' }}
        />
      </div>
    </div>
  );
}

export function CodexPlanUsageSummary({
  usage,
  loading,
  refreshing,
}: {
  usage: CodexPlanUsageState | null;
  loading: boolean;
  refreshing: boolean;
}) {
  if (!usage?.available && !loading) {
    return null;
  }

  const snapshot = usage ?? {
    available: true,
    planType: null,
    fiveHour: null,
    weekly: null,
    credits: null,
    updatedAt: null,
    error: null,
  } satisfies CodexPlanUsageState;

  return (
    <div className="space-y-3 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim/70">Codex plan usage</p>
          <p className="mt-1 text-[12px] text-secondary">
            {loading
              ? 'Loading usage…'
              : snapshot.error
                ? 'Usage snapshot unavailable right now.'
                : snapshot.planType
                  ? `${snapshot.planType} account`
                  : 'ChatGPT Codex account'}
          </p>
        </div>

        {snapshot.updatedAt && !snapshot.error && (
          <p className="text-[10px] text-dim">
            {refreshing ? 'Refreshing…' : `Updated ${formatResetAt(snapshot.updatedAt)}`}
          </p>
        )}
      </div>

      {snapshot.error ? (
        <p className="text-[11px] text-dim">{snapshot.error}</p>
      ) : (
        <div className="grid gap-y-3 md:grid-cols-3 md:gap-x-6 md:gap-y-0">
          <div className="min-w-0 md:pr-6 md:border-r md:border-border-subtle/70">
            <UsageWindowMetric label="5hr" window={snapshot.fiveHour} />
          </div>
          <div className="min-w-0 border-t border-border-subtle/70 pt-3 md:border-t-0 md:border-r md:border-border-subtle/70 md:px-6 md:pt-0">
            <UsageWindowMetric label="Weekly" window={snapshot.weekly} />
          </div>
          <div className="min-w-0 border-t border-border-subtle/70 pt-3 md:border-t-0 md:pl-6 md:pt-0">
            <CreditsMetric credits={snapshot.credits} />
          </div>
        </div>
      )}
    </div>
  );
}

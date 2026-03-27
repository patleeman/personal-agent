import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton } from '../components/ui';
import { timeAgo } from '../utils';
import type { AlertEntry } from '../types';

const DEFAULT_ALERT_SNOOZE_DELAY = '15m';

function alertTone(entry: AlertEntry): 'warning' | 'accent' | 'danger' {
  if (entry.kind === 'approval-needed' || entry.kind === 'reminder') {
    return 'warning';
  }

  if (entry.kind === 'task-failed' || entry.kind === 'blocked') {
    return 'danger';
  }

  return 'accent';
}

function alertLabel(entry: AlertEntry): string {
  if (entry.kind === 'task-callback') {
    return 'task callback';
  }

  return entry.kind.replace(/-/g, ' ');
}

function sortAlerts(entries: AlertEntry[]): AlertEntry[] {
  return [...entries].sort((left, right) => {
    if (left.status === 'active' && right.status !== 'active') {
      return -1;
    }

    if (left.status !== 'active' && right.status === 'active') {
      return 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function AlertsPage() {
  const { alerts, setAlerts = () => {} } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleAlerts = useMemo(() => {
    const items = alerts?.entries ?? [];
    const filtered = filter === 'active'
      ? items.filter((entry) => entry.status === 'active')
      : items;
    return sortAlerts(filtered);
  }, [alerts?.entries, filter]);

  const refresh = useCallback(async () => {
    const snapshot = await api.alerts();
    setAlerts(snapshot);
  }, [setAlerts]);

  const acknowledge = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.acknowledgeAlert(id);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const dismiss = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.dismissAlert(id);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const snooze = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.snoozeAlert(id, { delay: DEFAULT_ALERT_SNOOZE_DELAY });
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const isLoading = alerts === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            <div className="ui-segmented-control">
              <button
                type="button"
                onClick={() => setFilter('active')}
                className={filter === 'active' ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
              >
                Active{(alerts?.activeCount ?? 0) > 0 ? <span className="ml-1 text-warning">{alerts?.activeCount ?? 0}</span> : null}
              </button>
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={filter === 'all' ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
              >
                All{(alerts?.entries.length ?? 0) > 0 ? <span className="ml-1 opacity-60">{alerts?.entries.length ?? 0}</span> : null}
              </button>
            </div>
            <Link to="/inbox" className="ui-toolbar-button">Back to inbox</Link>
            <ToolbarButton onClick={() => { void refresh(); }}>Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Alert history"
          meta="Sparse, interrupting reminders and callbacks. Active alerts also surface in Inbox so this page can stay low-frequency."
        />
      </PageHeader>

      {isLoading ? <LoadingState label="Loading alerts…" className="px-6" /> : null}
      {!isLoading && error ? <ErrorState message={`Failed to load alerts: ${error}`} className="px-6" /> : null}
      {!isLoading && !error && visibleAlerts.length === 0 ? (
        <EmptyState
          className="mx-6"
          title={filter === 'active' ? 'No active alerts.' : 'No alerts yet.'}
          body={filter === 'active'
            ? 'New reminders, approvals, and scheduled-task callbacks will show up here.'
            : 'Alerts stay here until acknowledged or dismissed.'}
        />
      ) : null}

      {!isLoading && visibleAlerts.length > 0 ? (
        <div className="px-4 pb-6 space-y-2">
          {visibleAlerts.map((entry) => {
            const conversationPath = entry.conversationId ? `/conversations/${encodeURIComponent(entry.conversationId)}` : null;
            const busy = busyId === entry.id;
            return (
              <div key={entry.id} className="ui-list-row ui-list-row-hover items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={alertTone(entry)}>{alertLabel(entry)}</Pill>
                    <Pill tone={entry.severity === 'disruptive' ? 'warning' : 'muted'}>{entry.severity}</Pill>
                    <Pill tone={entry.status === 'active' ? 'accent' : 'muted'}>{entry.status}</Pill>
                    <span className="text-[11px] text-dim">{timeAgo(entry.updatedAt)}</span>
                  </div>
                  <p className="mt-2 text-[14px] font-medium text-primary">{entry.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-secondary">{entry.body}</p>
                  {conversationPath ? (
                    <div className="mt-3">
                      <Link to={conversationPath} className="ui-action-button">Open conversation</Link>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {entry.status === 'active' ? (
                    <>
                      {entry.wakeupId ? (
                        <ToolbarButton disabled={busy} onClick={() => { void snooze(entry.id); }}>
                          {busy ? 'Working…' : 'Snooze 15m'}
                        </ToolbarButton>
                      ) : null}
                      <ToolbarButton disabled={busy} onClick={() => { void acknowledge(entry.id); }}>
                        {busy ? 'Working…' : 'Acknowledge'}
                      </ToolbarButton>
                      <ToolbarButton disabled={busy} onClick={() => { void dismiss(entry.id); }}>
                        Dismiss
                      </ToolbarButton>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

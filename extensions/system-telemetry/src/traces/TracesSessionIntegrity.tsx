/**
 * Session Integrity — prompt cache miss events.
 *
 * Displays a table of session-integrity violations (files modified
 * instead of append-only) along with the old/new file metadata.
 */

import type { AppTelemetryEventRow } from '@personal-agent/extensions/data';

interface Props {
  events: AppTelemetryEventRow[];
}

export function TracesSessionIntegrity({ events }: Props) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-primary">Session Integrity</h3>
        <span className="text-[11px] text-dim">{events.length} prompt cache misses</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-border-subtle bg-surface/50">
              <th className="px-3 py-2 font-medium text-dim">Time</th>
              <th className="px-3 py-2 font-medium text-dim">Session</th>
              <th className="px-3 py-2 font-medium text-dim">Old Size</th>
              <th className="px-3 py-2 font-medium text-dim">New Size</th>
              <th className="px-3 py-2 font-medium text-dim">Loader</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const meta = parseMetadata(event.metadataJson);
              return (
                <tr key={event.id} className="border-b border-border-subtle last:border-b-0 hover:bg-surface/30">
                  <td className="px-3 py-2 text-secondary whitespace-nowrap">{formatTime(event.ts)}</td>
                  <td className="px-3 py-2 text-secondary max-w-[180px] truncate" title={event.sessionId ?? undefined}>
                    {event.sessionId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-secondary whitespace-nowrap font-mono">{meta.oldSize ?? '?'}</td>
                  <td className="px-3 py-2 text-secondary whitespace-nowrap font-mono">{meta.newSize ?? '?'}</td>
                  <td className="px-3 py-2 text-secondary whitespace-nowrap">{meta.cacheLoader ?? '?'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function parseMetadata(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

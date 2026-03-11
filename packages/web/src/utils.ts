export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const KIND_META: Record<string, { label: string; color: string; dot: string }> = {
  'scheduled-task':  { label: 'scheduled', color: 'text-accent bg-accent-bg',   dot: 'bg-accent' },
  'deferred-resume': { label: 'resume',    color: 'text-teal bg-teal/10',        dot: 'bg-teal' },
  'subagent-run':    { label: 'subagent',  color: 'text-steel bg-steel/10',      dot: 'bg-steel' },
  'background-run':  { label: 'run',       color: 'text-steel bg-steel/10',      dot: 'bg-steel' },
  'verification':    { label: 'verify',    color: 'text-success bg-success/10',  dot: 'bg-success' },
  'follow-up':       { label: 'follow-up', color: 'text-warning bg-warning/10',  dot: 'bg-warning' },
  'note':            { label: 'note',      color: 'text-secondary bg-surface',   dot: 'bg-dim' },
};

const FALLBACK_KIND = { label: 'activity', color: 'text-secondary bg-surface', dot: 'bg-dim' };

export function kindMeta(kind: string) {
  return KIND_META[kind] ?? { ...FALLBACK_KIND, label: kind };
}

export function stripMarkdownListMarker(value: string | undefined): string {
  if (!value) return 'None';
  return value.split('\n')[0]?.replace(/^-\s+/, '').trim() || 'None';
}

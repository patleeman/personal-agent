import { Link } from 'react-router-dom';
import type { DesktopEnvironmentState } from '../types';

function formatHostLabel(environment: DesktopEnvironmentState): string {
  if (environment.activeHostKind === 'local') {
    return `Desktop app · Local host · ${environment.activeHostLabel}`;
  }

  const kindLabel = environment.activeHostKind === 'web' ? 'Web' : 'SSH';
  return `Desktop app · Remote host · ${environment.activeHostLabel} (${kindLabel})`;
}

export function DesktopHostIndicator({ environment }: { environment: DesktopEnvironmentState | null }) {
  if (!environment?.isElectron) {
    return null;
  }

  return (
    <div className="border-b border-border-subtle bg-surface/80 px-6 py-2 text-[12px] text-secondary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{formatHostLabel(environment)}</span>
        <Link to="/settings" className="text-[12px] text-primary underline decoration-border-default underline-offset-4 hover:decoration-primary">
          Connections
        </Link>
      </div>
    </div>
  );
}

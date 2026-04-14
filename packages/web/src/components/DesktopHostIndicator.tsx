import { Link } from 'react-router-dom';
import type { DesktopEnvironmentState } from '../types';

function formatHostLabel(environment: DesktopEnvironmentState): string {
  if (environment.activeHostKind === 'local') {
    return `Desktop app · Local host · ${environment.activeHostLabel}`;
  }

  const kindLabel = environment.activeHostKind === 'web' ? 'WebSocket workspace' : 'SSH workspace';
  return `Desktop app · Remote workspace · ${environment.activeHostLabel} (${kindLabel})`;
}

export function DesktopHostIndicator({ environment }: { environment: DesktopEnvironmentState | null }) {
  if (!environment?.isElectron) {
    return null;
  }

  const remote = environment.activeHostKind !== 'local';
  if (!remote) {
    return null;
  }

  return (
    <div className="border-b border-warning/25 bg-warning/10 px-6 py-2 text-[12px] text-primary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{formatHostLabel(environment)}</span>
        <Link to="/settings" className="text-[12px] text-warning underline decoration-warning/40 underline-offset-4 hover:text-primary hover:decoration-warning">
          Connections
        </Link>
      </div>
    </div>
  );
}

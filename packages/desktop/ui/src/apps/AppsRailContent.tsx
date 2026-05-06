/**
 * AppsRailContent — right rail content for the apps section.
 *
 * Shows a list of app thumbnails/cards that the user can click to open.
 */

import type { SkillApp } from './types';

export function AppsRailContent({
  apps,
  activeApp,
  loading,
  onSelectApp,
}: {
  apps: SkillApp[];
  activeApp: SkillApp | null;
  loading: boolean;
  onSelectApp: (app: SkillApp) => void;
}) {
  if (loading) {
    return <div className="flex items-center justify-center px-3 py-6 text-[12px] text-dim">Loading…</div>;
  }

  if (apps.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-[12px] text-dim leading-5">No apps yet.</p>
        <p className="mt-1 text-[11px] text-dim">Ask an agent to create one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-1.5 py-1.5">
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className={
            'flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 ' +
            (activeApp?.id === app.id ? 'bg-accent/10 text-primary' : 'text-secondary hover:bg-surface hover:text-primary')
          }
          onClick={() => onSelectApp(app)}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium">{app.name}</p>
            {app.description ? <p className="mt-0.5 truncate text-[11px] text-dim">{app.description}</p> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

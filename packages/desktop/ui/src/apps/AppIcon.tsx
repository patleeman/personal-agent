import type { SkillApp } from './types';

export function AppIcon({ app, className = 'size-10 rounded-xl' }: { app: SkillApp; className?: string }) {
  if (!app.icon) return null;

  return (
    <img
      src={`/api/apps/${encodeURIComponent(app.id)}/icon`}
      alt=""
      className={`${className} shrink-0 object-cover`}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}

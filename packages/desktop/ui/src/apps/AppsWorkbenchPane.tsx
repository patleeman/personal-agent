/**
 * AppsWorkbenchPane — main apps view for the workbench.
 *
 * Shows a list of skill apps as cards. Clicking an app loads its entry page.
 */

import { useEffect, useState } from 'react';

import { AppPageViewer } from './AppPageViewer';
import type { SkillApp } from './types';

function AppsListView({ apps, onSelect }: { apps: SkillApp[]; onSelect: (app: SkillApp) => void }) {
  if (apps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Apps</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">No apps yet</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">
            Ask an agent to create an app from a skill or prompt. Apps are stored in the knowledge base under{' '}
            <code className="rounded bg-surface px-1 py-0.5 text-[12px]">apps/</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className="flex flex-col rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent/30 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          onClick={() => onSelect(app)}
        >
          <p className="text-[13px] font-semibold text-primary">{app.name}</p>
          {app.description ? <p className="mt-1 text-[12px] leading-5 text-secondary line-clamp-2">{app.description}</p> : null}
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {app.nav.length > 1 ? `${app.nav.length} pages` : 'Single page'}
            </span>
            {app.prompt ? <span className="truncate text-[10px] text-dim font-mono">{app.prompt.slice(0, 40)}</span> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

export function AppsWorkbenchPane({
  activeApp,
  apps,
  loading,
  error,
  onSelectApp,
  onBack,
}: {
  activeApp: SkillApp | null;
  apps: SkillApp[];
  loading: boolean;
  error: string | null;
  onSelectApp: (app: SkillApp) => void;
  onBack: () => void;
}) {
  // Fetch app page content when an app is selected
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeApp) {
      setPageContent(null);
      setPageError(null);
      return;
    }

    let cancelled = false;
    setPageLoading(true);
    setPageContent(null);
    setPageError(null);

    fetch(`/api/vault/file?id=apps/${encodeURIComponent(activeApp.id)}/${encodeURIComponent(activeApp.entry)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load app page: ${res.statusText}`);
        return res.json();
      })
      .then((data: { content: string }) => {
        if (cancelled) return;
        setPageContent(data.content);
        setPageLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPageError(err.message);
        setPageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeApp]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[13px] text-danger">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[13px] text-dim">Loading apps…</p>
      </div>
    );
  }

  if (activeApp) {
    if (pageLoading) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p className="text-[13px] text-dim">Loading app…</p>
        </div>
      );
    }

    if (pageError || !pageContent) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div>
            <p className="text-[13px] text-danger">{pageError ?? 'Could not load app page'}</p>
            <button type="button" className="ui-toolbar-button mt-3 px-3 py-1 text-[12px]" onClick={onBack}>
              Back to apps
            </button>
          </div>
        </div>
      );
    }

    return <AppPageViewer app={activeApp} content={pageContent} />;
  }

  return <AppsListView apps={apps} onSelect={onSelectApp} />;
}

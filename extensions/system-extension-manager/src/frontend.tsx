import type { ExtensionInstallSummary } from '@personal-agent/extensions/data';
import { api, EXTENSION_REGISTRY_CHANGED_EVENT, notifyExtensionRegistryChanged } from '@personal-agent/extensions/data';
import {
  AppPageIntro,
  AppPageLayout,
  cx,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  ToolbarButton,
} from '@personal-agent/extensions/ui';
import { getDesktopBridge } from '@personal-agent/extensions/workbench';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

type NativeViewContribution = NonNullable<NonNullable<NonNullable<ExtensionInstallSummary['manifest']>['contributes']>['views']>[number];

interface LogicalSurfaceSummary {
  id: string;
  title: string;
  kind: string;
  detail?: NativeViewContribution;
  warning?: string;
}

function formatSurfaceKind(location: string): string {
  switch (location) {
    case 'main':
      return 'Main page';
    case 'rightRail':
      return 'Right rail';
    case 'workbench':
      return 'Workbench detail';
    default:
      return location;
  }
}

function getLogicalSurfaces(extension: ExtensionInstallSummary): LogicalSurfaceSummary[] {
  const legacySurfaces = extension.surfaces.map((surface) => ({
    id: surface.id,
    title: surface.title ?? surface.label ?? surface.id,
    kind: `${surface.placement} ${surface.kind}`,
  }));
  const views = extension.manifest?.contributes?.views ?? [];
  const viewsById = new Map(views.map((view) => [view.id, view] as const));
  const pairedDetailIds = new Set<string>();
  const pairedDetails = views
    .filter((view) => view.location === 'rightRail' && view.detailView)
    .map((view) => viewsById.get(view.detailView!))
    .filter((view): view is NativeViewContribution => Boolean(view));
  for (const detail of pairedDetails) {
    pairedDetailIds.add(detail.id);
  }

  const nativeSurfaces = views.flatMap((view): LogicalSurfaceSummary[] => {
    if (view.location === 'rightRail' && view.detailView) {
      const detail = viewsById.get(view.detailView);
      const wrongLocation = detail && detail.location !== 'workbench';
      return [
        {
          id: view.id,
          title: view.title,
          kind: detail && !wrongLocation ? 'Right rail + workbench detail' : 'Right rail',
          ...(detail && !wrongLocation ? { detail } : {}),
          ...(detail
            ? wrongLocation
              ? { warning: `Detail view ${view.detailView} is ${formatSurfaceKind(detail.location)}, expected Workbench detail` }
              : {}
            : { warning: `Missing detail view: ${view.detailView}` }),
        },
      ];
    }
    if (pairedDetailIds.has(view.id)) return [];
    return [
      {
        id: view.id,
        title: view.title,
        kind: formatSurfaceKind(view.location),
        ...(view.location === 'workbench' ? { warning: 'Orphan workbench detail view; no right rail view points at it' } : {}),
      },
    ];
  });
  return [...legacySurfaces, ...nativeSurfaces];
}

function contributionCounts(extension: ExtensionInstallSummary) {
  const views = extension.manifest?.contributes?.views ?? [];
  return {
    pages: views.filter((view) => view.location === 'main').length,
    rails: views.filter((view) => view.location === 'rightRail').length,
    workbench: views.filter((view) => view.location === 'workbench').length,
    tools: extension.tools?.length ?? 0,
    keybindings: extension.manifest?.contributes?.keybindings?.length ?? 0,
    backend: extension.backendActions?.length ?? 0,
    skills: extension.skills?.length ?? 0,
    agentHooks: extension.manifest?.backend?.agentExtension ? 1 : 0,
  };
}

function CompactCount({ icon, count, title }: { icon: ReactNode; count: number; title: string }) {
  if (count === 0) return null;
  return (
    <span title={title} className="inline-flex items-center gap-1 text-[12px] text-secondary">
      <span className="grid h-4 w-4 place-items-center text-dim">{icon}</span>
      <span>{count}</span>
    </span>
  );
}

function StatusToggle({ extension, busy, onToggle }: { extension: ExtensionInstallSummary; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 text-[12px] text-secondary transition-colors hover:text-primary disabled:opacity-50"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      aria-label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`}
    >
      <span
        className={cx(
          'relative h-5 w-9 rounded-full border transition-colors',
          extension.enabled ? 'border-success/40 bg-success/20' : 'border-border-subtle bg-surface/60',
        )}
      >
        <span
          className={cx(
            'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-transform',
            extension.enabled ? 'translate-x-[18px] bg-success' : 'translate-x-1 bg-dim',
          )}
        />
      </span>
      <span>{extension.enabled ? 'Enabled' : 'Disabled'}</span>
    </button>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="13" cy="8" r="1.2" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 4h6v6" />
      <path d="M12 4 5 11" />
      <path d="M3.5 6.5v6h6" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
      <path d="M5 6h6M5 8.5h4" />
    </svg>
  );
}

function RailIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M10.5 3v10" />
    </svg>
  );
}

function WorkbenchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4h10M3 8h10M3 12h10" />
      <path d="M6 4v8" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5.5 2.8 3.6 4.7l2.1 2.1 1.9-1.9" />
      <path d="M7 5.5 12.5 11a1.4 1.4 0 1 1-2 2L5 7.5" />
    </svg>
  );
}

function BackendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5 13 5v6l-5 2.5L3 11V5l5-2.5Z" />
      <path d="M3 5l5 2.5L13 5M8 7.5v6" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5 9.5 6 13 7.5 9.5 9 8 12.5 6.5 9 3 7.5 6.5 6 8 2.5Z" />
    </svg>
  );
}

function KeybindingIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="4" width="11" height="8" rx="1.5" />
      <path d="M4.5 6.5h1M7.5 6.5h1M10.5 6.5h1M4.5 9.5h7" />
    </svg>
  );
}

function AgentHookIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2" />
      <circle cx="8" cy="8" r="3.2" />
      <path d="M6.8 7.2h.1M9.1 7.2h.1M6.7 9.2c.8.6 1.8.6 2.6 0" />
    </svg>
  );
}

function firstRoute(extension: ExtensionInstallSummary): string | null {
  return extension.routes[0]?.route ?? extension.manifest?.contributes?.views?.find((view) => view.location === 'main')?.route ?? null;
}

function formatPermissionSummary(extension: ExtensionInstallSummary): string {
  return extension.permissions?.length ? extension.permissions.join(', ') : 'None declared';
}

function formatBackendActionSummary(extension: ExtensionInstallSummary): string {
  return extension.backendActions?.length
    ? extension.backendActions.map((action) => `${action.id} → ${action.handler}`).join(', ')
    : 'None';
}

function formatAgentHookSummary(extension: ExtensionInstallSummary): string {
  return extension.manifest?.backend?.agentExtension ?? 'None';
}

function formatToolSummary(extension: ExtensionInstallSummary): string {
  return extension.tools?.length ? extension.tools.map((tool) => tool.name).join(', ') : 'None';
}

function formatKeybindingSummary(extension: ExtensionInstallSummary): string {
  const keybindings = extension.manifest?.contributes?.keybindings ?? [];
  return keybindings.length ? keybindings.map((keybinding) => `${keybinding.title}: ${keybinding.keys.join(' / ')}`).join(', ') : 'None';
}

function formatSkillSummary(extension: ExtensionInstallSummary): string {
  return extension.skills?.length ? extension.skills.map((skill) => skill.name).join(', ') : 'None';
}

function formatFrontendSummary(extension: ExtensionInstallSummary): string {
  return extension.manifest?.frontend?.entry ?? 'None';
}

function slugifyExtensionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function ExtensionManagerPage() {
  const [extensions, setExtensions] = useState<ExtensionInstallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'system' | 'user' | 'enabled' | 'disabled'>('all');
  const [query, setQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .extensionInstallations()
      .then((items) => {
        setExtensions(items);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);
    return () => window.removeEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);
  }, [load]);

  const reload = useCallback(() => {
    setNotice(null);
    api
      .reloadExtensions()
      .then((result) => {
        setNotice(result.message);
        notifyExtensionRegistryChanged();
        load();
      })
      .catch((err: Error) => setError(err.message));
  }, [load]);

  const createExtension = useCallback(async () => {
    const name = window.prompt('Extension name');
    if (!name?.trim()) return;
    const defaultId = slugifyExtensionId(name);
    const id = window.prompt('Extension id', defaultId);
    if (!id?.trim()) return;

    const template = window.prompt('Template: main-page, right-rail, or workbench-detail', 'main-page');
    if (!template?.trim()) return;

    setNotice(null);
    try {
      const result = await api.createExtension({
        id: id.trim(),
        name: name.trim(),
        template: template.trim() as 'main-page' | 'right-rail' | 'workbench-detail',
      });
      setNotice(`Created ${result.packageRoot}`);
      notifyExtensionRegistryChanged();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [load]);

  const importExtension = useCallback(async () => {
    const zipPath = window.prompt('Path to extension .zip bundle');
    if (!zipPath?.trim()) return;

    setNotice(null);
    try {
      const result = await api.importExtension({ zipPath: zipPath.trim() });
      setNotice(`Imported ${result.packageRoot}`);
      notifyExtensionRegistryChanged();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [load]);

  const toggleExtension = useCallback(
    (extension: ExtensionInstallSummary) => {
      setNotice(null);
      if (extension.status === 'invalid') {
        setError(extension.errors?.[0] ?? 'Extension manifest is invalid.');
        return;
      }
      setBusyId(extension.id);
      const nextEnabled = !extension.enabled;
      api
        .updateExtension(extension.id, { enabled: nextEnabled })
        .then(() => {
          notifyExtensionRegistryChanged();
          if (
            !nextEnabled &&
            extension.routes.some((route) => location.pathname === route.route || location.pathname.startsWith(`${route.route}/`))
          ) {
            navigate('/extensions', { replace: true });
          }
          return load();
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setBusyId(null));
    },
    [load, location.pathname, navigate],
  );

  const openFolder = useCallback((extension: ExtensionInstallSummary) => {
    if (!extension.packageRoot) return;
    const bridge = getDesktopBridge();
    if (!bridge) {
      setNotice(extension.packageRoot);
      return;
    }
    void bridge.openPath(extension.packageRoot).then((result) => {
      if (!result.opened) {
        setNotice(result.error ?? extension.packageRoot ?? 'Could not open extension folder.');
      }
    });
  }, []);

  const buildExtension = useCallback(
    async (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      try {
        const result = await api.buildExtension(extension.id);
        setNotice(
          result.outputs.length > 0
            ? `Built ${result.outputs.length} bundle output${result.outputs.length === 1 ? '' : 's'}.`
            : 'Nothing to build.',
        );
        await api.reloadExtension(extension.id).catch((reloadError: Error) => {
          setNotice(`Build finished, but reload failed: ${reloadError.message}`);
        });
        notifyExtensionRegistryChanged();
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const reloadExtension = useCallback(
    async (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      try {
        const result = await api.reloadExtension(extension.id);
        setNotice(result.message ?? `Reloaded ${extension.name}.`);
        notifyExtensionRegistryChanged();
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const snapshotExtension = useCallback(async (extension: ExtensionInstallSummary) => {
    setBusyId(extension.id);
    setNotice(null);
    try {
      const result = await api.snapshotExtension(extension.id);
      setNotice(`Snapshot saved to ${result.snapshotPath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const exportExtension = useCallback(async (extension: ExtensionInstallSummary) => {
    setBusyId(extension.id);
    setNotice(null);
    try {
      const result = await api.exportExtension(extension.id);
      setNotice(`Exported bundle to ${result.exportPath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const visibleExtensions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return extensions.filter((extension) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'system' && extension.packageType === 'system') ||
        (filter === 'user' && extension.packageType !== 'system') ||
        (filter === 'enabled' && extension.enabled) ||
        (filter === 'disabled' && !extension.enabled && extension.status !== 'invalid') ||
        (filter === 'disabled' && extension.status === 'invalid');
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return `${extension.name} ${extension.id} ${extension.description ?? ''}`.toLowerCase().includes(normalizedQuery);
    });
  }, [extensions, filter, query]);

  const selectedExtension = useMemo(
    () => visibleExtensions.find((extension) => extension.id === selectedId) ?? visibleExtensions[0] ?? null,
    [visibleExtensions, selectedId],
  );

  useEffect(() => {
    if (visibleExtensions.length > 0 && !selectedExtension) {
      setSelectedId(visibleExtensions[0]?.id ?? null);
    }
  }, [visibleExtensions, selectedExtension]);

  if (loading) {
    return <LoadingState label="Loading extensions…" />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="h-full overflow-hidden">
      <AppPageLayout shellClassName="flex min-h-0 max-w-[92rem]" contentClassName="flex min-h-0 flex-1 flex-col gap-5">
        <AppPageIntro
          eyebrow="Extension Manager"
          title="Extensions"
          summary="Install, enable, build, and inspect local product modules."
          actions={
            <div className="flex flex-wrap gap-2">
              <ToolbarButton onClick={createExtension}>Create</ToolbarButton>
              <ToolbarButton onClick={importExtension}>Import</ToolbarButton>
              <IconButton title="Reload all extensions" aria-label="Reload all extensions" onClick={reload}>
                ↻
              </IconButton>
            </div>
          }
        />

        {notice ? <div className="text-[13px] text-secondary">{notice}</div> : null}

        {extensions.length === 0 ? (
          <EmptyState title="No extensions installed" body="Ask an agent to create one under the runtime extensions directory." />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1 rounded-xl bg-surface/40 p-1">
                {(['all', 'system', 'user', 'enabled', 'disabled'] as const).map((nextFilter) => (
                  <button
                    key={nextFilter}
                    type="button"
                    className={cx(
                      'rounded-lg px-3 py-1.5 text-[12px] capitalize transition-colors',
                      filter === nextFilter ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary',
                    )}
                    onClick={() => setFilter(nextFilter)}
                  >
                    {nextFilter}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search extensions…"
                className="w-72 rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-[13px] text-primary outline-none transition-colors placeholder:text-dim focus:border-accent/50"
              />
            </div>
            {visibleExtensions.length === 0 ? (
              <EmptyState title="No matching extensions" body="Adjust the filter or search query." />
            ) : (
              <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: 'minmax(0, 1fr) 22rem' }}>
                <section className="min-w-0 min-h-0 overflow-auto">
                  <table className="w-full border-collapse text-left text-[13px]">
                    <thead className="sticky top-0 z-10 bg-base/95 backdrop-blur">
                      <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
                        <th className="py-2 pr-4 font-semibold">Name</th>
                        <th className="py-2 px-3 font-semibold">Kind</th>
                        <th className="py-2 px-3 font-semibold">Contributes</th>
                        <th className="py-2 px-3 font-semibold">Status</th>
                        <th className="py-2 pl-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleExtensions.map((extension) => {
                        const route = firstRoute(extension);
                        const counts = contributionCounts(extension);
                        const selected = selectedExtension?.id === extension.id;
                        const busy = busyId === extension.id;
                        return (
                          <tr
                            key={extension.id}
                            className={cx(
                              'group cursor-pointer border-t border-border-subtle/70 transition-colors hover:bg-surface/30',
                              selected && 'bg-surface/45',
                            )}
                            onClick={() => setSelectedId(extension.id)}
                          >
                            <td className="min-w-0 py-3 pr-4 align-middle">
                              <div className="min-w-0">
                                <div className="truncate text-[14px] font-semibold text-primary">{extension.name}</div>
                                <div className="mt-0.5 truncate font-mono text-[11px] text-dim">{extension.id}</div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 align-middle text-[11px] uppercase tracking-[0.12em] text-secondary">
                              {extension.packageType ?? 'user'}
                            </td>
                            <td className="px-3 py-3 align-middle">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <CompactCount icon={<PageIcon />} count={counts.pages} title="Pages" />
                                <CompactCount icon={<RailIcon />} count={counts.rails} title="Right rail panels" />
                                <CompactCount icon={<WorkbenchIcon />} count={counts.workbench} title="Workbench details" />
                                <CompactCount icon={<ToolIcon />} count={counts.tools} title="Agent tools" />
                                <CompactCount icon={<KeybindingIcon />} count={counts.keybindings} title="Keyboard shortcuts" />
                                <CompactCount icon={<AgentHookIcon />} count={counts.agentHooks} title="Agent lifecycle hooks" />
                                <CompactCount icon={<BackendIcon />} count={counts.backend} title="Backend actions" />
                                <CompactCount icon={<SkillIcon />} count={counts.skills} title="Skills" />
                                {Object.values(counts).every((count) => count === 0) ? <span className="text-dim">—</span> : null}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 align-middle">
                              {extension.status === 'invalid' ? (
                                <span className="text-[12px] text-danger">Invalid</span>
                              ) : (
                                <StatusToggle extension={extension} busy={busy} onToggle={() => toggleExtension(extension)} />
                              )}
                            </td>
                            <td className="py-3 pl-3 align-middle">
                              <div className="flex items-center justify-end gap-1.5">
                                {route && extension.enabled ? (
                                  <Link
                                    className="ui-icon-button ui-icon-button-compact"
                                    to={route}
                                    title={`Open ${extension.name}`}
                                    aria-label={`Open ${extension.name}`}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <OpenIcon />
                                  </Link>
                                ) : null}
                                <details className="relative" onClick={(event) => event.stopPropagation()}>
                                  <summary
                                    className="ui-icon-button ui-icon-button-compact list-none cursor-pointer"
                                    title="More actions"
                                    aria-label="More actions"
                                  >
                                    <MoreIcon />
                                  </summary>
                                  <div className="absolute right-0 z-20 mt-2 w-40 rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl">
                                    {extension.packageRoot ? (
                                      <>
                                        <button
                                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary"
                                          onClick={() => openFolder(extension)}
                                        >
                                          Open folder
                                        </button>
                                        <button
                                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary disabled:opacity-50"
                                          disabled={busy || extension.status === 'invalid'}
                                          onClick={() => void buildExtension(extension)}
                                        >
                                          Build
                                        </button>
                                        <button
                                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary disabled:opacity-50"
                                          disabled={busy || extension.status === 'invalid'}
                                          onClick={() => void reloadExtension(extension)}
                                        >
                                          Reload
                                        </button>
                                        <button
                                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary disabled:opacity-50"
                                          disabled={busy}
                                          onClick={() => void snapshotExtension(extension)}
                                        >
                                          Snapshot
                                        </button>
                                        <button
                                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary disabled:opacity-50"
                                          disabled={busy || extension.status === 'invalid'}
                                          onClick={() => void exportExtension(extension)}
                                        >
                                          Export
                                        </button>
                                      </>
                                    ) : (
                                      <span className="block px-2.5 py-1.5 text-[12px] text-dim">No package actions</span>
                                    )}
                                  </div>
                                </details>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>

                {selectedExtension ? (
                  <aside className="min-h-0 overflow-auto border-l border-border-subtle pl-6">
                    <div className="space-y-5 pb-8">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="truncate text-[18px] font-semibold tracking-tight text-primary">{selectedExtension.name}</h2>
                          <span
                            className={cx(
                              'h-1.5 w-1.5 rounded-full',
                              selectedExtension.status === 'invalid' ? 'bg-danger' : selectedExtension.enabled ? 'bg-success' : 'bg-dim',
                            )}
                          />
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-dim">{selectedExtension.id}</p>
                        {selectedExtension.description ? (
                          <p className="mt-3 text-[13px] leading-6 text-secondary">{selectedExtension.description}</p>
                        ) : null}
                      </div>

                      {selectedExtension.status === 'invalid' ? (
                        <DetailBlock title="Validation errors">
                          <div className="space-y-2">
                            {(selectedExtension.errors ?? ['Extension manifest is invalid.']).map((message) => (
                              <p
                                key={message}
                                className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] leading-5 text-danger"
                              >
                                {message}
                              </p>
                            ))}
                          </div>
                        </DetailBlock>
                      ) : null}

                      <DetailBlock title="Surfaces">
                        {getLogicalSurfaces(selectedExtension).length ? (
                          <div className="space-y-2">
                            {getLogicalSurfaces(selectedExtension).map((surface) => (
                              <div key={surface.id}>
                                <div className="text-[13px] font-medium text-primary">{surface.title}</div>
                                <div className="text-[12px] text-secondary">
                                  {surface.kind}
                                  {surface.detail ? ` · detail: ${surface.detail.title}` : ''}
                                </div>
                                {surface.warning ? <div className="text-[12px] text-danger">{surface.warning}</div> : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[13px] text-dim">No surfaces.</p>
                        )}
                      </DetailBlock>

                      <DetailBlock title="Capabilities">
                        <dl className="space-y-3 text-[12px]">
                          <DetailRow label="UI" value={`Frontend: ${formatFrontendSummary(selectedExtension)}`} />
                          <DetailRow
                            label="Agent"
                            value={`Tools: ${formatToolSummary(selectedExtension)} · Hook: ${formatAgentHookSummary(selectedExtension)} · Skills: ${formatSkillSummary(selectedExtension)}`}
                          />
                          <DetailRow label="Shortcuts" value={formatKeybindingSummary(selectedExtension)} />
                          <DetailRow label="Backend" value={`Actions: ${formatBackendActionSummary(selectedExtension)}`} />
                          <DetailRow label="Permissions" value={formatPermissionSummary(selectedExtension)} />
                        </dl>
                      </DetailBlock>

                      {selectedExtension.packageRoot ? (
                        <DetailBlock title="Package">
                          <p className="break-all font-mono text-[11px] leading-5 text-secondary">{selectedExtension.packageRoot}</p>
                        </DetailBlock>
                      ) : null}

                      <details>
                        <summary className="cursor-pointer select-none text-[12px] text-dim transition-colors hover:text-secondary">
                          Raw manifest
                        </summary>
                        <pre className="mt-3 max-h-[22rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-secondary">
                          {JSON.stringify(selectedExtension.manifest, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </aside>
                ) : null}
              </div>
            )}
          </div>
        )}
      </AppPageLayout>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-dim">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-dim">{label}</dt>
      <dd className="mt-0.5 break-words text-secondary">{value}</dd>
    </div>
  );
}

import type { ExtensionInstallSummary } from '@personal-agent/extensions/data';
import { api, EXTENSION_REGISTRY_CHANGED_EVENT, notifyExtensionRegistryChanged } from '@personal-agent/extensions/data';
import type { UnifiedSettingsEntry } from '@personal-agent/extensions/settings';
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
import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function ExtensionActionsMenu({
  extension,
  onOpenFolder,
  onBuild,
  onReload,
  onSnapshot,
  onExport,
  onCopyDiagnostics,
}: {
  extension: ExtensionInstallSummary;
  onOpenFolder: () => void;
  onBuild: () => void;
  onReload: () => void;
  onSnapshot: () => void;
  onExport: () => void;
  onCopyDiagnostics: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const run = useCallback((event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    event.stopPropagation();
    setOpen(false);
    action();
  }, []);

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="ui-icon-button ui-icon-button-compact"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-40 rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl" role="menu">
          {extension.packageRoot ? (
            <>
              <button
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary"
                onClick={(event) => run(event, onOpenFolder)}
              >
                Open folder
              </button>
              <button
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary"
                onClick={(event) => run(event, onBuild)}
              >
                Build
              </button>
            </>
          ) : null}
          <button
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary"
            onClick={(event) => run(event, onReload)}
          >
            Reload
          </button>
          <button
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary"
            onClick={(event) => run(event, onSnapshot)}
          >
            Snapshot
          </button>
          <button
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary"
            onClick={(event) => run(event, onExport)}
          >
            Export
          </button>
          <button
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary"
            onClick={(event) => run(event, onCopyDiagnostics)}
          >
            Copy diagnostics
          </button>
        </div>
      ) : null}
    </div>
  );
}

const LOCKED_EXTENSION_IDS = ['system-extension-manager'];

function isLocked(extension: ExtensionInstallSummary): boolean {
  return LOCKED_EXTENSION_IDS.includes(extension.id);
}

function StatusToggle({ extension, busy, onToggle }: { extension: ExtensionInstallSummary; busy: boolean; onToggle: () => void }) {
  const locked = isLocked(extension);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 text-[12px] text-secondary transition-colors hover:text-primary disabled:opacity-50"
      disabled={busy || locked}
      onClick={(event) => {
        if (locked) return;
        event.stopPropagation();
        onToggle();
      }}
      aria-label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`}
      title={locked ? 'This extension is required by the application.' : undefined}
    >
      <span
        className={cx(
          'relative h-5 w-9 rounded-full border transition-colors',
          locked
            ? 'border-border-subtle bg-surface/40'
            : extension.enabled
              ? 'border-success/40 bg-success/20'
              : 'border-border-subtle bg-surface/60',
        )}
      >
        <span
          className={cx(
            'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left,background-color]',
            locked ? 'left-[18px] bg-dim' : extension.enabled ? 'left-[18px] bg-success' : 'left-1 bg-dim',
          )}
        />
      </span>
      <span>{locked ? 'Always on' : extension.enabled ? 'Enabled' : 'Disabled'}</span>
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

function DetailsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.5v3.5" />
      <circle cx="8" cy="5.5" r=".75" fill="currentColor" />
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

function formatExtensionDiagnostics(extension: ExtensionInstallSummary): string {
  return JSON.stringify(
    {
      id: extension.id,
      name: extension.name,
      status: extension.status ?? (extension.enabled ? 'enabled' : 'disabled'),
      packageType: extension.packageType ?? 'user',
      packageRoot: extension.packageRoot ?? null,
      errors: extension.errors ?? [],
      diagnostics: extension.diagnostics ?? [],
      skills: extension.skills ?? [],
      manifest: extension.manifest,
    },
    null,
    2,
  );
}

export function ExtensionManagerPage() {
  const [extensions, setExtensions] = useState<ExtensionInstallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'system' | 'user' | 'enabled' | 'disabled'>('all');
  const [query, setQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const [detailsExtensionId, setDetailsExtensionId] = useState<string | null>(null);

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

  const copyExtensionDiagnostics = useCallback(async (extension: ExtensionInstallSummary) => {
    const diagnostics = formatExtensionDiagnostics(extension);
    try {
      await navigator.clipboard.writeText(diagnostics);
      setNotice(`Copied diagnostics for ${extension.name}.`);
    } catch {
      setNotice(diagnostics);
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
      return `${extension.name} ${extension.id} ${extension.description ?? ''} ${(extension.skills ?? [])
        .map((skill) => `${skill.name} ${skill.description ?? ''}`)
        .join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [extensions, filter, query]);

  if (loading) {
    return <LoadingState label="Loading extensions…" />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <>
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
          <AppPageIntro
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
            <div className="space-y-4">
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
                <div>
                  <section className="min-w-0 overflow-auto">
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
                          const busy = busyId === extension.id;
                          return (
                            <tr key={extension.id} className="group border-t border-border-subtle/70 transition-colors hover:bg-surface/30">
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
                                  {extension.diagnostics?.length ? <span className="text-[12px] text-danger">!</span> : null}
                                  {Object.values(counts).every((count) => count === 0) && !extension.diagnostics?.length ? (
                                    <span className="text-dim">—</span>
                                  ) : null}
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
                                  <button
                                    type="button"
                                    className="ui-icon-button ui-icon-button-compact"
                                    title={`Details for ${extension.name}`}
                                    aria-label={`Details for ${extension.name}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setDetailsExtensionId(extension.id);
                                    }}
                                  >
                                    <DetailsIcon />
                                  </button>
                                  <ExtensionActionsMenu
                                    extension={extension}
                                    onOpenFolder={() => openFolder(extension)}
                                    onBuild={() => void buildExtension(extension)}
                                    onReload={() => void reloadExtension(extension)}
                                    onSnapshot={() => void snapshotExtension(extension)}
                                    onExport={() => void exportExtension(extension)}
                                    onCopyDiagnostics={() => void copyExtensionDiagnostics(extension)}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                </div>
              )}
            </div>
          )}
        </AppPageLayout>
      </div>

      {detailsExtensionId ? <ExtensionDetailsModal extensionId={detailsExtensionId} onClose={() => setDetailsExtensionId(null)} /> : null}
    </>
  );
}

function ExtensionSettingsBlock({ extension }: { extension: ExtensionInstallSummary }) {
  const { data: values } = useApi<Record<string, unknown>>(api.settings as never);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const contributes = extension.manifest?.contributes?.settings;
  const rawSettings = contributes && typeof contributes === 'object' && !Array.isArray(contributes) ? contributes : {};

  const entries: UnifiedSettingsEntry[] = useMemo(
    () =>
      Object.entries(rawSettings).map(([key, value]) => {
        const s = value as Record<string, unknown>;
        return {
          extensionId: extension.id,
          key,
          type: (s.type as string) ?? 'string',
          default: s.default,
          description: (s.description as string) ?? undefined,
          group: (s.group as string) ?? 'General',
          enum: Array.isArray(s.enum) ? (s.enum as string[]) : undefined,
          placeholder: (s.placeholder as string) ?? undefined,
          order: (s.order as number) ?? 0,
        };
      }),
    [rawSettings, extension.id],
  );

  useEffect(() => {
    if (values) {
      setDraft((prev) => {
        const merged = { ...values };
        for (const key of Object.keys(prev)) {
          if (prev[key] !== values[key]) merged[key] = prev[key];
        }
        return merged;
      });
    }
  }, [values]);

  // Debounced auto-save
  useEffect(() => {
    if (!values || !draft || saving) return;
    const changes: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(draft)) {
      if (val !== values[key]) changes[key] = val;
    }
    if (Object.keys(changes).length === 0) return;

    const timeout = window.setTimeout(async () => {
      setSaving(true);
      setSaveError(null);
      try {
        await api.updateSettings(changes);
        setSaveNotice('Saved.');
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [draft, values, saving]);

  if (Object.keys(rawSettings).length === 0) return null;

  entries.sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const currentValue = draft[entry.key] ?? entry.default;
        return (
          <div key={entry.key} className="space-y-1.5">
            <label className="block text-[13px] font-medium text-primary">
              {entry.key.split('.').pop() ?? entry.key}
              {entry.description ? <span className="ml-2 font-normal text-[12px] text-secondary">{entry.description}</span> : null}
            </label>

            {entry.type === 'boolean' ? (
              <label className="inline-flex items-center gap-2 text-[13px] text-primary">
                <input
                  type="checkbox"
                  checked={Boolean(currentValue)}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, [entry.key]: e.target.checked }));
                    setSaveNotice(null);
                    setSaveError(null);
                  }}
                  className="h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none"
                />
                <span>Enabled</span>
              </label>
            ) : entry.type === 'select' && entry.enum ? (
              <select
                value={String(currentValue)}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, [entry.key]: e.target.value }));
                  setSaveNotice(null);
                  setSaveError(null);
                }}
                className="w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none"
              >
                {entry.enum.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : entry.type === 'number' ? (
              <input
                type="number"
                value={currentValue as number}
                placeholder={entry.placeholder}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, [entry.key]: Number(e.target.value) }));
                  setSaveNotice(null);
                  setSaveError(null);
                }}
                className="w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none"
              />
            ) : (
              <input
                type="text"
                value={String(currentValue)}
                placeholder={entry.placeholder}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, [entry.key]: e.target.value }));
                  setSaveNotice(null);
                  setSaveError(null);
                }}
                className="w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] font-mono text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </div>
        );
      })}
      {saving ? <p className="text-[12px] text-dim">Saving…</p> : null}
      {saveNotice ? <p className="text-[12px] text-success">{saveNotice}</p> : null}
      {saveError ? <p className="text-[12px] text-danger">{saveError}</p> : null}
    </div>
  );
}

function ExtensionDetailsModal({ extensionId, onClose }: { extensionId: string; onClose: () => void }) {
  const [extensions, setExtensions] = useState<ExtensionInstallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .extensionInstallations()
      .then((items) => {
        setExtensions(items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);
    return () => window.removeEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);
  }, [load]);

  const openPath = useCallback((path: string) => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setNotice(path);
      return;
    }
    void bridge.openPath(path).then((result) => {
      if (!result.opened) {
        setNotice(result.error ?? path);
      }
    });
  }, []);

  const copyExtensionDiagnostics = useCallback(async (extension: ExtensionInstallSummary) => {
    const diagnostics = formatExtensionDiagnostics(extension);
    try {
      await navigator.clipboard.writeText(diagnostics);
      setNotice(`Copied diagnostics for ${extension.name}.`);
    } catch {
      setNotice(diagnostics);
    }
  }, []);

  const extension = extensions.find((e) => e.id === extensionId) ?? null;

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/45 px-4 py-10 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Extension details"
        className="relative w-full max-w-2xl rounded-3xl border border-border-subtle bg-base shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-3xl border-b border-border-subtle bg-base/95 px-6 py-4 backdrop-blur">
          <h2 className="text-[16px] font-semibold text-primary">Extension details</h2>
          <button type="button" onClick={onClose} className="ui-icon-button" aria-label="Close details" title="Close">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {loading ? (
            <LoadingState label="Loading extension details…" />
          ) : !extension ? (
            <p className="text-[13px] text-dim">Extension not found.</p>
          ) : (
            <div className="space-y-5 pb-4">
              {notice ? <p className="text-[12px] leading-5 text-secondary">{notice}</p> : null}

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[18px] font-semibold tracking-tight text-primary">{extension.name}</h3>
                  <span
                    className={cx(
                      'h-1.5 w-1.5 rounded-full',
                      extension.status === 'invalid' ? 'bg-danger' : extension.enabled ? 'bg-success' : 'bg-dim',
                    )}
                  />
                </div>
                <p className="mt-1 font-mono text-[11px] text-dim">{extension.id}</p>
                {extension.description ? <p className="mt-3 text-[13px] leading-6 text-secondary">{extension.description}</p> : null}
              </div>

              {extension.status === 'invalid' ? (
                <DetailBlock
                  title="Validation errors"
                  action={
                    <button
                      type="button"
                      className="text-[11px] text-secondary transition-colors hover:text-primary"
                      onClick={() => void copyExtensionDiagnostics(extension)}
                    >
                      Copy diagnostics
                    </button>
                  }
                >
                  <div className="space-y-2">
                    {(extension.errors ?? ['Extension manifest is invalid.']).map((message) => (
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

              {extension.diagnostics?.length ? (
                <DetailBlock
                  title="Diagnostics"
                  action={
                    <button
                      type="button"
                      className="text-[11px] text-secondary transition-colors hover:text-primary"
                      onClick={() => void copyExtensionDiagnostics(extension)}
                    >
                      Copy diagnostics
                    </button>
                  }
                >
                  <div className="space-y-2">
                    {extension.diagnostics.map((message) => (
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
                {getLogicalSurfaces(extension).length ? (
                  <div className="space-y-2">
                    {getLogicalSurfaces(extension).map((surface) => (
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
                  <DetailRow label="UI" value={`Frontend: ${formatFrontendSummary(extension)}`} />
                  <DetailRow
                    label="Agent"
                    value={`Tools: ${formatToolSummary(extension)} · Hook: ${formatAgentHookSummary(extension)} · Skills: ${formatSkillSummary(extension)}`}
                  />
                  <DetailRow label="Shortcuts" value={formatKeybindingSummary(extension)} />
                  <DetailRow label="Backend" value={`Actions: ${formatBackendActionSummary(extension)}`} />
                  <DetailRow label="Permissions" value={formatPermissionSummary(extension)} />
                </dl>
              </DetailBlock>

              <DetailBlock title="Settings">
                <ExtensionSettingsBlock extension={extension} />
              </DetailBlock>

              <DetailBlock title="Skills">
                {extension.skills?.length ? (
                  <div className="space-y-3">
                    {extension.skills.map((skill) => (
                      <div key={skill.name} className="group/skill">
                        <button
                          type="button"
                          className="text-left text-[13px] font-medium text-primary transition-colors hover:text-accent"
                          onClick={() => openPath(skill.path)}
                        >
                          {skill.title ?? skill.name}
                        </button>
                        <div className="font-mono text-[11px] text-dim">{skill.name}</div>
                        {skill.description ? <p className="mt-1 text-[12px] leading-5 text-secondary">{skill.description}</p> : null}
                        <p className="mt-1 break-all font-mono text-[11px] leading-5 text-dim">{skill.path}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-dim">No skills.</p>
                )}
              </DetailBlock>

              {extension.packageRoot ? (
                <DetailBlock title="Package">
                  <p className="break-all font-mono text-[11px] leading-5 text-secondary">{extension.packageRoot}</p>
                </DetailBlock>
              ) : null}

              <details>
                <summary className="cursor-pointer select-none text-[12px] text-dim transition-colors hover:text-secondary">
                  Raw manifest
                </summary>
                <pre className="mt-3 max-h-[22rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-secondary">
                  {JSON.stringify(extension.manifest, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailBlock({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-dim">{title}</h3>
        {action}
      </div>
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

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { api } from '../client/api';
import { AppPageIntro, AppPageLayout, cx, EmptyState, ErrorState, LoadingState, ToolbarButton } from '../components/ui';
import { getDesktopBridge } from '../desktop/desktopBridge';
import { notifyExtensionRegistryChanged } from './extensionRegistryEvents';
import type { ExtensionInstallSummary } from './types';

type NativeViewContribution = NonNullable<NonNullable<ExtensionInstallSummary['manifest']['contributes']>['views']>[number];

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
  const views = extension.manifest.contributes?.views ?? [];
  const viewsById = new Map(views.map((view) => [view.id, view] as const));
  const pairedDetailIds = new Set<string>();
  const nativeSurfaces = views.flatMap((view): LogicalSurfaceSummary[] => {
    if (view.location === 'rightRail' && view.detailView) {
      const detail = viewsById.get(view.detailView);
      if (detail) pairedDetailIds.add(detail.id);
      return [
        {
          id: view.id,
          title: view.title,
          kind: detail ? 'Right rail + workbench detail' : 'Right rail',
          ...(detail ? { detail } : {}),
          ...(detail ? {} : { warning: `Missing detail view: ${view.detailView}` }),
        },
      ];
    }
    if (pairedDetailIds.has(view.id)) return [];
    return [{ id: view.id, title: view.title, kind: formatSurfaceKind(view.location) }];
  });
  return [...legacySurfaces, ...nativeSurfaces];
}

function formatSurfaceSummary(extension: ExtensionInstallSummary): string {
  const surfaces = getLogicalSurfaces(extension);
  if (surfaces.length === 0) return 'No surfaces';
  return surfaces.map((surface) => surface.kind).join(', ');
}

function firstRoute(extension: ExtensionInstallSummary): string | null {
  return extension.routes[0]?.route ?? extension.manifest.contributes?.views?.find((view) => view.location === 'main')?.route ?? null;
}

function formatPermissionSummary(extension: ExtensionInstallSummary): string {
  return extension.permissions?.length ? extension.permissions.join(', ') : 'None declared';
}

function formatBackendActionSummary(extension: ExtensionInstallSummary): string {
  return extension.backendActions?.length
    ? extension.backendActions.map((action) => `${action.id} → ${action.handler}`).join(', ')
    : 'None';
}

function formatFrontendSummary(extension: ExtensionInstallSummary): string {
  return extension.manifest.frontend?.entry ?? 'None';
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
      setBusyId(extension.id);
      setNotice(null);
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
        notifyExtensionRegistryChanged();
        await api.reloadExtension(extension.id).catch(() => null);
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
        await api.reloadExtension(extension.id);
        setNotice(`Reloaded ${extension.name}.`);
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

  if (loading) {
    return <LoadingState label="Loading extensions…" />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[84rem]" contentClassName="space-y-8">
        <AppPageIntro
          eyebrow="Extension Manager"
          title="Extensions"
          summary="Local product modules loaded from system bundles and runtime extension packages."
          actions={
            <div className="flex flex-wrap gap-2">
              <ToolbarButton onClick={createExtension}>Create starter</ToolbarButton>
              <ToolbarButton onClick={importExtension}>Import zip</ToolbarButton>
              <ToolbarButton onClick={reload}>Reload</ToolbarButton>
            </div>
          }
        />

        {notice ? <div className="text-[13px] text-secondary">{notice}</div> : null}

        {extensions.length === 0 ? (
          <EmptyState title="No extensions installed" body="Ask an agent to create one under the runtime extensions directory." />
        ) : (
          <section className="space-y-5">
            {extensions.map((extension) => {
              const route = firstRoute(extension);
              const logicalSurfaces = getLogicalSurfaces(extension);
              return (
                <article key={extension.id} className="grid w-full gap-4 py-2 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-[15px] font-semibold tracking-tight text-primary">{extension.name}</p>
                      <span className="text-[11px] uppercase tracking-[0.14em] text-dim">{extension.packageType ?? 'user'}</span>
                      <span className={cx('text-[11px]', extension.enabled ? 'text-success' : 'text-dim')}>
                        {extension.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    {extension.description ? (
                      <p className="max-w-3xl text-[13px] leading-6 text-secondary">{extension.description}</p>
                    ) : null}
                    <div className="space-y-1 text-[12px] text-secondary">
                      <p className="font-mono text-[11px] text-dim">{extension.id}</p>
                      <p>{formatSurfaceSummary(extension)}</p>
                      {logicalSurfaces.length > 0 ? (
                        <div className="space-y-1 pt-1">
                          {logicalSurfaces.map((surface) => (
                            <div key={surface.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium text-secondary">{surface.title}</span>
                              <span className="text-[11px] text-dim">{surface.kind}</span>
                              {surface.detail ? <span className="text-[11px] text-dim">detail: {surface.detail.title}</span> : null}
                              {surface.warning ? <span className="text-[11px] text-danger">{surface.warning}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <p>
                        <span className="text-dim">Permissions:</span> {formatPermissionSummary(extension)}
                      </p>
                      <p>
                        <span className="text-dim">Frontend:</span> {formatFrontendSummary(extension)}
                      </p>
                      <p>
                        <span className="text-dim">Backend:</span> {formatBackendActionSummary(extension)}
                      </p>
                    </div>
                    <details className="group max-w-3xl">
                      <summary className="cursor-pointer select-none text-[12px] text-dim transition-colors hover:text-secondary">
                        Manifest
                      </summary>
                      <pre className="mt-3 max-h-[22rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-secondary">
                        {JSON.stringify(extension.manifest, null, 2)}
                      </pre>
                    </details>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                    {route && extension.enabled ? (
                      <Link className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none" to={route}>
                        Open
                      </Link>
                    ) : null}
                    {extension.packageRoot ? (
                      <>
                        <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] shadow-none" onClick={() => openFolder(extension)}>
                          Open folder
                        </ToolbarButton>
                        <ToolbarButton
                          className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                          disabled={busyId === extension.id}
                          onClick={() => {
                            void buildExtension(extension);
                          }}
                        >
                          Build
                        </ToolbarButton>
                        <ToolbarButton
                          className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                          disabled={busyId === extension.id}
                          onClick={() => {
                            void reloadExtension(extension);
                          }}
                        >
                          Reload
                        </ToolbarButton>
                        <ToolbarButton
                          className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                          disabled={busyId === extension.id}
                          onClick={() => {
                            void snapshotExtension(extension);
                          }}
                        >
                          Snapshot
                        </ToolbarButton>
                        <ToolbarButton
                          className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                          disabled={busyId === extension.id}
                          onClick={() => {
                            void exportExtension(extension);
                          }}
                        >
                          Export
                        </ToolbarButton>
                      </>
                    ) : null}
                    <ToolbarButton
                      className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                      disabled={busyId === extension.id}
                      onClick={() => toggleExtension(extension)}
                    >
                      {extension.enabled ? 'Disable' : 'Enable'}
                    </ToolbarButton>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </AppPageLayout>
    </div>
  );
}

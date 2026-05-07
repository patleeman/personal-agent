import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../client/api';
import { AppPageIntro, AppPageLayout, cx, EmptyState, ErrorState, LoadingState, ToolbarButton } from '../components/ui';
import { getDesktopBridge } from '../desktop/desktopBridge';
import type { ExtensionInstallSummary } from './types';

function formatSurfaceSummary(extension: ExtensionInstallSummary): string {
  if (extension.surfaces.length === 0) return 'No surfaces';
  const counts = new Map<string, number>();
  for (const surface of extension.surfaces) {
    counts.set(surface.placement, (counts.get(surface.placement) ?? 0) + 1);
  }
  return [...counts.entries()].map(([placement, count]) => `${count} ${placement}`).join(', ');
}

function firstRoute(extension: ExtensionInstallSummary): string | null {
  return extension.routes[0]?.route ?? null;
}

export function ExtensionManagerPage() {
  const [extensions, setExtensions] = useState<ExtensionInstallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .extensionInstallations()
      .then((items) => {
        setExtensions(items);
        setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null)));
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

  const selected = useMemo(
    () => extensions.find((extension) => extension.id === selectedId) ?? extensions[0] ?? null,
    [extensions, selectedId],
  );

  const reload = useCallback(() => {
    setNotice(null);
    api
      .reloadExtensions()
      .then((result) => {
        setNotice(result.message);
        load();
      })
      .catch((err: Error) => setError(err.message));
  }, [load]);

  const toggleExtension = useCallback(
    (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      api
        .updateExtension(extension.id, { enabled: !extension.enabled })
        .then(() => load())
        .catch((err: Error) => setError(err.message))
        .finally(() => setBusyId(null));
    },
    [load],
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

  if (loading) {
    return <LoadingState label="Loading extensions…" />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout
        shellClassName="max-w-[84rem]"
        contentClassName="space-y-8"
        aside={
          selected ? (
            <aside className="space-y-5 text-[12px]">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Manifest</p>
                <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface/70 p-3 font-mono text-[11px] leading-5 text-secondary">
                  {JSON.stringify(selected.manifest, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Permissions</p>
                <p className="mt-2 leading-6 text-secondary">
                  {selected.permissions?.length ? selected.permissions.join(', ') : 'None declared'}
                </p>
              </div>
            </aside>
          ) : null
        }
      >
        <AppPageIntro
          eyebrow="Extension Manager"
          title="Extensions"
          summary="Local product modules loaded from system bundles and runtime extension packages."
          actions={<ToolbarButton onClick={reload}>Reload</ToolbarButton>}
        />

        {notice ? <div className="border-t border-border-subtle pt-4 text-[13px] text-secondary">{notice}</div> : null}

        {extensions.length === 0 ? (
          <EmptyState title="No extensions installed" body="Ask an agent to create one under the runtime extensions directory." />
        ) : (
          <section className="border-t border-border-subtle">
            {extensions.map((extension) => {
              const route = firstRoute(extension);
              const selectedExtension = selected?.id === extension.id;
              return (
                <button
                  key={extension.id}
                  type="button"
                  className={cx(
                    'grid w-full gap-4 border-b border-border-subtle py-5 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start',
                    selectedExtension ? 'text-primary' : 'text-secondary hover:text-primary',
                  )}
                  onClick={() => setSelectedId(extension.id)}
                >
                  <div className="min-w-0 space-y-2">
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
                    <p className="font-mono text-[11px] text-dim">{extension.id}</p>
                    <p className="text-[12px] text-secondary">{formatSurfaceSummary(extension)}</p>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 sm:justify-end" onClick={(event) => event.stopPropagation()}>
                    {route && extension.enabled ? (
                      <Link className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none" to={route}>
                        Open
                      </Link>
                    ) : null}
                    {extension.packageRoot ? (
                      <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] shadow-none" onClick={() => openFolder(extension)}>
                        Open folder
                      </ToolbarButton>
                    ) : null}
                    <ToolbarButton
                      className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                      disabled={extension.packageType === 'system' || busyId === extension.id}
                      onClick={() => toggleExtension(extension)}
                    >
                      {extension.enabled ? 'Disable' : 'Enable'}
                    </ToolbarButton>
                  </div>
                </button>
              );
            })}
          </section>
        )}
      </AppPageLayout>
    </div>
  );
}

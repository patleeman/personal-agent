import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import type { ExtensionInstallSummary } from '@personal-agent/extensions/data';
import { api, EXTENSION_REGISTRY_CHANGED_EVENT, notifyExtensionRegistryChanged } from '@personal-agent/extensions/data';
import { SettingsField, type UnifiedSettingsEntry, useApi } from '@personal-agent/extensions/settings';
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

type ExtensionTemplate = 'main-page' | 'right-rail' | 'workbench-detail';

interface ExtensionCreateDraft {
  name: string;
  id: string;
  template: ExtensionTemplate;
}

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
  busy,
  onOpenFolder,
  onBuild,
  onReload,
  onValidate,
  onSnapshot,
  onExport,
  onCopyDiagnostics,
  onSelfTest,
}: {
  extension: ExtensionInstallSummary;
  busy: boolean;
  onOpenFolder: () => void;
  onBuild: () => void;
  onReload: () => void;
  onValidate: () => void;
  onSnapshot: () => void;
  onExport: () => void;
  onCopyDiagnostics: () => void;
  onSelfTest: () => void;
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
  const menuButtonClass =
    'w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="ui-icon-button ui-icon-button-compact"
        title={busy ? 'Working…' : 'More actions'}
        aria-label={busy ? 'Working…' : 'More actions'}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
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
              <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onOpenFolder)}>
                Open folder
              </button>
              <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onBuild)}>
                Build
              </button>
            </>
          ) : null}
          <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onReload)}>
            Reload
          </button>
          <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onValidate)}>
            Validate
          </button>
          <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onSelfTest)}>
            Run self-test
          </button>
          <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onSnapshot)}>
            Snapshot
          </button>
          <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onExport)}>
            Export
          </button>
          <button className={menuButtonClass} disabled={busy} onClick={(event) => run(event, onCopyDiagnostics)}>
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

function isExperimentalExtension(extension: ExtensionInstallSummary): boolean {
  return extension.manifest?.defaultEnabled === false;
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
      buildError: extension.buildError ?? null,
      skills: extension.skills ?? [],
      manifest: extension.manifest,
    },
    null,
    2,
  );
}

export function ExtensionManagerPage({ pa }: ExtensionSurfaceProps) {
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
  const [createDraft, setCreateDraft] = useState<ExtensionCreateDraft | null>(null);
  const [importDraft, setImportDraft] = useState(false);
  const [showExperimental, setShowExperimental] = useState(false);

  const load = useCallback(async (options: { showLoading?: boolean } = {}) => {
    if (options.showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const items = await api.extensionInstallations();
      setExtensions(items);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, []);

  const showActionNotice = useCallback(
    (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
      setNotice(message);
      if (type !== 'info') {
        pa.ui.notify({ message, type, source: 'system-extension-manager' });
      }
    },
    [pa],
  );

  const showActionError = useCallback(
    (message: string, details?: string) => {
      setNotice(message);
      pa.ui.notify({ message, details, type: 'error', source: 'system-extension-manager' });
    },
    [pa],
  );

  useEffect(() => {
    void load({ showLoading: true });
    const refresh = () => {
      void load({ showLoading: false });
    };
    window.addEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, refresh);
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

  const createExtension = useCallback(() => {
    setCreateDraft({ name: '', id: '', template: 'main-page' });
  }, []);

  const submitCreateExtension = useCallback(
    async (draft: ExtensionCreateDraft) => {
      setCreateDraft(null);
      setNotice(null);
      try {
        const result = await api.createExtension({
          id: draft.id.trim(),
          name: draft.name.trim(),
          template: draft.template,
        });
        setNotice(`Created ${result.packageRoot}`);
        notifyExtensionRegistryChanged();
        await load();
        // Auto-build the newly created extension so its frontend is immediately usable.
        try {
          const buildResult = await api.buildExtension(result.extension?.id ?? draft.id.trim());
          setNotice(
            buildResult.outputs.length > 0
              ? `Created and built ${buildResult.outputs.length} bundle output${buildResult.outputs.length === 1 ? '' : 's'}.`
              : 'Created extension with no build outputs.',
          );
          await api.reloadExtension(result.extension?.id ?? draft.id.trim()).catch(() => undefined);
          notifyExtensionRegistryChanged();
          await load();
        } catch {
          setNotice(`Created extension at ${result.packageRoot}. Build manually from the actions menu.`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const [importWarningZip, setImportWarningZip] = useState<string | null>(null);

  const importExtension = useCallback(() => {
    setImportDraft(true);
  }, []);

  const confirmImport = useCallback(
    async (zipPath: string) => {
      setImportWarningZip(null);
      setNotice(null);
      try {
        const result = await api.importExtension({ zipPath });
        setNotice(`Imported ${result.packageRoot}`);
        notifyExtensionRegistryChanged();
        await load();
        // Auto-build the imported extension.
        try {
          const extId = result.extension?.id;
          if (extId) {
            const buildResult = await api.buildExtension(extId);
            if (buildResult.outputs.length > 0) {
              await api.reloadExtension(extId).catch(() => undefined);
              notifyExtensionRegistryChanged();
              await load();
            }
          }
        } catch {
          // Imported extension may already have built outputs — that's fine.
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const cancelImport = useCallback(() => {
    setImportWarningZip(null);
  }, []);

  const toggleExtension = useCallback(
    (extension: ExtensionInstallSummary) => {
      setNotice(null);
      if (extension.status === 'invalid') {
        setError(extension.errors?.[0] ?? 'Extension manifest is invalid.');
        return;
      }
      setBusyId(extension.id);
      const nextEnabled = !extension.enabled;
      setExtensions((items) =>
        items.map((item) =>
          item.id === extension.id ? { ...item, enabled: nextEnabled, status: nextEnabled ? 'enabled' : 'disabled' } : item,
        ),
      );
      api
        .updateExtension(extension.id, { enabled: nextEnabled })
        .then((result) => {
          if (result.extension) {
            setExtensions((items) => items.map((item) => (item.id === result.extension?.id ? result.extension : item)));
          }
          notifyExtensionRegistryChanged();
          const actionResult = result.actionResult?.result as { conversationId?: string } | undefined;
          if (nextEnabled && actionResult?.conversationId) {
            navigate(`/conversations/${encodeURIComponent(actionResult.conversationId)}`);
          }
          if (
            !nextEnabled &&
            extension.routes.some((route) => location.pathname === route.route || location.pathname.startsWith(`${route.route}/`))
          ) {
            navigate('/extensions', { replace: true });
          }
          return load({ showLoading: false });
        })
        .catch((err: Error) => {
          setExtensions((items) => items.map((item) => (item.id === extension.id ? extension : item)));
          setError(err.message);
        })
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
        showActionNotice(
          result.outputs.length > 0
            ? `Built ${result.outputs.length} bundle output${result.outputs.length === 1 ? '' : 's'}.`
            : 'Nothing to build.',
        );
        await api.reloadExtension(extension.id).catch((reloadError: Error) => {
          showActionNotice(`Build finished, but reload failed: ${reloadError.message}`, 'warning');
        });
        notifyExtensionRegistryChanged();
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showActionError(`Build failed for ${extension.name}: ${message}`, err instanceof Error ? err.stack : undefined);
      } finally {
        setBusyId(null);
      }
    },
    [load, showActionError, showActionNotice],
  );

  const reloadExtension = useCallback(
    async (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      try {
        const result = await api.reloadExtension(extension.id);
        showActionNotice(result.message ?? `Reloaded ${extension.name}.`);
        notifyExtensionRegistryChanged();
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showActionError(`Reload failed for ${extension.name}: ${message}`, err instanceof Error ? err.stack : undefined);
      } finally {
        setBusyId(null);
      }
    },
    [load, showActionError, showActionNotice],
  );

  const validateExtension = useCallback(
    async (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      try {
        const report = await api.validateExtension(extension.id);
        const errorFindings = report.findings.filter((finding) => finding.severity === 'error');
        const warningFindings = report.findings.filter((finding) => finding.severity === 'warning');
        const details = report.findings
          .map(
            (finding) =>
              `${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ''}`,
          )
          .join('\n');
        showActionNotice(
          report.ok
            ? `${extension.name} passed validation.`
            : `${extension.name} validation found ${errorFindings.length} error${errorFindings.length === 1 ? '' : 's'} and ${warningFindings.length} warning${warningFindings.length === 1 ? '' : 's'}.`,
          report.ok ? 'info' : 'warning',
        );
        if (!report.ok && details) setNotice(details);
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showActionError(`Validation failed for ${extension.name}: ${message}`, err instanceof Error ? err.stack : undefined);
      } finally {
        setBusyId(null);
      }
    },
    [load, showActionError, showActionNotice],
  );

  const snapshotExtension = useCallback(
    async (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      try {
        const result = await api.snapshotExtension(extension.id);
        showActionNotice(`Snapshot saved to ${result.snapshotPath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showActionError(`Snapshot failed for ${extension.name}: ${message}`, err instanceof Error ? err.stack : undefined);
      } finally {
        setBusyId(null);
      }
    },
    [showActionError, showActionNotice],
  );

  const exportExtension = useCallback(
    async (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      try {
        const result = await api.exportExtension(extension.id);
        showActionNotice(`Exported bundle to ${result.exportPath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showActionError(`Export failed for ${extension.name}: ${message}`, err instanceof Error ? err.stack : undefined);
      } finally {
        setBusyId(null);
      }
    },
    [showActionError, showActionNotice],
  );

  const copyExtensionDiagnostics = useCallback(
    async (extension: ExtensionInstallSummary) => {
      const diagnostics = formatExtensionDiagnostics(extension);
      try {
        await navigator.clipboard.writeText(diagnostics);
        showActionNotice(`Copied diagnostics for ${extension.name}.`);
      } catch {
        setNotice(diagnostics);
        pa.ui.notify({
          message: `Clipboard unavailable. Showing diagnostics for ${extension.name}.`,
          details: diagnostics,
          type: 'warning',
          source: 'system-extension-manager',
        });
      }
    },
    [pa, showActionNotice],
  );

  const selfTestExtension = useCallback(
    async (extension: ExtensionInstallSummary) => {
      setBusyId(extension.id);
      setNotice(null);
      try {
        const result = await api.extensionSelfTest(extension.id);
        const failed = result.checks.filter((check) => !check.ok);
        showActionNotice(
          failed.length
            ? `${extension.name} self-test failed: ${failed.map((check) => check.error ?? check.name).join('; ')}`
            : `${extension.name} self-test passed.`,
          failed.length ? 'warning' : 'info',
        );
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showActionError(`Self-test failed for ${extension.name}: ${message}`, err instanceof Error ? err.stack : undefined);
      } finally {
        setBusyId(null);
      }
    },
    [load, showActionError, showActionNotice],
  );

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

  const visibleStandardExtensions = useMemo(
    () => visibleExtensions.filter((extension) => !isExperimentalExtension(extension)),
    [visibleExtensions],
  );
  const visibleExperimentalExtensions = useMemo(() => visibleExtensions.filter(isExperimentalExtension), [visibleExtensions]);

  const renderExtensionRows = (items: ExtensionInstallSummary[]) =>
    items.map((extension) => {
      const route = firstRoute(extension);
      const counts = contributionCounts(extension);
      const busy = busyId === extension.id;
      return (
        <tr key={extension.id} className="group border-t border-border-subtle/70 transition-colors hover:bg-surface/30">
          <td className="min-w-0 py-3 pr-4 align-middle">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-[14px] font-semibold text-primary">{extension.name}</div>
                <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">
                  {extension.packageType ?? 'user'}
                </span>
              </div>
              <div className="mt-0.5 max-w-[44rem] whitespace-normal break-words text-[12px] leading-5 text-secondary">
                {extension.description || 'No description provided.'}
              </div>
            </div>
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
              {extension.buildError ? (
                <span className="text-[12px] text-danger" title={extension.buildError}>
                  Build failed
                </span>
              ) : null}
              {Object.values(counts).every((count) => count === 0) && !extension.diagnostics?.length && !extension.buildError ? (
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
              {busy ? <span className="text-[11px] text-dim">Working…</span> : null}
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
                busy={busy}
                onOpenFolder={() => openFolder(extension)}
                onBuild={() => void buildExtension(extension)}
                onReload={() => void reloadExtension(extension)}
                onValidate={() => void validateExtension(extension)}
                onSnapshot={() => void snapshotExtension(extension)}
                onExport={() => void exportExtension(extension)}
                onCopyDiagnostics={() => void copyExtensionDiagnostics(extension)}
                onSelfTest={() => void selfTestExtension(extension)}
              />
            </div>
          </td>
        </tr>
      );
    });

  const renderExtensionTable = (items: ExtensionInstallSummary[]) => (
    <section className="min-w-0 overflow-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-base/95 backdrop-blur">
          <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
            <th className="py-2 pr-4 font-semibold">Name</th>
            <th className="py-2 px-3 font-semibold">Contributes</th>
            <th className="py-2 px-3 font-semibold">Status</th>
            <th className="py-2 pl-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>{renderExtensionRows(items)}</tbody>
      </table>
    </section>
  );

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

          {notice ? (
            <div className="sticky top-0 z-20 border-b border-border-subtle/60 bg-base/95 py-2 text-[13px] text-secondary backdrop-blur">
              {notice}
            </div>
          ) : null}

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
                <div className="space-y-6">
                  {visibleStandardExtensions.length ? renderExtensionTable(visibleStandardExtensions) : null}
                  {visibleExperimentalExtensions.length ? (
                    <section className="space-y-3 border-t border-border-subtle/70 pt-4">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 text-left"
                        onClick={() => setShowExperimental((value) => !value)}
                        aria-expanded={showExperimental}
                      >
                        <div>
                          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-dim">Experimental</div>
                          <div className="mt-1 text-[12px] text-secondary">
                            Off by default. Enable only when you want to try unfinished extension surfaces.
                          </div>
                        </div>
                        <span className="text-[12px] text-dim">
                          {visibleExperimentalExtensions.length} {showExperimental ? 'Hide' : 'Show'}
                        </span>
                      </button>
                      {showExperimental ? renderExtensionTable(visibleExperimentalExtensions) : null}
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </AppPageLayout>
      </div>

      {detailsExtensionId ? <ExtensionDetailsModal extensionId={detailsExtensionId} onClose={() => setDetailsExtensionId(null)} /> : null}
      {createDraft ? (
        <CreateExtensionModal draft={createDraft} onCancel={() => setCreateDraft(null)} onSubmit={submitCreateExtension} />
      ) : null}
      {importDraft ? (
        <ExtensionTextInputModal
          title="Import extension"
          label="Path to extension .zip bundle"
          confirmLabel="Review import"
          onCancel={() => setImportDraft(false)}
          onSubmit={(zipPath) => {
            setImportDraft(false);
            setImportWarningZip(zipPath.trim());
          }}
        />
      ) : null}
      {importWarningZip ? <ImportWarningModal zipPath={importWarningZip} onConfirm={confirmImport} onCancel={cancelImport} /> : null}
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
        for (const [key, value] of Object.entries(prev)) {
          if (value !== values[key]) merged[key] = value;
        }
        return merged;
      });
    }
  }, [values]);

  // Debounced auto-save
  useEffect(() => {
    if (!values || !draft || saving) return;
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(draft)) {
      if (value !== values[key]) changes[key] = value;
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
      {entries.map((entry) => (
        <SettingsField
          key={entry.key}
          entry={entry}
          value={draft[entry.key]}
          onChange={(key, val) => {
            setDraft((prev) => ({ ...prev, [key]: val }));
            setSaveNotice(null);
            setSaveError(null);
          }}
        />
      ))}
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
      .catch((err: unknown) => {
        setLoading(false);
        window.dispatchEvent(
          new CustomEvent('pa-notification', {
            detail: {
              type: 'error',
              message: 'Failed to load extensions',
              details: err instanceof Error ? err.message : String(err),
              source: 'system-extension-manager',
            },
          }),
        );
      });
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

              {extension.buildError ? (
                <DetailBlock title="Build error">
                  <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2">
                    <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-danger">{extension.buildError}</p>
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

function ExtensionTextInputModal({
  title,
  label,
  initialValue = '',
  confirmLabel = 'Continue',
  onCancel,
  onSubmit,
}: {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-8 backdrop-blur-sm" onClick={onCancel}>
      <form
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-base p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(value);
        }}
      >
        <h2 className="text-[16px] font-semibold text-primary">{title}</h2>
        <label className="mt-4 block text-[12px] font-medium text-secondary">
          {label}
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 w-full rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-[13px] text-primary outline-none transition-colors placeholder:text-dim focus:border-accent/50"
            autoFocus
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl px-4 py-2 text-[13px] text-secondary hover:bg-surface hover:text-primary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!trimmed}
            className="rounded-xl border border-accent/50 bg-accent/15 px-4 py-2 text-[13px] font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateExtensionModal({
  draft,
  onCancel,
  onSubmit,
}: {
  draft: ExtensionCreateDraft;
  onCancel: () => void;
  onSubmit: (draft: ExtensionCreateDraft) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [id, setId] = useState(draft.id);
  const [template, setTemplate] = useState<ExtensionTemplate>(draft.template);
  const normalizedName = name.trim();
  const normalizedId = id.trim() || slugifyExtensionId(normalizedName);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-8 backdrop-blur-sm" onClick={onCancel}>
      <form
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-base p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedName && normalizedId) onSubmit({ name: normalizedName, id: normalizedId, template });
        }}
      >
        <h2 className="text-[16px] font-semibold text-primary">Create extension</h2>
        <label className="mt-4 block text-[12px] font-medium text-secondary">
          Extension name
          <input
            value={name}
            onChange={(event) => {
              const nextName = event.target.value;
              setName(nextName);
              setId((current) => (current.trim() ? current : slugifyExtensionId(nextName)));
            }}
            className="mt-2 w-full rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/50"
            autoFocus
          />
        </label>
        <label className="mt-3 block text-[12px] font-medium text-secondary">
          Extension id
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder={slugifyExtensionId(name) || 'my-extension'}
            className="mt-2 w-full rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/50"
          />
        </label>
        <label className="mt-3 block text-[12px] font-medium text-secondary">
          Template
          <select
            value={template}
            onChange={(event) => setTemplate(event.target.value as ExtensionTemplate)}
            className="mt-2 w-full rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/50"
          >
            <option value="main-page">Main page</option>
            <option value="right-rail">Right rail</option>
            <option value="workbench-detail">Workbench detail</option>
          </select>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl px-4 py-2 text-[13px] text-secondary hover:bg-surface hover:text-primary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!normalizedName || !normalizedId}
            className="rounded-xl border border-accent/50 bg-accent/15 px-4 py-2 text-[13px] font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportWarningModal({
  zipPath,
  onConfirm,
  onCancel,
}: {
  zipPath: string;
  onConfirm: (zipPath: string) => void;
  onCancel: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [cleanRoomStatus, setCleanRoomStatus] = useState<'idle' | 'starting' | 'started' | 'error'>('idle');
  const [cleanRoomRunId, setCleanRoomRunId] = useState<string | null>(null);
  const [cleanRoomError, setCleanRoomError] = useState<string | null>(null);
  const confirmed = confirmText === 'I UNDERSTAND THE RISKS';

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) {
        onCancel();
      }
    },
    [onCancel],
  );

  const startCleanRoomAnalysis = useCallback(async () => {
    setCleanRoomStatus('starting');
    setCleanRoomError(null);
    try {
      const result = await api.cleanRoomImport({ zipPath });
      setCleanRoomRunId(result.runId);
      setCleanRoomStatus('started');
    } catch (err) {
      setCleanRoomError(err instanceof Error ? err.message : String(err));
      setCleanRoomStatus('error');
    }
  }, [zipPath]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Dangerous import warning"
        className="relative w-full max-w-lg rounded-3xl border-2 border-danger/60 bg-base shadow-2xl shadow-danger/10"
      >
        {/* Top danger bar */}
        <div className="flex items-center gap-2.5 rounded-t-3xl border-b border-danger/30 bg-danger/15 px-6 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-danger/20 text-[15px] font-bold text-danger">!</span>
          <h2 className="text-[16px] font-bold tracking-tight text-danger">DANGEROUS OPERATION</h2>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-3">
            <p className="text-[13px] font-semibold leading-6 text-primary">
              You are about to import a pre-built extension from:{' '}
              <code className="break-all font-mono text-[12px] text-secondary">{zipPath}</code>
            </p>

            <div className="rounded-xl border border-danger/30 bg-danger/[0.07] px-4 py-3">
              <p className="text-[13px] font-semibold leading-6 text-danger">Why this is dangerous</p>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-secondary">
                <li>
                  Extensions have full access to your agent&apos;s tools, including file system read/write, shell execution, network access,
                  and AI model invocation.
                </li>
                <li>
                  An imported extension could exfiltrate data, modify your knowledge base, inject prompts, or spawn background processes —
                  all without your knowledge.
                </li>
                <li>There is no sandbox. The code runs with the same privileges as your agent runtime.</li>
              </ul>
            </div>

            <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
              <p className="text-[13px] font-semibold leading-6 text-accent">Recommended alternative</p>
              <p className="mt-1.5 text-[12px] leading-5 text-secondary">
                Instead of importing an untrusted binary bundle, ask an agent to do a <strong>clean-room re-implementation</strong>. A
                stripped-down agent with only web tools can fetch the plugin&apos;s repository, generate a specification from the source,
                and scan that spec for vulnerabilities. The sanitized spec can then be handed to a full agent for implementation — no blind
                code execution.
              </p>
            </div>
          </div>

          {cleanRoomStatus === 'starting' ? (
            <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
              <p className="text-[13px] text-accent">Starting clean-room analysis…</p>
            </div>
          ) : cleanRoomStatus === 'started' ? (
            <div className="rounded-xl border border-success/30 bg-success/[0.06] px-4 py-3">
              <p className="text-[13px] font-medium text-success">Clean-room analysis started</p>
              <p className="mt-1 text-[12px] text-secondary">
                Run ID: <code className="font-mono">{cleanRoomRunId}</code>
              </p>
              <p className="mt-1 text-[12px] text-secondary">
                Track progress in the Runs panel. The analysis agent will generate a specification withsecurity findings.
              </p>
            </div>
          ) : cleanRoomStatus === 'error' ? (
            <div className="rounded-xl border border-danger/30 bg-danger/[0.07] px-4 py-3">
              <p className="text-[13px] font-semibold text-danger">Failed to start analysis</p>
              <p className="mt-1 text-[12px] text-secondary">{cleanRoomError}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-danger">
              Type <span className="font-mono">I UNDERSTAND THE RISKS</span> to confirm
            </label>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="Type I UNDERSTAND THE RISKS to enable import"
              className="w-full rounded-xl border border-danger/40 bg-base px-4 py-2.5 text-[13px] text-primary outline-none transition-colors placeholder:text-dim focus:border-danger"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border-subtle pt-4">
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-surface hover:text-primary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-xl border border-accent/60 bg-accent/15 px-4 py-2 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={cleanRoomStatus === 'starting' || cleanRoomStatus === 'started'}
              onClick={startCleanRoomAnalysis}
            >
              {cleanRoomStatus === 'starting' ? 'Starting…' : cleanRoomStatus === 'started' ? 'Analysis running' : 'Clean-room analysis'}
            </button>
            <button
              type="button"
              className="rounded-xl border border-danger/60 bg-danger/15 px-5 py-2 text-[13px] font-semibold text-danger transition-colors hover:bg-danger/25 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!confirmed}
              onClick={() => onConfirm(zipPath)}
            >
              {confirmed ? 'Import anyway' : 'Confirm to enable'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

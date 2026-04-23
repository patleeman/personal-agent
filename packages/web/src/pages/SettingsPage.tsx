import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { formatContextWindowLabel, formatThinkingLevelLabel } from '../conversation/conversationHeader';
import { api } from '../client/api';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
import { useApi } from '../hooks/useApi';
import { getKnowledgeBaseSyncPresentation } from '../knowledge/knowledgeBaseSyncStatus';
import { THINKING_LEVEL_OPTIONS, getModelSelectableServiceTierOptions, groupModelsByProvider } from '../model/modelPreferences';
import { resetStoredConversationUiState, resetStoredLayoutPreferences } from '../local/localSettings';
import { type ThemePreference, useTheme } from '../ui-state/theme';
import { getDesktopBridge, isDesktopShell, readDesktopConnections, readDesktopEnvironment } from '../desktop/desktopBridge';
import { createDesktopAwareEventSource } from '../desktop/desktopEventSource';
import { subscribeDesktopProviderOAuthLogin } from '../desktop/desktopProviderOAuth';
import type {
  DesktopAppPreferencesState,
  DesktopConnectionsState,
  DesktopEnvironmentState,
  DesktopHostRecord,
  DesktopSshConnectionTestResult,
  McpServerConfig,
  ModelProviderApi,
  ModelProviderConfig,
  ModelProviderModelConfig,
  ModelProviderState,
  ModelState,
  ProviderAuthSummary,
  ProviderOAuthLoginState,
  ProviderOAuthLoginStreamEvent,
} from '../shared/types';
import { AppPageIntro, AppPageLayout, AppPageSection, AppPageToc, Pill, ToolbarButton, cx } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';
const SETTINGS_QUICK_LINKS = [
  { id: 'settings-appearance', label: 'Appearance', summary: 'Theme and display behavior' },
  { id: 'settings-general', label: 'General', summary: 'Defaults, knowledge base, and roots' },
  { id: 'settings-skills', label: 'Skills', summary: 'Folders, wrappers, and instructions' },
  { id: 'settings-providers', label: 'Providers', summary: 'Models, overrides, and credentials' },
  { id: 'settings-desktop', label: 'Desktop', summary: 'App behavior and SSH remotes' },
  { id: 'settings-interface', label: 'Interface', summary: 'Saved browser UI state' },
] as const;

type SettingsQuickLink = (typeof SETTINGS_QUICK_LINKS)[number];
type SettingsQuickLinkId = SettingsQuickLink['id'];
type ModelOption = ModelState['models'][number];

const MODEL_PROVIDER_API_OPTIONS: Array<{ value: ModelProviderApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
];

const NEW_MODEL_PROVIDER_ID = '__new-model-provider__';
const NEW_MODEL_ID = '__new-model__';
const JSON_TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[88px] font-mono text-[11px] leading-5`;
const COMPACT_META_INPUT_CLASS = `${INPUT_CLASS} px-2.5 py-1.5 text-[12px]`;

interface ProviderEditorDraft {
  id: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  authHeader: boolean;
  headersText: string;
  compatText: string;
  modelOverridesText: string;
}

interface ModelEditorDraft {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  acceptsImages: boolean;
  contextWindow: string;
  maxTokens: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
  headersText: string;
  compatText: string;
}

function formatJsonObject(value: Record<string, unknown> | Record<string, string> | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return '';
  }

  return JSON.stringify(value, null, 2);
}

function createProviderEditorDraft(provider: ModelProviderConfig | null): ProviderEditorDraft {
  return {
    id: provider?.id ?? '',
    baseUrl: provider?.baseUrl ?? '',
    api: provider?.api ?? '',
    apiKey: provider?.apiKey ?? '',
    authHeader: provider?.authHeader ?? false,
    headersText: formatJsonObject(provider?.headers),
    compatText: formatJsonObject(provider?.compat),
    modelOverridesText: formatJsonObject(provider?.modelOverrides),
  };
}

function createModelEditorDraft(model: ModelProviderModelConfig | null): ModelEditorDraft {
  return {
    id: model?.id ?? '',
    name: model?.name ?? '',
    api: model?.api ?? '',
    baseUrl: model?.baseUrl ?? '',
    reasoning: model?.reasoning ?? false,
    acceptsImages: model?.input.includes('image') ?? false,
    contextWindow: model?.contextWindow !== undefined ? String(model.contextWindow) : '128000',
    maxTokens: model?.maxTokens !== undefined ? String(model.maxTokens) : '16384',
    costInput: model?.cost !== undefined ? String(model.cost.input) : '0',
    costOutput: model?.cost !== undefined ? String(model.cost.output) : '0',
    costCacheRead: model?.cost !== undefined ? String(model.cost.cacheRead) : '0',
    costCacheWrite: model?.cost !== undefined ? String(model.cost.cacheWrite) : '0',
    headersText: formatJsonObject(model?.headers),
    compatText: formatJsonObject(model?.compat),
  };
}

function parseOptionalJsonObject(text: string, label: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function parseOptionalStringRecord(text: string, label: string): Record<string, string> | undefined {
  const parsed = parseOptionalJsonObject(text, label);
  if (!parsed) {
    return undefined;
  }

  const entries = Object.entries(parsed);
  for (const [, value] of entries) {
    if (typeof value !== 'string') {
      throw new Error(`${label} values must all be strings.`);
    }
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function parseOptionalFiniteNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return parsed;
}

function formatModelProviderSummary(provider: ModelProviderConfig): string {
  if (provider.models.length === 0) {
    return 'Provider override only';
  }

  return `${provider.models.length} ${provider.models.length === 1 ? 'model' : 'models'}`;
}

function formatProviderModelSummary(model: ModelProviderModelConfig): string {
  const parts = [
    model.name || model.id,
    `${formatContextWindowLabel(model.contextWindow ?? 128_000)} ctx`,
  ];

  if (model.reasoning) {
    parts.push('reasoning');
  }

  if (model.input.includes('image')) {
    parts.push('images');
  }

  return parts.join(' · ');
}

function splitModelRef(modelRef: string): { provider: string; model: string } {
  const slashIndex = modelRef.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
    return { provider: '', model: modelRef };
  }

  return {
    provider: modelRef.slice(0, slashIndex),
    model: modelRef.slice(slashIndex + 1),
  };
}

function findModelByRef(models: ModelOption[], modelRef: string): ModelOption | null {
  if (!modelRef) {
    return null;
  }

  const { provider, model } = splitModelRef(modelRef);
  if (provider) {
    return models.find((candidate) => candidate.provider === provider && candidate.id === model) ?? null;
  }

  return models.find((candidate) => candidate.id === modelRef) ?? null;
}

function formatModelSummary(model: ModelOption | null, fallback: string): string {
  if (!model) {
    return fallback;
  }

  return `${model.id} · ${model.provider} · ${formatContextWindowLabel(model.context)} ctx`;
}

function canProviderUseApiKey(provider: ProviderAuthSummary | null): boolean {
  if (!provider) {
    return false;
  }

  return provider.apiKeySupported || provider.authType === 'api_key';
}

function formatProviderAuthStatus(provider: ProviderAuthSummary | null): string {
  if (!provider) {
    return 'No provider selected.';
  }

  switch (provider.authType) {
    case 'api_key':
      return provider.hasStoredCredential
        ? 'Stored API key in auth.json.'
        : 'API key is available at runtime.';
    case 'oauth':
      return provider.hasStoredCredential
        ? 'Logged in with OAuth credentials saved in auth.json.'
        : 'OAuth credentials are available at runtime.';
    case 'environment':
      return 'Credentials resolved from environment or external provider config.';
    default:
      return provider.apiKeySupported
        ? 'No stored auth.json credential detected yet. Save an API key here instead of relying on environment variables.'
        : 'No stored auth.json credential detected. This provider may still use environment values or apiKey settings from models.json.';
  }
}

function formatProviderModelCoverage(provider: ProviderAuthSummary | null): string {
  if (!provider) {
    return '';
  }

  if (provider.modelCount <= 0) {
    return 'No discovered models currently map to this provider.';
  }

  return `${provider.modelCount} discovered ${provider.modelCount === 1 ? 'model' : 'models'} mapped to this provider.`;
}

function formatMcpServerSource(server: McpServerConfig): string {
  if (server.source === 'skill' && server.skillName) {
    return `Bundled with ${server.skillName}`;
  }

  return 'Explicit config';
}

function formatMcpServerCommand(server: McpServerConfig): string {
  if (server.transport === 'remote') {
    return server.url ?? 'Remote endpoint';
  }

  const commandLine = [server.command, ...server.args].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return commandLine.length > 0 ? commandLine.join(' ') : 'Local stdio wrapper';
}

function formatMcpServerSourcePathLabel(server: McpServerConfig): string {
  return server.source === 'skill' ? 'Manifest' : 'Config';
}

function ThemeButton({
  value,
  current,
  onSelect,
  label,
}: {
  value: ThemePreference;
  current: ThemePreference;
  onSelect: (theme: ThemePreference) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cx('ui-segmented-button capitalize', current === value && 'ui-segmented-button-active')}
      aria-pressed={current === value}
    >
      {label ?? value}
    </button>
  );
}

function SettingsSection({
  id,
  label,
  description,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AppPageSection id={id} title={label} description={description} className={className}>
      {children}
    </AppPageSection>
  );
}

function SettingsPanel({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx('scroll-mt-24 grid gap-5 border-t border-border-subtle/70 py-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-8', className)}>
      <div className="min-w-0 space-y-2">
        <div className="space-y-1.5">
          <h3 className="text-[15px] font-medium tracking-tight text-primary">{title}</h3>
          {description ? <p className="max-w-sm text-[12px] leading-5 text-secondary">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div> : null}
      </div>
      <div className="min-w-0 space-y-3.5">{children}</div>
    </section>
  );
}

interface DesktopHostDraft {
  id: string;
  label: string;
  sshTarget: string;
}

function createDesktopHostDraft(host?: Extract<DesktopHostRecord, { kind: 'ssh' }>): DesktopHostDraft {
  return {
    id: host?.id ?? '',
    label: host?.label ?? '',
    sshTarget: host?.sshTarget ?? '',
  };
}

function formatDesktopHostDetails(host: Extract<DesktopHostRecord, { kind: 'ssh' }>): string {
  return host.sshTarget;
}

function DesktopRuntimeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="10" rx="2.5" />
      <path d="M8 19h8" />
      <path d="M12 15v4" />
    </svg>
  );
}

function SshRemoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="7" height="6" rx="1.5" />
      <rect x="13" y="13" width="7" height="6" rx="1.5" />
      <path d="M11 8h2a3 3 0 0 1 3 3v2" />
      <path d="m13 11 3 0 0-3" />
    </svg>
  );
}

function formatSshTestPlatformLabel(result: DesktopSshConnectionTestResult): string {
  const osLabel = result.os === 'darwin' ? 'macOS' : result.os === 'linux' ? 'Linux' : result.os;
  return `${osLabel} ${result.arch}`;
}

function formatSshTestSummary(result: DesktopSshConnectionTestResult): string {
  return `${result.message} · cache ${result.cacheDirectory}`;
}

function formatDesktopUpdateSummary(state: DesktopAppPreferencesState | null): string {
  if (!state || !state.available) {
    return 'Desktop app settings are unavailable in this window.';
  }

  const update = state.update;
  if (!update.supported) {
    return 'Update checks are only available in packaged desktop builds.';
  }

  switch (update.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return update.availableVersion
        ? `Downloading Personal Agent ${update.availableVersion}…`
        : 'Downloading the latest Personal Agent build…';
    case 'waiting-for-idle':
      return update.downloadedVersion
        ? `Personal Agent ${update.downloadedVersion} is ready. Auto-install will wait until the desktop goes idle.${update.waitingForIdleReason ? ` ${update.waitingForIdleReason}` : ''}`
        : 'A downloaded update is waiting for the desktop to go idle.';
    case 'ready':
      return update.downloadedVersion
        ? state.autoInstallUpdates
          ? `Personal Agent ${update.downloadedVersion} is ready. It will install automatically once the desktop goes idle.`
          : `Personal Agent ${update.downloadedVersion} is ready. Quit the app to finish installing it.`
        : `Current version: ${update.currentVersion}.`;
    case 'installing':
      return update.downloadedVersion
        ? `Installing Personal Agent ${update.downloadedVersion}…`
        : 'Installing the downloaded update…';
    case 'error':
      return update.lastError
        ? `Update error: ${update.lastError}`
        : 'The last update action failed.';
    case 'idle':
    default:
      return `Current version: ${update.currentVersion}.`;
  }
}

function formatStartOnSystemStartSummary(state: DesktopAppPreferencesState | null): string {
  if (!state || !state.available) {
    return 'Desktop app settings are unavailable in this window.';
  }

  if (!state.supportsStartOnSystemStart) {
    return 'Start on system start is only available in packaged desktop builds.';
  }

  return state.startOnSystemStart
    ? 'Personal Agent will launch in the background when you sign in to this Mac.'
    : 'Personal Agent only starts when you open it manually.';
}

interface CompanionHelloState {
  hostInstanceId: string;
  hostLabel: string;
  daemonVersion: string;
  protocolVersion: string;
}

interface CompanionPairingCodeState {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

interface CompanionSetupLinkState {
  id: string;
  label: string;
  baseUrl: string;
  setupUrl: string;
}

interface CompanionSetupState {
  pairing: CompanionPairingCodeState;
  links: CompanionSetupLinkState[];
  warnings: string[];
}

interface CompanionDeviceSummaryState {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

interface CompanionAdminState {
  pendingPairings: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
  }>;
  devices: CompanionDeviceSummaryState[];
}

async function readCompanionApiError(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: string };
    if (typeof data.error === 'string' && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore malformed error payloads.
  }

  return `${response.status} ${response.statusText}`;
}

async function requestCompanionJson<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });

  if (!response.ok) {
    throw new Error(await readCompanionApiError(response));
  }

  return response.json() as Promise<T>;
}

function formatCompanionTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

export function DesktopCompanionSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'create-setup' | `revoke:${string}` | null>(null);
  const [hello, setHello] = useState<CompanionHelloState | null>(null);
  const [adminState, setAdminState] = useState<CompanionAdminState | null>(null);
  const [latestPairingCode, setLatestPairingCode] = useState<CompanionPairingCodeState | null>(null);
  const [latestSetup, setLatestSetup] = useState<CompanionSetupState | null>(null);
  const [selectedSetupLinkId, setSelectedSetupLinkId] = useState<string | null>(null);
  const [setupQrSvg, setSetupQrSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextHello, nextAdmin] = await Promise.all([
        requestCompanionJson<CompanionHelloState>('GET', '/companion/v1/hello'),
        requestCompanionJson<CompanionAdminState>('GET', '/companion/v1/admin/devices'),
      ]);
      setHello(nextHello);
      setAdminState(nextAdmin);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const selectedLink = latestSetup?.links.find((entry) => entry.id === selectedSetupLinkId)
      ?? latestSetup?.links[0]
      ?? null;
    if (!selectedLink) {
      setSetupQrSvg(null);
      return;
    }

    let active = true;
    void QRCode.toString(selectedLink.setupUrl, {
      type: 'svg',
      margin: 1,
      width: 240,
      color: {
        dark: '#111111',
        light: '#ffffff',
      },
    }).then((svg) => {
      if (active) {
        setSetupQrSvg(svg);
      }
    }).catch((nextError) => {
      if (active) {
        setSetupQrSvg(null);
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    });

    return () => {
      active = false;
    };
  }, [latestSetup, selectedSetupLinkId]);

  const handleCreatePairingCode = async () => {
    setAction('create-setup');
    setError(null);
    setNotice(null);
    try {
      const desktopBridge = getDesktopBridge();
      let enabledFromDesktop = false;
      if (desktopBridge) {
        const result = await desktopBridge.ensureCompanionNetworkReachable();
        enabledFromDesktop = result.changed;
      }

      const setup = await requestCompanionJson<CompanionSetupState>('POST', '/companion/v1/admin/setup');
      setLatestSetup(setup);
      setLatestPairingCode(setup.pairing);
      setSelectedSetupLinkId(setup.links[0]?.id ?? null);
      setNotice(
        setup.links.length > 0
          ? enabledFromDesktop
            ? 'Phone access enabled. Setup QR created.'
            : 'Setup QR created.'
          : 'Pairing code created, but the companion host is not reachable from other devices yet.',
      );
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    setAction(`revoke:${deviceId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await requestCompanionJson<{ devices: CompanionDeviceSummaryState[] }>('DELETE', `/companion/v1/admin/devices/${encodeURIComponent(deviceId)}`);
      setAdminState((current) => current ? { ...current, devices: result.devices } : { pendingPairings: [], devices: result.devices });
      setNotice('Paired device revoked.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  };

  const selectedSetupLink = latestSetup?.links.find((entry) => entry.id === selectedSetupLinkId)
    ?? latestSetup?.links[0]
    ?? null;

  return (
    <SettingsPanel
      title="Companion access"
      description="Generate phone setup QR codes and manage companion devices for the daemon-backed companion API. The desktop app will enable local-network phone access automatically when needed."
    >
      {loading ? <p className="ui-card-meta">Loading companion access state…</p> : null}
      {hello ? (
        <div className="space-y-1 text-[12px] text-secondary">
          <p><span className="text-primary">{hello.hostLabel}</span> · protocol {hello.protocolVersion}</p>
          <p className="font-mono text-[11px] text-dim break-all">{hello.hostInstanceId}</p>
        </div>
      ) : null}
      {notice ? <p className="text-[12px] text-accent">{notice}</p> : null}
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void handleCreatePairingCode(); }}
          disabled={action !== null}
          className={ACTION_BUTTON_CLASS}
        >
          {action === 'create-setup' ? 'Creating…' : 'Generate setup QR'}
        </button>
        <button
          type="button"
          onClick={() => { void refresh(); }}
          disabled={action !== null}
          className={ACTION_BUTTON_CLASS}
        >
          Refresh
        </button>
      </div>

      {latestPairingCode ? (
        <div className="space-y-3 rounded-2xl bg-surface/70 px-4 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/75">Latest pairing code</p>
            <p className="mt-2 font-mono text-[20px] tracking-[0.18em] text-primary">{latestPairingCode.code}</p>
            <p className="mt-2 text-[12px] text-secondary">Expires {formatCompanionTimestamp(latestPairingCode.expiresAt)}</p>
          </div>

          {latestSetup && latestSetup.links.length > 0 ? (
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/75">Phone setup QR</p>
                <p className="mt-1 text-[12px] text-secondary">Open the iPhone app and scan this QR from Pair host → Scan setup QR.</p>
              </div>

              {latestSetup.links.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {latestSetup.links.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      onClick={() => setSelectedSetupLinkId(link.id)}
                      className={cx(
                        ACTION_BUTTON_CLASS,
                        selectedSetupLink?.id === link.id ? 'border-accent bg-surface text-primary' : undefined,
                      )}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="w-fit rounded-2xl bg-white p-3 shadow-sm">
                  {setupQrSvg ? (
                    <div className="h-[240px] w-[240px] [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: setupQrSvg }} />
                  ) : (
                    <div className="flex h-[240px] w-[240px] items-center justify-center text-[12px] text-black/60">Rendering QR…</div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2 text-[12px] text-secondary">
                  <p><span className="text-primary">Base URL</span> · <span className="font-mono break-all">{selectedSetupLink?.baseUrl}</span></p>
                  <p><span className="text-primary">Route</span> · <span className="font-mono break-all">{selectedSetupLink?.label}</span></p>
                  <p className="text-[11px] text-dim">If the phone camera does not open the app directly, scan this QR inside the iPhone app instead.</p>
                </div>
              </div>
            </div>
          ) : latestSetup?.warnings.length ? (
            <div className="space-y-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] text-secondary">
              <p className="font-medium text-primary">Phone pairing needs a reachable host address.</p>
              {latestSetup.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h4 className="text-[14px] font-medium text-primary">Paired devices</h4>
          <p className="mt-1 text-[12px] text-secondary">Revoke a device here if you want it to sign in again.</p>
        </div>
        {adminState && adminState.devices.length > 0 ? (
          <div className="space-y-2">
            {adminState.devices.map((device) => (
              <div key={device.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-surface/70 px-4 py-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] font-medium text-primary">{device.deviceLabel}</p>
                  <p className="font-mono text-[11px] text-dim break-all">{device.id}</p>
                  <p className="text-[12px] text-secondary">Last used {formatCompanionTimestamp(device.lastUsedAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { void handleRevokeDevice(device.id); }}
                  disabled={action !== null}
                  className={ACTION_BUTTON_CLASS}
                >
                  {action === `revoke:${device.id}` ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="ui-card-meta">No paired devices yet.</p>
        )}
      </div>
    </SettingsPanel>
  );
}

function SettingsTableOfContents({
  items,
  activeId,
  onNavigate,
}: {
  items: readonly SettingsQuickLink[];
  activeId: SettingsQuickLinkId;
  onNavigate: (sectionId: SettingsQuickLinkId) => void;
}) {
  return (
    <AppPageToc
      items={items}
      activeId={activeId}
      onNavigate={onNavigate}
      ariaLabel="Settings sections"
    />
  );
}

export function DesktopConnectionsSettingsPanel() {
  const [environment, setEnvironment] = useState<DesktopEnvironmentState | null>(null);
  const [connections, setConnections] = useState<DesktopConnectionsState | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [draft, setDraft] = useState<DesktopHostDraft>(() => createDesktopHostDraft());
  const [appPreferencesState, setAppPreferencesState] = useState<DesktopAppPreferencesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'save' | 'delete' | 'save-app-preferences' | 'test-ssh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appPreferencesError, setAppPreferencesError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sshTestResult, setSshTestResult] = useState<DesktopSshConnectionTestResult | null>(null);

  const selectedHost = useMemo(
    () => connections?.hosts.find((host) => host.id === selectedHostId) ?? null,
    [connections, selectedHostId],
  );

  useEffect(() => {
    let cancelled = false;

    Promise.all([readDesktopEnvironment(), readDesktopConnections()])
      .then(([nextEnvironment, nextConnections]) => {
        if (cancelled) {
          return;
        }

        setEnvironment(nextEnvironment);
        setConnections(nextConnections);
        const firstHost = nextConnections?.hosts[0];
        if (firstHost) {
          setSelectedHostId(firstHost.id);
          setDraft(createDesktopHostDraft(firstHost));
        }
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setAppPreferencesState(null);
      return;
    }

    let cancelled = false;
    bridge.readDesktopAppPreferences()
      .then((state) => {
        if (!cancelled) {
          setAppPreferencesState(state as DesktopAppPreferencesState);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setAppPreferencesError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshDesktopAppPreferences = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    const state = await bridge.readDesktopAppPreferences();
    setAppPreferencesState(state as DesktopAppPreferencesState);
  };

  const refreshConnections = async () => {
    const nextConnections = await readDesktopConnections();
    setConnections(nextConnections);
    const firstHost = nextConnections?.hosts[0] ?? null;
    if (!firstHost || !nextConnections) {
      setSelectedHostId('');
      setDraft(createDesktopHostDraft());
      return;
    }

    const nextSelectedHost = nextConnections.hosts.find((host) => host.id === selectedHostId) ?? firstHost;
    setSelectedHostId(nextSelectedHost.id);
    setDraft(createDesktopHostDraft(nextSelectedHost));
  };

  function beginNewRemote() {
    setSelectedHostId('');
    setDraft(createDesktopHostDraft());
    setError(null);
    setNotice(null);
    setSshTestResult(null);
  }

  function selectRemote(host: Extract<DesktopHostRecord, { kind: 'ssh' }>) {
    setSelectedHostId(host.id);
    setDraft(createDesktopHostDraft(host));
    setError(null);
    setNotice(null);
    setSshTestResult(null);
  }

  function updateDraft(nextDraft: DesktopHostDraft | ((current: DesktopHostDraft) => DesktopHostDraft)) {
    setDraft((current) => (typeof nextDraft === 'function' ? nextDraft(current) : nextDraft));
    setSshTestResult(null);
    setError(null);
    setNotice(null);
  }

  async function handleUpdateAppPreferences(nextPreferences: { autoInstallUpdates?: boolean; startOnSystemStart?: boolean }) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setAppPreferencesError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    setAction('save-app-preferences');
    setAppPreferencesError(null);
    try {
      await bridge.updateDesktopAppPreferences(nextPreferences);
      await refreshDesktopAppPreferences();
      setNotice('Desktop app settings saved.');
    } catch (nextError) {
      setAppPreferencesError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleSave() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    const id = draft.id.trim();
    const label = draft.label.trim();
    const sshTarget = draft.sshTarget.trim();
    if (!id || !label || !sshTarget) {
      setError('Host id, label, and SSH target are required.');
      return;
    }

    setAction('save');
    setError(null);
    setNotice(null);
    try {
      await bridge.saveHost({
        id,
        label,
        kind: 'ssh',
        sshTarget,
      });
      await refreshConnections();
      setSelectedHostId(id);
      setDraft({ id, label, sshTarget });
      setNotice(selectedHostId ? 'SSH remote saved.' : 'SSH remote added.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleDelete(hostId: string) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    setAction('delete');
    setError(null);
    setNotice(null);
    setSshTestResult(null);
    try {
      await bridge.deleteHost(hostId);
      await refreshConnections();
      setNotice('SSH remote deleted.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleTestSshConnection() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    const sshTarget = draft.sshTarget.trim();
    if (!sshTarget) {
      setError('Enter an SSH target before testing the connection.');
      setSshTestResult(null);
      return;
    }

    setAction('test-ssh');
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.testSshConnection({ sshTarget });
      setSshTestResult(result);
      setNotice('SSH connection works.');
    } catch (nextError) {
      setSshTestResult(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  return (
    <SettingsSection
      id="settings-desktop"
      label="Desktop"
      description="Manage local app behavior and SSH remotes."
      className="order-4"
    >
      <SettingsPanel
        title="App behavior"
        description="Control how the menu bar app starts and how downloaded updates install."
      >
        {!getDesktopBridge() && isDesktopShell() ? (
          <p className="text-[12px] text-danger">
            Desktop bridge unavailable. Restart the desktop app and try again.
          </p>
        ) : null}
        {appPreferencesState ? (
          <div className="space-y-4">
            <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="desktop-auto-install-updates">
              <input
                id="desktop-auto-install-updates"
                type="checkbox"
                checked={appPreferencesState.autoInstallUpdates}
                onChange={(event) => {
                  void handleUpdateAppPreferences({ autoInstallUpdates: event.target.checked });
                }}
                disabled={action !== null || !appPreferencesState.update.supported}
                className={CHECKBOX_CLASS}
              />
              <span>Install downloaded updates automatically when the desktop is idle</span>
            </label>
            <p className="ui-card-meta break-words">{formatDesktopUpdateSummary(appPreferencesState)}</p>

            <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="desktop-start-on-system-start">
              <input
                id="desktop-start-on-system-start"
                type="checkbox"
                checked={appPreferencesState.startOnSystemStart}
                onChange={(event) => {
                  void handleUpdateAppPreferences({ startOnSystemStart: event.target.checked });
                }}
                disabled={action !== null || !appPreferencesState.supportsStartOnSystemStart}
                className={CHECKBOX_CLASS}
              />
              <span>Start Personal Agent when you sign in</span>
            </label>
            <p className="ui-card-meta break-words">{formatStartOnSystemStartSummary(appPreferencesState)}</p>
          </div>
        ) : (
          <p className="ui-card-meta">Loading desktop app settings…</p>
        )}
        {appPreferencesError ? <p className="text-[12px] text-danger">{appPreferencesError}</p> : null}
      </SettingsPanel>

      <DesktopCompanionSettingsPanel />

      <SettingsPanel
        id="desktop-connections"
        title="SSH remotes"
        description="Saved SSH targets for remote conversations. Personal Agent copies the matching Pi release binary and a transient helper when a conversation targets one."
      >
        {loading ? <p className="ui-card-meta">Loading SSH remotes…</p> : null}
        {environment ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-secondary">
            <div className="inline-flex min-w-0 items-center gap-2">
              <DesktopRuntimeIcon className="shrink-0 text-dim/80" />
              <span className="truncate">
                Desktop runtime <span className="text-primary">{environment.activeHostLabel}</span> · {environment.activeHostSummary}
              </span>
            </div>
            <span className="text-dim">{connections?.hosts.length ?? 0} saved</span>
          </div>
        ) : null}
        {notice ? <p className="text-[12px] text-accent">{notice}</p> : null}
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        {connections ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] xl:items-start">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-medium text-primary">Saved remotes</h3>
                  <p className="mt-1 text-[12px] text-secondary">Use SSH aliases from <span className="font-mono text-[11px]">~/.ssh/config</span> or full targets.</p>
                </div>
                <button
                  type="button"
                  onClick={beginNewRemote}
                  disabled={action !== null}
                  className={ACTION_BUTTON_CLASS}
                >
                  New remote
                </button>
              </div>

              {connections.hosts.length > 0 ? (
                <div className="space-y-1.5">
                  {connections.hosts.map((host) => {
                    const selected = host.id === selectedHostId;
                    return (
                      <button
                        key={host.id}
                        type="button"
                        onClick={() => { selectRemote(host); }}
                        disabled={action !== null}
                        className={cx(
                          'group flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
                          selected
                            ? 'bg-accent/6 text-primary ring-1 ring-accent/15'
                            : 'text-secondary hover:bg-surface hover:text-primary',
                        )}
                      >
                        <SshRemoteIcon className={cx('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-dim/80 group-hover:text-accent')} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-[13px] font-medium text-primary">{host.label}</span>
                            {selected ? <span className="text-[11px] text-accent">Editing</span> : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-secondary">
                            <span className="font-mono text-dim">{host.id}</span>
                            <span className="text-dim/70">·</span>
                            <span className="min-w-0 truncate font-mono text-primary/90">{formatDesktopHostDetails(host)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-surface/70 px-4 py-4">
                  <p className="text-[13px] font-medium text-primary">No remotes yet</p>
                  <p className="mt-1 text-[12px] leading-5 text-secondary">Add an SSH target here, then pick it per conversation from the footer.</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-[15px] font-medium text-primary">{selectedHost ? selectedHost.label : 'New SSH remote'}</h3>
                  <p className="text-[12px] text-secondary">
                    {selectedHost
                      ? `${selectedHost.id} · ${selectedHost.sshTarget}`
                      : 'The desktop UI stays local. Remote execution happens per conversation over SSH.'}
                  </p>
                </div>
                {selectedHost ? (
                  <button
                    type="button"
                    onClick={() => { void handleDelete(selectedHost.id); }}
                    disabled={action !== null}
                    className={ACTION_BUTTON_CLASS}
                  >
                    {action === 'delete' ? 'Deleting…' : 'Delete remote'}
                  </button>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 min-w-0">
                  <label className="ui-card-meta" htmlFor="desktop-host-id">Host id</label>
                  <input
                    id="desktop-host-id"
                    value={draft.id}
                    onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))}
                    disabled={action !== null || Boolean(selectedHost)}
                    className={`${INPUT_CLASS} font-mono text-[13px]`}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="bender"
                  />
                  <p className="text-[11px] text-dim">Stable id used by saved conversations.</p>
                </div>
                <div className="space-y-2 min-w-0">
                  <label className="ui-card-meta" htmlFor="desktop-host-label">Label</label>
                  <input
                    id="desktop-host-label"
                    value={draft.label}
                    onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))}
                    disabled={action !== null}
                    className={INPUT_CLASS}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Bender"
                  />
                  <p className="text-[11px] text-dim">Shown in the conversation target picker.</p>
                </div>
                <div className="space-y-2 min-w-0 md:col-span-2">
                  <label className="ui-card-meta" htmlFor="desktop-host-ssh-target">SSH target</label>
                  <input
                    id="desktop-host-ssh-target"
                    value={draft.sshTarget}
                    onChange={(event) => updateDraft((current) => ({ ...current, sshTarget: event.target.value }))}
                    disabled={action !== null}
                    className={`${INPUT_CLASS} font-mono text-[13px]`}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="patrick@desktop-gpu"
                  />
                  <p className="text-[11px] text-dim">Use a host alias or any target that works with your normal <span className="font-mono">ssh</span> command.</p>
                </div>
              </div>

              <div className="space-y-1.5 text-[12px] text-secondary">
                <p>First use copies the exact local Pi release and a transient helper to the remote cache.</p>
                <p>Remote threads run in detached per-conversation runtimes, and the footer directory browser picks the real remote cwd.</p>
              </div>

              {sshTestResult && sshTestResult.sshTarget === draft.sshTarget.trim() ? (
                <div className="rounded-2xl bg-surface/70 px-4 py-4 text-[12px] text-secondary">
                  <p className="font-medium text-primary">{formatSshTestPlatformLabel(sshTestResult)}</p>
                  <p className="mt-1 break-words">{formatSshTestSummary(sshTestResult)}</p>
                  <div className="mt-2 space-y-1 font-mono text-[11px] text-dim">
                    <p>home {sshTestResult.homeDirectory}</p>
                    <p>tmp {sshTestResult.tempDirectory}</p>
                    <p>cache {sshTestResult.cacheDirectory}</p>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void handleTestSshConnection(); }}
                  disabled={action !== null}
                  className={ACTION_BUTTON_CLASS}
                >
                  {action === 'test-ssh' ? 'Testing…' : 'Test SSH'}
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSave(); }}
                  disabled={action !== null}
                  className={ACTION_BUTTON_CLASS}
                >
                  {action === 'save' ? 'Saving…' : selectedHost ? 'Save changes' : 'Add remote'}
                </button>
                {selectedHost ? (
                  <button
                    type="button"
                    onClick={beginNewRemote}
                    disabled={action !== null}
                    className={ACTION_BUTTON_CLASS}
                  >
                    Add another
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </SettingsPanel>
    </SettingsSection>
  );
}

export function SettingsPage() {
  const { theme, themePreference, setThemePreference } = useTheme();
  const {
    data: skillFoldersState,
    loading: skillFoldersLoading,
    error: skillFoldersError,
    refetch: refetchSkillFolders,
  } = useApi(api.skillFolders);
  const {
    data: instructionFilesState,
    loading: instructionFilesLoading,
    error: instructionFilesError,
    refetch: refetchInstructions,
  } = useApi(api.instructions);
  const {
    data: modelState,
    loading: modelsLoading,
    error: modelsError,
    refetch: refetchModels,
  } = useApi(api.models);
  const {
    data: toolsState,
    loading: toolsLoading,
    error: toolsError,
  } = useApi(api.tools);
  const {
    data: modelProviderState,
    loading: modelProviderLoading,
    error: modelProviderError,
    replaceData: replaceModelProviderState,
  } = useApi(api.modelProviders);
  const {
    data: vaultRootState,
    loading: vaultRootLoading,
    error: vaultRootLoadError,
    refetch: refetchVaultRoot,
  } = useApi(api.vaultRoot);
  const {
    data: knowledgeBaseState,
    loading: knowledgeBaseLoading,
    error: knowledgeBaseLoadError,
    refetch: refetchKnowledgeBase,
  } = useApi(api.knowledgeBase);
  const {
    data: defaultCwdState,
    loading: defaultCwdLoading,
    error: defaultCwdLoadError,
    refetch: refetchDefaultCwd,
  } = useApi(api.defaultCwd);
  const {
    data: conversationTitleState,
    loading: conversationTitleLoading,
    error: conversationTitleError,
    refetch: refetchConversationTitleSettings,
  } = useApi(api.conversationTitleSettings);
  const {
    data: providerAuthState,
    loading: providerAuthLoading,
    error: providerAuthError,
    refetch: refetchProviderAuth,
  } = useApi(api.providerAuth);
  const [skillFoldersDraft, setSkillFoldersDraft] = useState<string[]>([]);
  const [savingSkillFolders, setSavingSkillFolders] = useState(false);
  const [skillFoldersSaveError, setSkillFoldersSaveError] = useState<string | null>(null);
  const [instructionFilesDraft, setInstructionFilesDraft] = useState<string[]>([]);
  const [savingInstructionFiles, setSavingInstructionFiles] = useState(false);
  const [instructionFilesSaveError, setInstructionFilesSaveError] = useState<string | null>(null);
  const [savingPreference, setSavingPreference] = useState<'model' | 'thinking' | 'serviceTier' | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [vaultRootDraft, setVaultRootDraft] = useState('');
  const [savingVaultRoot, setSavingVaultRoot] = useState(false);
  const [vaultRootSaveError, setVaultRootSaveError] = useState<string | null>(null);
  const [knowledgeBaseRepoUrlDraft, setKnowledgeBaseRepoUrlDraft] = useState('');
  const [knowledgeBaseBranchDraft, setKnowledgeBaseBranchDraft] = useState('main');
  const [knowledgeBaseAction, setKnowledgeBaseAction] = useState<'save' | 'sync' | null>(null);
  const [knowledgeBaseSaveError, setKnowledgeBaseSaveError] = useState<string | null>(null);
  const [defaultCwdDraft, setDefaultCwdDraft] = useState('');
  const [savingDefaultCwd, setSavingDefaultCwd] = useState(false);
  const [defaultCwdSaveError, setDefaultCwdSaveError] = useState<string | null>(null);
  const [pathPickerTarget, setPathPickerTarget] = useState<'vault-root' | 'default-cwd' | 'skill-folders' | 'instruction-files' | null>(null);
  const [savingConversationTitle, setSavingConversationTitle] = useState<'enabled' | 'model' | null>(null);
  const [conversationTitleSaveError, setConversationTitleSaveError] = useState<string | null>(null);
  const [selectedModelProviderId, setSelectedModelProviderId] = useState('');
  const [modelProviderDraft, setModelProviderDraft] = useState<ProviderEditorDraft>(() => createProviderEditorDraft(null));
  const [modelProviderAction, setModelProviderAction] = useState<'save' | 'delete' | null>(null);
  const [modelProviderMessage, setModelProviderMessage] = useState<string | null>(null);
  const [modelProviderEditorError, setModelProviderEditorError] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelEditorDraft>(() => createModelEditorDraft(null));
  const [modelDraftAction, setModelDraftAction] = useState<'save' | 'delete' | null>(null);
  const [modelDraftMessage, setModelDraftMessage] = useState<string | null>(null);
  const [modelDraftError, setModelDraftError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerCredentialAction, setProviderCredentialAction] = useState<'saveKey' | 'remove' | null>(null);
  const [providerCredentialError, setProviderCredentialError] = useState<string | null>(null);
  const [providerCredentialNotice, setProviderCredentialNotice] = useState<string | null>(null);
  const [oauthLoginState, setOauthLoginState] = useState<ProviderOAuthLoginState | null>(null);
  const [oauthAction, setOauthAction] = useState<'start' | 'submit' | 'cancel' | null>(null);
  const [oauthInputValue, setOauthInputValue] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  const oauthTerminalStateKeyRef = useRef<string | null>(null);
  const [desktopEnvironment, setDesktopEnvironment] = useState<DesktopEnvironmentState | null>(null);
  const [resetting, setResetting] = useState<'layout' | 'conversation' | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const settingsScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeQuickLinkId, setActiveQuickLinkId] = useState<SettingsQuickLinkId>(SETTINGS_QUICK_LINKS[0].id);

  const visibleQuickLinks = useMemo<readonly SettingsQuickLink[]>(
    () => (desktopEnvironment?.isElectron || isDesktopShell())
      ? SETTINGS_QUICK_LINKS
      : SETTINGS_QUICK_LINKS.filter((item) => item.id !== 'settings-desktop'),
    [desktopEnvironment?.isElectron],
  );

  useEffect(() => {
    let cancelled = false;

    readDesktopEnvironment()
      .then((environment) => {
        if (!cancelled) {
          setDesktopEnvironment(environment);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopEnvironment(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (visibleQuickLinks.some((item) => item.id === activeQuickLinkId)) {
      return;
    }

    const nextId = visibleQuickLinks[0]?.id ?? SETTINGS_QUICK_LINKS[0].id;
    setActiveQuickLinkId(nextId);
  }, [activeQuickLinkId, visibleQuickLinks]);

  useEffect(() => {
    const container = settingsScrollRef.current;
    if (!container || typeof window === 'undefined' || visibleQuickLinks.length === 0) {
      return undefined;
    }

    let frame: number | null = null;
    const updateActiveQuickLink = () => {
      frame = null;
      const containerTop = container.getBoundingClientRect().top;
      let nextId = visibleQuickLinks[0].id;

      for (const item of visibleQuickLinks) {
        const section = container.querySelector<HTMLElement>(`#${item.id}`);
        if (!section) {
          continue;
        }

        if (section.getBoundingClientRect().top - containerTop <= 96) {
          nextId = item.id;
        }
      }

      setActiveQuickLinkId((current) => (current === nextId ? current : nextId));
    };

    const scheduleUpdate = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(updateActiveQuickLink);
    };

    scheduleUpdate();
    container.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      container.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [visibleQuickLinks]);

  const groupedModels = useMemo(
    () => groupModelsByProvider(modelState?.models ?? []),
    [modelState?.models],
  );

  const selectedModel = useMemo(() => {
    if (!modelState?.currentModel) {
      return null;
    }

    return modelState.models.find((model) => model.id === modelState.currentModel) ?? null;
  }, [modelState]);

  const selectedModelServiceTierOptions = useMemo(
    () => getModelSelectableServiceTierOptions(selectedModel),
    [selectedModel],
  );
  const selectedModelSupportsFastMode = useMemo(
    () => selectedModelServiceTierOptions.some((option) => option.value === 'priority'),
    [selectedModelServiceTierOptions],
  );

  const selectedConversationTitleModel = useMemo(
    () => findModelByRef(modelState?.models ?? [], conversationTitleState?.currentModel ?? ''),
    [conversationTitleState?.currentModel, modelState?.models],
  );

  const effectiveConversationTitleModel = useMemo(
    () => findModelByRef(modelState?.models ?? [], conversationTitleState?.effectiveModel ?? ''),
    [conversationTitleState?.effectiveModel, modelState?.models],
  );

  const selectedModelProvider = useMemo(() => {
    if (!modelProviderState || !selectedModelProviderId || selectedModelProviderId === NEW_MODEL_PROVIDER_ID) {
      return null;
    }

    return modelProviderState.providers.find((provider) => provider.id === selectedModelProviderId) ?? null;
  }, [modelProviderState, selectedModelProviderId]);

  const editingProviderModel = useMemo(() => {
    if (!selectedModelProvider || !editingModelId || editingModelId === NEW_MODEL_ID) {
      return null;
    }

    return selectedModelProvider.models.find((model) => model.id === editingModelId) ?? null;
  }, [editingModelId, selectedModelProvider]);

  const selectedProvider = useMemo(() => {
    if (!providerAuthState || !selectedProviderId) {
      return null;
    }

    return providerAuthState.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  }, [providerAuthState, selectedProviderId]);

  const vaultRootDirty = vaultRootState
    ? vaultRootDraft.trim() !== vaultRootState.currentRoot
    : false;
  const knowledgeBaseDirty = knowledgeBaseState
    ? knowledgeBaseRepoUrlDraft.trim() !== knowledgeBaseState.repoUrl
      || knowledgeBaseBranchDraft.trim() !== knowledgeBaseState.branch
    : false;
  const vaultRootManagedByKnowledgeBase = vaultRootState?.source === 'knowledge-base';
  const knowledgeBaseSyncPresentation = useMemo(
    () => getKnowledgeBaseSyncPresentation(knowledgeBaseState, { includeLastSyncAt: true }),
    [knowledgeBaseState],
  );
  const defaultCwdDirty = defaultCwdState
    ? defaultCwdDraft.trim() !== defaultCwdState.currentCwd
    : false;
  const skillFoldersDirty = skillFoldersState
    ? skillFoldersDraft.length !== skillFoldersState.skillDirs.length
      || skillFoldersDraft.some((value, index) => value !== skillFoldersState.skillDirs[index])
    : false;
  const instructionFilesDirty = instructionFilesState
    ? instructionFilesDraft.length !== instructionFilesState.instructionFiles.length
      || instructionFilesDraft.some((value, index) => value !== instructionFilesState.instructionFiles[index])
    : false;
  const pickingVaultRoot = pathPickerTarget === 'vault-root';
  const pickingDefaultCwd = pathPickerTarget === 'default-cwd';
  const pickingSkillFolders = pathPickerTarget === 'skill-folders';
  const pickingInstructionFiles = pathPickerTarget === 'instruction-files';

  useInvalidateOnTopics(['knowledgeBase'], refetchKnowledgeBase);

  useEffect(() => {
    if (vaultRootState) {
      setVaultRootDraft(vaultRootState.currentRoot);
    }
  }, [vaultRootState?.currentRoot]);

  useEffect(() => {
    if (knowledgeBaseState) {
      setKnowledgeBaseRepoUrlDraft(knowledgeBaseState.repoUrl);
      setKnowledgeBaseBranchDraft(knowledgeBaseState.branch);
    }
  }, [knowledgeBaseState?.repoUrl, knowledgeBaseState?.branch]);

  useEffect(() => {
    if (defaultCwdState) {
      setDefaultCwdDraft(defaultCwdState.currentCwd);
    }
  }, [defaultCwdState?.currentCwd]);

  useEffect(() => {
    if (skillFoldersState) {
      setSkillFoldersDraft(skillFoldersState.skillDirs);
    }
  }, [skillFoldersState?.configFile, skillFoldersState?.skillDirs]);

  useEffect(() => {
    if (instructionFilesState) {
      setInstructionFilesDraft(instructionFilesState.instructionFiles);
    }
  }, [instructionFilesState?.configFile, instructionFilesState?.instructionFiles]);

  useEffect(() => {
    if (!modelProviderState) {
      return;
    }

    if (!selectedModelProviderId) {
      if (modelProviderState.providers.length > 0) {
        const firstProvider = modelProviderState.providers[0] ?? null;
        setSelectedModelProviderId(firstProvider?.id ?? NEW_MODEL_PROVIDER_ID);
        setModelProviderDraft(createProviderEditorDraft(firstProvider));
      } else {
        setSelectedModelProviderId(NEW_MODEL_PROVIDER_ID);
        setModelProviderDraft(createProviderEditorDraft(null));
      }
      return;
    }

    if (selectedModelProviderId !== NEW_MODEL_PROVIDER_ID) {
      const selectedStillExists = modelProviderState.providers.some((provider) => provider.id === selectedModelProviderId);
      if (!selectedStillExists) {
        const firstProvider = modelProviderState.providers[0] ?? null;
        setSelectedModelProviderId(firstProvider?.id ?? NEW_MODEL_PROVIDER_ID);
        setModelProviderDraft(createProviderEditorDraft(firstProvider));
        setEditingModelId(null);
        setModelDraft(createModelEditorDraft(null));
      }
    }
  }, [modelProviderState, selectedModelProviderId]);

  useEffect(() => {
    if (!providerAuthState || providerAuthState.providers.length === 0) {
      if (selectedProviderId) {
        setSelectedProviderId('');
      }
      return;
    }

    const selectedStillExists = providerAuthState.providers.some((provider) => provider.id === selectedProviderId);
    if (!selectedStillExists) {
      setSelectedProviderId(providerAuthState.providers[0]?.id ?? '');
    }
  }, [providerAuthState, selectedProviderId]);

  useEffect(() => {
    setProviderApiKey('');
    setProviderCredentialError(null);
    setProviderCredentialNotice(null);
    setOauthError(null);
    setOauthInputValue('');

    if (oauthLoginState && oauthLoginState.provider !== selectedProviderId) {
      setOauthLoginState(null);
      setOauthAction(null);
    }
  }, [selectedProviderId]);

  useEffect(() => {
    if (!oauthLoginState?.id || oauthLoginState.status !== 'running') {
      return;
    }

    const loginId = oauthLoginState.id;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const desktopBridge = getDesktopBridge();
      if (desktopBridge && desktopEnvironment?.activeHostKind === 'local') {
        try {
          cleanup = await subscribeDesktopProviderOAuthLogin(loginId, setOauthLoginState);
          if (cancelled) {
            cleanup();
          }
          return;
        } catch {
          // Fall through to the desktop-aware EventSource bridge.
        }
      }

      const stream = createDesktopAwareEventSource(`/api/provider-auth/oauth/${encodeURIComponent(loginId)}/events`);
      stream.onmessage = (event) => {
        let payload: ProviderOAuthLoginStreamEvent;
        try {
          payload = JSON.parse(event.data) as ProviderOAuthLoginStreamEvent;
        } catch {
          return;
        }

        if (payload.type === 'snapshot') {
          setOauthLoginState(payload.data);
        }
      };
      cleanup = () => {
        stream.close();
      };
      if (cancelled) {
        cleanup();
      }
    })().catch(() => {
      // Ignore best-effort OAuth bridge setup failures here.
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [desktopEnvironment?.activeHostKind, oauthLoginState?.id, oauthLoginState?.status]);

  useEffect(() => {
    if (!oauthLoginState?.id) {
      oauthTerminalStateKeyRef.current = null;
      return;
    }

    if (oauthLoginState.status === 'running') {
      oauthTerminalStateKeyRef.current = null;
      return;
    }

    const terminalKey = `${oauthLoginState.id}:${oauthLoginState.status}:${oauthLoginState.updatedAt}`;
    if (oauthTerminalStateKeyRef.current === terminalKey) {
      return;
    }

    oauthTerminalStateKeyRef.current = terminalKey;
    setOauthAction(null);

    if (oauthLoginState.status === 'completed') {
      setOauthError(null);
      setOauthInputValue('');
      setProviderCredentialNotice(`Logged in to ${oauthLoginState.providerName}.`);
      void Promise.all([
        refetchProviderAuth({ resetLoading: false }),
        refetchModels({ resetLoading: false }),
      ]);
      return;
    }

    if (oauthLoginState.status === 'failed') {
      setOauthError(oauthLoginState.error || `OAuth login failed for ${oauthLoginState.provider}.`);
    }
  }, [oauthLoginState, refetchModels, refetchProviderAuth]);

  const selectedProviderLogin = oauthLoginState && selectedProvider && oauthLoginState.provider === selectedProvider.id
    ? oauthLoginState
    : null;

  async function handleAddSkillFolder() {
    if (!skillFoldersState || savingSkillFolders || pickingSkillFolders) {
      return;
    }

    setSkillFoldersSaveError(null);
    setPathPickerTarget('skill-folders');

    try {
      const result = await api.pickFolder({
        cwd: defaultCwdState?.effectiveCwd,
        prompt: 'Choose skill folder',
      });
      if (result.cancelled || !result.path) {
        return;
      }

      setSkillFoldersDraft((current) => current.includes(result.path)
        ? current
        : [...current, result.path]);
    } catch (error) {
      setSkillFoldersSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setPathPickerTarget((current) => (current === 'skill-folders' ? null : current));
    }
  }

  function handleMoveSkillFolder(index: number, direction: -1 | 1) {
    setSkillFoldersDraft((current) => {
      const nextIndex = index + direction;
      if (index < 0 || index >= current.length || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [entry] = next.splice(index, 1);
      next.splice(nextIndex, 0, entry as string);
      return next;
    });
    setSkillFoldersSaveError(null);
  }

  function handleRemoveSkillFolder(index: number) {
    setSkillFoldersDraft((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setSkillFoldersSaveError(null);
  }

  async function handleSaveSkillFolders() {
    if (!skillFoldersState || savingSkillFolders || !skillFoldersDirty) {
      return;
    }

    setSkillFoldersSaveError(null);
    setSavingSkillFolders(true);

    try {
      const saved = await api.updateSkillFolders(skillFoldersDraft);
      setSkillFoldersDraft(saved.skillDirs);
      await refetchSkillFolders({ resetLoading: false });
    } catch (error) {
      setSkillFoldersSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSkillFolders(false);
    }
  }

  async function handleAddInstructionFiles() {
    if (!instructionFilesState || savingInstructionFiles || pickingInstructionFiles) {
      return;
    }

    setInstructionFilesSaveError(null);
    setPathPickerTarget('instruction-files');

    try {
      const result = await api.pickFiles(defaultCwdState?.effectiveCwd);
      if (result.cancelled || result.paths.length === 0) {
        return;
      }

      setInstructionFilesDraft((current) => {
        const next = [...current];
        for (const path of result.paths) {
          if (!next.includes(path)) {
            next.push(path);
          }
        }
        return next;
      });
    } catch (error) {
      setInstructionFilesSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setPathPickerTarget((current) => (current === 'instruction-files' ? null : current));
    }
  }

  function handleMoveInstructionFile(index: number, direction: -1 | 1) {
    setInstructionFilesDraft((current) => {
      const nextIndex = index + direction;
      if (index < 0 || index >= current.length || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [entry] = next.splice(index, 1);
      next.splice(nextIndex, 0, entry as string);
      return next;
    });
    setInstructionFilesSaveError(null);
  }

  function handleRemoveInstructionFile(index: number) {
    setInstructionFilesDraft((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setInstructionFilesSaveError(null);
  }

  async function handleSaveInstructionFiles() {
    if (!instructionFilesState || savingInstructionFiles || !instructionFilesDirty) {
      return;
    }

    setInstructionFilesSaveError(null);
    setSavingInstructionFiles(true);

    try {
      const saved = await api.updateInstructions(instructionFilesDraft);
      setInstructionFilesDraft(saved.instructionFiles);
      await refetchInstructions({ resetLoading: false });
    } catch (error) {
      setInstructionFilesSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingInstructionFiles(false);
    }
  }

  async function handleModelPreferenceChange(input: { model?: string; thinkingLevel?: string; serviceTier?: string }, field: 'model' | 'thinking' | 'serviceTier') {
    if (!modelState || savingPreference !== null) {
      return;
    }

    if (field === 'model' && (!input.model || input.model === modelState.currentModel)) {
      return;
    }

    if (field === 'thinking' && input.thinkingLevel === modelState.currentThinkingLevel) {
      return;
    }

    if (field === 'serviceTier' && input.serviceTier === modelState.currentServiceTier) {
      return;
    }

    setModelError(null);
    setSavingPreference(field);

    try {
      await api.updateModelPreferences(input);
      await refetchModels({ resetLoading: false });
      await refetchConversationTitleSettings({ resetLoading: false });
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingPreference(null);
    }
  }

  async function handleVaultRootSave(nextRoot: string | null = vaultRootDraft) {
    if (!vaultRootState || savingVaultRoot || vaultRootManagedByKnowledgeBase) {
      return;
    }

    const normalizedRoot = (nextRoot ?? '').trim();
    if (normalizedRoot === vaultRootState.currentRoot) {
      return;
    }

    setVaultRootSaveError(null);
    setSavingVaultRoot(true);

    try {
      const saved = await api.updateVaultRoot(normalizedRoot || null);
      setVaultRootDraft(saved.currentRoot);
      await refetchVaultRoot({ resetLoading: false });
    } catch (error) {
      setVaultRootSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingVaultRoot(false);
    }
  }

  async function handleKnowledgeBaseSave(nextInput?: { repoUrl?: string | null; branch?: string | null }) {
    if (!knowledgeBaseState || knowledgeBaseAction !== null) {
      return;
    }

    const repoUrl = typeof nextInput?.repoUrl === 'string'
      ? nextInput.repoUrl.trim()
      : knowledgeBaseRepoUrlDraft.trim();
    const branch = typeof nextInput?.branch === 'string'
      ? nextInput.branch.trim()
      : knowledgeBaseBranchDraft.trim();
    if (!nextInput && !knowledgeBaseDirty) {
      return;
    }

    setKnowledgeBaseSaveError(null);
    setKnowledgeBaseAction('save');

    try {
      const saved = await api.updateKnowledgeBase({
        repoUrl: repoUrl || null,
        branch: branch || null,
      });
      setKnowledgeBaseRepoUrlDraft(saved.repoUrl);
      setKnowledgeBaseBranchDraft(saved.branch);
      await Promise.all([
        refetchKnowledgeBase({ resetLoading: false }),
        refetchVaultRoot({ resetLoading: false }),
      ]);
    } catch (error) {
      setKnowledgeBaseSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setKnowledgeBaseAction(null);
    }
  }

  async function handleKnowledgeBaseSync() {
    if (!knowledgeBaseState || !knowledgeBaseState.configured || knowledgeBaseAction !== null) {
      return;
    }

    setKnowledgeBaseSaveError(null);
    setKnowledgeBaseAction('sync');

    try {
      const synced = await api.syncKnowledgeBase();
      setKnowledgeBaseRepoUrlDraft(synced.repoUrl);
      setKnowledgeBaseBranchDraft(synced.branch);
      await Promise.all([
        refetchKnowledgeBase({ resetLoading: false }),
        refetchVaultRoot({ resetLoading: false }),
      ]);
    } catch (error) {
      setKnowledgeBaseSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setKnowledgeBaseAction(null);
    }
  }

  async function handleDefaultCwdSave(nextCwd: string | null = defaultCwdDraft) {
    if (!defaultCwdState || savingDefaultCwd) {
      return;
    }

    const normalizedCwd = (nextCwd ?? '').trim();
    if (normalizedCwd === defaultCwdState.currentCwd) {
      return;
    }

    setDefaultCwdSaveError(null);
    setSavingDefaultCwd(true);

    try {
      const saved = await api.updateDefaultCwd(normalizedCwd || null);
      setDefaultCwdDraft(saved.currentCwd);
      await refetchDefaultCwd({ resetLoading: false });
    } catch (error) {
      setDefaultCwdSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingDefaultCwd(false);
    }
  }

  async function handleVaultRootPick() {
    if (!vaultRootState || savingVaultRoot || pickingVaultRoot || vaultRootManagedByKnowledgeBase) {
      return;
    }

    setVaultRootSaveError(null);
    setPathPickerTarget('vault-root');

    try {
      const result = await api.pickFolder({
        cwd: vaultRootDraft.trim() || vaultRootState.effectiveRoot,
        prompt: 'Choose indexed root',
      });
      if (result.cancelled || !result.path) {
        return;
      }

      setVaultRootDraft(result.path);
      await handleVaultRootSave(result.path);
    } catch (error) {
      setVaultRootSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setPathPickerTarget((current) => (current === 'vault-root' ? null : current));
    }
  }

  async function handleDefaultCwdPick() {
    if (!defaultCwdState || savingDefaultCwd || pickingDefaultCwd) {
      return;
    }

    setDefaultCwdSaveError(null);
    setPathPickerTarget('default-cwd');

    try {
      const result = await api.pickFolder({
        cwd: defaultCwdDraft.trim() || defaultCwdState.effectiveCwd,
        prompt: 'Choose default working directory',
      });
      if (result.cancelled || !result.path) {
        return;
      }

      setDefaultCwdDraft(result.path);
      await handleDefaultCwdSave(result.path);
    } catch (error) {
      setDefaultCwdSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setPathPickerTarget((current) => (current === 'default-cwd' ? null : current));
    }
  }

  async function handleConversationTitleSettingChange(
    input: { enabled?: boolean; model?: string | null },
    field: 'enabled' | 'model',
  ) {
    if (!conversationTitleState || savingConversationTitle !== null) {
      return;
    }

    if (field === 'enabled' && input.enabled === conversationTitleState.enabled) {
      return;
    }

    if (field === 'model' && (input.model ?? '') === conversationTitleState.currentModel) {
      return;
    }

    setConversationTitleSaveError(null);
    setSavingConversationTitle(field);

    try {
      await api.updateConversationTitleSettings(input);
      await refetchConversationTitleSettings({ resetLoading: false });
    } catch (error) {
      setConversationTitleSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingConversationTitle(null);
    }
  }

  function selectModelProvider(providerId: string) {
    if (providerId === NEW_MODEL_PROVIDER_ID) {
      setSelectedModelProviderId(NEW_MODEL_PROVIDER_ID);
      setModelProviderDraft(createProviderEditorDraft(null));
      setEditingModelId(null);
      setModelDraft(createModelEditorDraft(null));
    } else {
      const provider = modelProviderState?.providers.find((candidate) => candidate.id === providerId) ?? null;
      setSelectedModelProviderId(providerId);
      setModelProviderDraft(createProviderEditorDraft(provider));
      setEditingModelId(null);
      setModelDraft(createModelEditorDraft(null));
    }

    setModelProviderEditorError(null);
    setModelProviderMessage(null);
    setModelDraftError(null);
    setModelDraftMessage(null);
  }

  function startEditingProviderModel(modelId: string) {
    if (modelId === NEW_MODEL_ID) {
      setEditingModelId(NEW_MODEL_ID);
      setModelDraft(createModelEditorDraft(null));
    } else {
      const model = selectedModelProvider?.models.find((candidate) => candidate.id === modelId) ?? null;
      setEditingModelId(modelId);
      setModelDraft(createModelEditorDraft(model));
    }

    setModelDraftError(null);
    setModelDraftMessage(null);
  }

  function syncModelProviderSelection(nextState: ModelProviderState, providerId: string, nextModelId: string | null = null) {
    replaceModelProviderState(nextState);

    const provider = nextState.providers.find((candidate) => candidate.id === providerId) ?? null;
    if (!provider) {
      setSelectedModelProviderId(NEW_MODEL_PROVIDER_ID);
      setModelProviderDraft(createProviderEditorDraft(null));
      setEditingModelId(null);
      setModelDraft(createModelEditorDraft(null));
      return;
    }

    setSelectedModelProviderId(provider.id);
    setModelProviderDraft(createProviderEditorDraft(provider));

    if (!nextModelId) {
      setEditingModelId(null);
      setModelDraft(createModelEditorDraft(null));
      return;
    }

    const model = provider.models.find((candidate) => candidate.id === nextModelId) ?? null;
    setEditingModelId(model ? model.id : null);
    setModelDraft(createModelEditorDraft(model));
  }

  async function handleSaveModelProvider() {
    const providerId = modelProviderDraft.id.trim();
    if (!providerId || modelProviderAction !== null) {
      if (!providerId) {
        setModelProviderEditorError('Provider id is required.');
      }
      return;
    }

    try {
      const headers = parseOptionalStringRecord(modelProviderDraft.headersText, 'Provider headers');
      const compat = parseOptionalJsonObject(modelProviderDraft.compatText, 'Provider compat');
      const modelOverrides = parseOptionalJsonObject(modelProviderDraft.modelOverridesText, 'Provider model overrides');
      const existed = selectedModelProviderId !== NEW_MODEL_PROVIDER_ID && selectedModelProvider?.id === providerId;

      setModelProviderAction('save');
      setModelProviderEditorError(null);
      setModelProviderMessage(null);

      const state = await api.saveModelProvider(providerId, {
        baseUrl: modelProviderDraft.baseUrl.trim() || undefined,
        api: modelProviderDraft.api || undefined,
        apiKey: modelProviderDraft.apiKey.trim() || undefined,
        authHeader: modelProviderDraft.authHeader,
        headers,
        compat,
        modelOverrides,
      });

      syncModelProviderSelection(state, providerId);
      setModelProviderMessage(existed ? `Saved ${providerId}.` : `Created ${providerId}.`);
      await Promise.all([
        refetchModels({ resetLoading: false }),
        refetchProviderAuth({ resetLoading: false }),
      ]);
    } catch (error) {
      setModelProviderEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelProviderAction(null);
    }
  }

  async function handleDeleteModelProvider() {
    const providerId = selectedModelProvider?.id ?? modelProviderDraft.id.trim();
    if (!providerId || modelProviderAction !== null || selectedModelProviderId === NEW_MODEL_PROVIDER_ID) {
      return;
    }

    const confirmed = window.confirm(`Remove provider ${providerId} and all of its model definitions?`);
    if (!confirmed) {
      return;
    }

    setModelProviderAction('delete');
    setModelProviderEditorError(null);
    setModelProviderMessage(null);
    setModelDraftError(null);
    setModelDraftMessage(null);

    try {
      const state = await api.deleteModelProvider(providerId);
      replaceModelProviderState(state);
      const nextProvider = state.providers[0] ?? null;
      if (nextProvider) {
        setSelectedModelProviderId(nextProvider.id);
        setModelProviderDraft(createProviderEditorDraft(nextProvider));
      } else {
        setSelectedModelProviderId(NEW_MODEL_PROVIDER_ID);
        setModelProviderDraft(createProviderEditorDraft(null));
      }
      setEditingModelId(null);
      setModelDraft(createModelEditorDraft(null));
      setModelProviderMessage(`Removed ${providerId}.`);
      await Promise.all([
        refetchModels({ resetLoading: false }),
        refetchProviderAuth({ resetLoading: false }),
      ]);
    } catch (error) {
      setModelProviderEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelProviderAction(null);
    }
  }

  async function handleSaveProviderModel() {
    if (!selectedModelProvider || modelDraftAction !== null) {
      return;
    }

    const modelId = modelDraft.id.trim();
    if (!modelId) {
      setModelDraftError('Model id is required.');
      return;
    }

    try {
      const headers = parseOptionalStringRecord(modelDraft.headersText, 'Model headers');
      const compat = parseOptionalJsonObject(modelDraft.compatText, 'Model compat');
      const contextWindow = parseOptionalFiniteNumber(modelDraft.contextWindow, 'Context window');
      const maxTokens = parseOptionalFiniteNumber(modelDraft.maxTokens, 'Max tokens');
      const costInput = parseOptionalFiniteNumber(modelDraft.costInput, 'Input cost');
      const costOutput = parseOptionalFiniteNumber(modelDraft.costOutput, 'Output cost');
      const costCacheRead = parseOptionalFiniteNumber(modelDraft.costCacheRead, 'Cache read cost');
      const costCacheWrite = parseOptionalFiniteNumber(modelDraft.costCacheWrite, 'Cache write cost');
      const existed = editingProviderModel?.id === modelId;

      setModelDraftAction('save');
      setModelDraftError(null);
      setModelDraftMessage(null);

      const state = await api.saveModelProviderModel(selectedModelProvider.id, {
        modelId,
        name: modelDraft.name.trim() || undefined,
        api: modelDraft.api || undefined,
        baseUrl: modelDraft.baseUrl.trim() || undefined,
        reasoning: modelDraft.reasoning,
        input: modelDraft.acceptsImages ? ['text', 'image'] : ['text'],
        contextWindow,
        maxTokens,
        headers,
        cost: {
          input: costInput ?? 0,
          output: costOutput ?? 0,
          cacheRead: costCacheRead ?? 0,
          cacheWrite: costCacheWrite ?? 0,
        },
        compat,
      });

      syncModelProviderSelection(state, selectedModelProvider.id, modelId);
      setModelDraftMessage(existed ? `Saved ${modelId}.` : `Added ${modelId}.`);
      await Promise.all([
        refetchModels({ resetLoading: false }),
        refetchProviderAuth({ resetLoading: false }),
      ]);
    } catch (error) {
      setModelDraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelDraftAction(null);
    }
  }

  async function handleDeleteProviderModel(modelId: string) {
    if (!selectedModelProvider || modelDraftAction !== null) {
      return;
    }

    const confirmed = window.confirm(`Remove model ${modelId} from ${selectedModelProvider.id}?`);
    if (!confirmed) {
      return;
    }

    setModelDraftAction('delete');
    setModelDraftError(null);
    setModelDraftMessage(null);

    try {
      const state = await api.deleteModelProviderModel(selectedModelProvider.id, modelId);
      syncModelProviderSelection(state, selectedModelProvider.id);
      setModelDraftMessage(`Removed ${modelId}.`);
      await Promise.all([
        refetchModels({ resetLoading: false }),
        refetchProviderAuth({ resetLoading: false }),
      ]);
    } catch (error) {
      setModelDraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelDraftAction(null);
    }
  }

  async function handleSaveProviderApiKey() {
    if (!selectedProvider || providerCredentialAction !== null || !canProviderUseApiKey(selectedProvider)) {
      return;
    }

    const apiKey = providerApiKey.trim();
    if (!apiKey) {
      setProviderCredentialError('API key is required.');
      return;
    }

    setProviderCredentialError(null);
    setProviderCredentialNotice(null);
    setOauthError(null);
    setProviderCredentialAction('saveKey');

    try {
      await api.setProviderApiKey(selectedProvider.id, apiKey);
      setProviderApiKey('');
      setOauthLoginState(null);
      setProviderCredentialNotice(`Saved API key for ${selectedProvider.id}.`);
      await Promise.all([
        refetchProviderAuth({ resetLoading: false }),
        refetchModels({ resetLoading: false }),
      ]);
    } catch (error) {
      setProviderCredentialError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderCredentialAction(null);
    }
  }

  async function handleRemoveProviderCredential() {
    if (!selectedProvider || providerCredentialAction !== null) {
      return;
    }

    const confirmed = window.confirm(`Remove the stored credential for ${selectedProvider.id} from auth.json?`);
    if (!confirmed) {
      return;
    }

    setProviderCredentialError(null);
    setProviderCredentialNotice(null);
    setOauthError(null);
    setProviderCredentialAction('remove');

    try {
      await api.removeProviderCredential(selectedProvider.id);
      setOauthLoginState(null);
      setProviderCredentialNotice(`Removed stored credential for ${selectedProvider.id}.`);
      await Promise.all([
        refetchProviderAuth({ resetLoading: false }),
        refetchModels({ resetLoading: false }),
      ]);
    } catch (error) {
      setProviderCredentialError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderCredentialAction(null);
    }
  }

  async function handleStartProviderOAuthLogin() {
    if (!selectedProvider || !selectedProvider.oauthSupported || oauthAction !== null) {
      return;
    }

    setProviderCredentialNotice(null);
    setProviderCredentialError(null);
    setOauthError(null);
    setOauthInputValue('');
    setOauthAction('start');

    try {
      const login = await api.startProviderOAuthLogin(selectedProvider.id);
      setOauthLoginState(login);

      if (login.status === 'completed') {
        setProviderCredentialNotice(`Logged in to ${login.providerName}.`);
        await Promise.all([
          refetchProviderAuth({ resetLoading: false }),
          refetchModels({ resetLoading: false }),
        ]);
      }
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : String(error));
    } finally {
      setOauthAction(null);
    }
  }

  async function handleSubmitProviderOAuthInput() {
    if (!oauthLoginState || oauthLoginState.status !== 'running' || oauthAction !== null) {
      return;
    }

    if (oauthLoginState.prompt && !oauthLoginState.prompt.allowEmpty && oauthInputValue.trim().length === 0) {
      setOauthError('Input is required to continue this login flow.');
      return;
    }

    setOauthError(null);
    setOauthAction('submit');

    try {
      const login = await api.submitProviderOAuthLoginInput(oauthLoginState.id, oauthInputValue);
      setOauthLoginState(login);
      setOauthInputValue('');
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : String(error));
    } finally {
      setOauthAction(null);
    }
  }

  async function handleCancelProviderOAuthLogin() {
    if (!oauthLoginState || oauthLoginState.status !== 'running' || oauthAction !== null) {
      return;
    }

    setOauthError(null);
    setOauthAction('cancel');

    try {
      const login = await api.cancelProviderOAuthLogin(oauthLoginState.id);
      setOauthLoginState(login);
      setProviderCredentialNotice(`Cancelled OAuth login for ${login.providerName}.`);
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : String(error));
    } finally {
      setOauthAction(null);
    }
  }

  async function handleReset(kind: 'layout' | 'conversation') {
    const confirmed = window.confirm(
      kind === 'layout'
        ? 'Reset the saved sidebar and context-rail widths back to defaults?'
        : 'Clear the saved open-conversation state, unread attention cache, and composer history?'
    );
    if (!confirmed) {
      return;
    }

    setResetError(null);
    setResetting(kind);

    try {
      if (kind === 'layout') {
        resetStoredLayoutPreferences();
      } else {
        resetStoredConversationUiState();
        await api.setOpenConversationTabs([]);
      }

      window.location.reload();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error));
      setResetting(null);
    }
  }

  function navigateToSection(sectionId: SettingsQuickLinkId) {
    setActiveQuickLinkId(sectionId);
    const section = settingsScrollRef.current?.querySelector<HTMLElement>(`#${sectionId}`);
    section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  return (
    <div ref={settingsScrollRef} className="h-full overflow-y-auto">
      <AppPageLayout
        shellClassName="max-w-[86rem]"
        contentClassName="max-w-[58rem] flex flex-col gap-12"
        aside={(
          <SettingsTableOfContents
            items={visibleQuickLinks}
            activeId={activeQuickLinkId}
            onNavigate={navigateToSection}
          />
        )}
      >
        <AppPageIntro
          eyebrow="Settings"
          title="Settings"
          summary="Defaults, providers, skills, desktop runtime, and interface state."
        />

        <div className="flex flex-col gap-12">
          <SettingsSection
                  id="settings-skills"
                  label="Skills"
                  description="Skill discovery, bundled MCP wrappers, and extra runtime instructions."
                  className="order-3"
                >
                  <div className="space-y-0">
                    <SettingsPanel
                title="Skill folders"
                description="Load extra skill folders alongside the root skills directory."
              >
                {skillFoldersLoading && !skillFoldersState ? (
                  <p className="ui-card-meta">Loading skill folders…</p>
                ) : skillFoldersError && !skillFoldersState ? (
                  <p className="text-[12px] text-danger">Failed to load skill folders: {skillFoldersError}</p>
                ) : skillFoldersState ? (
                  <div className="space-y-3">
                    <p className="ui-card-meta break-all">Configured in <span className="font-mono text-[11px]">{skillFoldersState.configFile}</span>.</p>
                    {skillFoldersDraft.length === 0 ? (
                      <p className="ui-card-meta">No extra skill folders configured.</p>
                    ) : (
                      <div className="space-y-2">
                        {skillFoldersDraft.map((path, index) => (
                          <div key={`${path}:${index}`} className="flex items-start gap-2">
                            <div className="min-w-0 flex-1 rounded-xl border border-border-subtle/70 bg-surface/50 px-3 py-2 font-mono text-[12px] text-primary break-all">
                              {path}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { handleMoveSkillFolder(index, -1); }}
                                disabled={savingSkillFolders || index === 0}
                                className={ACTION_BUTTON_CLASS}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => { handleMoveSkillFolder(index, 1); }}
                                disabled={savingSkillFolders || index === skillFoldersDraft.length - 1}
                                className={ACTION_BUTTON_CLASS}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => { handleRemoveSkillFolder(index); }}
                                disabled={savingSkillFolders}
                                className={ACTION_BUTTON_CLASS}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void handleAddSkillFolder(); }}
                        disabled={savingSkillFolders || pickingSkillFolders}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {pickingSkillFolders ? 'Picking…' : 'Add folder'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleSaveSkillFolders(); }}
                        disabled={savingSkillFolders || !skillFoldersDirty}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {savingSkillFolders ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <p className="ui-card-meta">Folders load in the saved order after the root skills directory.</p>
                  </div>
                ) : null}

                {skillFoldersSaveError && <p className="text-[12px] text-danger">{skillFoldersSaveError}</p>}
              </SettingsPanel>

              <SettingsPanel
                title="Bundled MCP wrappers"
                description="Skills can keep their MCP CLI wrapper config in mcp.json next to SKILL.md. Explicit config still wins when server names collide."
              >
                {toolsLoading && !toolsState ? (
                  <p className="ui-card-meta">Loading MCP wrappers…</p>
                ) : toolsError && !toolsState ? (
                  <p className="text-[12px] text-danger">Failed to load MCP wrappers: {toolsError}</p>
                ) : toolsState ? (
                  <div className="space-y-5">
                    <p className="ui-card-meta break-all">
                      {toolsState.mcp.configExists
                        ? (
                            <>
                              Explicit config file: <span className="font-mono text-[11px]">{toolsState.mcp.configPath}</span>
                            </>
                          )
                        : 'No explicit MCP config file found. Using bundled skill manifests only.'}
                    </p>

                    {toolsState.mcp.bundledSkills.length > 0 ? (
                      <div className="space-y-3">
                        <p className="ui-card-meta">
                          {toolsState.mcp.bundledSkills.length} bundled skill wrapper{toolsState.mcp.bundledSkills.length === 1 ? '' : 's'} active for this profile.
                        </p>
                        {toolsState.mcp.bundledSkills.map((bundle) => (
                          <div key={bundle.manifestPath} className="space-y-1.5 border-t border-border-subtle/60 pt-3 first:border-t-0 first:pt-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[13px] font-medium text-primary">{bundle.skillName}</span>
                              <span className="ui-card-meta">{bundle.serverNames.length} server{bundle.serverNames.length === 1 ? '' : 's'}</span>
                            </div>
                            <p className="ui-card-meta break-all">
                              <span className="font-mono text-[11px]">{bundle.manifestPath}</span>
                            </p>
                            <p className="ui-card-meta break-all">
                              <span className="font-mono text-[11px]">{bundle.serverNames.join(', ')}</span>
                            </p>
                            {bundle.overriddenServerNames.length > 0 ? (
                              <p className="text-[12px] text-secondary">
                                Overridden by explicit config: <span className="font-mono text-[11px]">{bundle.overriddenServerNames.join(', ')}</span>
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="ui-card-meta">No skill-local mcp.json wrappers found in the active skill set.</p>
                    )}

                    {toolsState.mcp.servers.length > 0 ? (
                      <div className="space-y-3">
                        <p className="ui-card-meta">Effective MCP servers</p>
                        {toolsState.mcp.servers.map((server) => (
                          <div key={server.name} className="space-y-2 border-t border-border-subtle/60 pt-3 first:border-t-0 first:pt-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[12px] text-primary">{server.name}</span>
                              <Pill tone={server.transport === 'remote' ? 'teal' : 'muted'}>{server.transport}</Pill>
                              {server.hasOAuth ? <Pill tone="accent">oauth</Pill> : null}
                              <span className="ui-card-meta">{formatMcpServerSource(server)}</span>
                            </div>
                            <p className="ui-card-meta break-all">
                              <span className="font-mono text-[11px]">{formatMcpServerCommand(server)}</span>
                            </p>
                            <div className="grid gap-y-1 text-[11px] leading-5 text-dim sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-3">
                              {server.sourcePath ? (
                                <>
                                  <span className="text-secondary">{formatMcpServerSourcePathLabel(server)}</span>
                                  <span className="break-all font-mono">{server.sourcePath}</span>
                                </>
                              ) : null}
                              {server.callbackUrl ? (
                                <>
                                  <span className="text-secondary">Callback</span>
                                  <span className="break-all font-mono">{server.callbackUrl}</span>
                                </>
                              ) : null}
                              {server.authorizeResource ? (
                                <>
                                  <span className="text-secondary">Resource</span>
                                  <span className="break-all font-mono">{server.authorizeResource}</span>
                                </>
                              ) : null}
                              {server.cwd ? (
                                <>
                                  <span className="text-secondary">Working dir</span>
                                  <span className="break-all font-mono">{server.cwd}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="ui-card-meta">No MCP servers are currently available.</p>
                    )}
                  </div>
                ) : null}
              </SettingsPanel>

              <SettingsPanel
                title="AGENTS.md files"
                description="Append extra AGENTS.md-style files to the runtime prompt."
              >
                {instructionFilesLoading && !instructionFilesState ? (
                  <p className="ui-card-meta">Loading AGENTS.md files…</p>
                ) : instructionFilesError && !instructionFilesState ? (
                  <p className="text-[12px] text-danger">Failed to load AGENTS.md files: {instructionFilesError}</p>
                ) : instructionFilesState ? (
                  <div className="space-y-3">
                    <p className="ui-card-meta break-all">Configured in <span className="font-mono text-[11px]">{instructionFilesState.configFile}</span>.</p>
                    {instructionFilesDraft.length === 0 ? (
                      <p className="ui-card-meta">No extra AGENTS.md files configured.</p>
                    ) : (
                      <div className="space-y-2">
                        {instructionFilesDraft.map((path, index) => (
                          <div key={`${path}:${index}`} className="flex items-start gap-2">
                            <div className="min-w-0 flex-1 rounded-xl border border-border-subtle/70 bg-surface/50 px-3 py-2 font-mono text-[12px] text-primary break-all">
                              {path}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { handleMoveInstructionFile(index, -1); }}
                                disabled={savingInstructionFiles || index === 0}
                                className={ACTION_BUTTON_CLASS}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => { handleMoveInstructionFile(index, 1); }}
                                disabled={savingInstructionFiles || index === instructionFilesDraft.length - 1}
                                className={ACTION_BUTTON_CLASS}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => { handleRemoveInstructionFile(index); }}
                                disabled={savingInstructionFiles}
                                className={ACTION_BUTTON_CLASS}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void handleAddInstructionFiles(); }}
                        disabled={savingInstructionFiles || pickingInstructionFiles}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {pickingInstructionFiles ? 'Picking…' : 'Add files'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleSaveInstructionFiles(); }}
                        disabled={savingInstructionFiles || !instructionFilesDirty}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {savingInstructionFiles ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <p className="ui-card-meta">Files append in the saved order after the root AGENTS.md.</p>
                  </div>
                ) : null}

                {instructionFilesSaveError && <p className="text-[12px] text-danger">{instructionFilesSaveError}</p>}
              </SettingsPanel>
            </div>
          </SettingsSection>

          <SettingsSection
            id="settings-general"
            label="General"
            description="Workspace defaults, knowledge base, and conversation behavior."
            className="order-2"
          >
            <div className="space-y-0">
              <SettingsPanel
                title="Default model"
                description="Used for new chats and runs unless a model is picked explicitly."
              >
                {modelsLoading && !modelState ? (
                  <p className="ui-card-meta">Loading models…</p>
                ) : modelsError && !modelState ? (
                  <p className="text-[12px] text-danger">Failed to load models: {modelsError}</p>
                ) : modelState ? (
                  <>
                    <label className="ui-card-meta" htmlFor="settings-model">Model</label>
                    <select
                      id="settings-model"
                      value={modelState.currentModel}
                      onChange={(event) => {
                        void handleModelPreferenceChange({ model: event.target.value }, 'model');
                      }}
                      disabled={savingPreference !== null || modelState.models.length === 0}
                      className={INPUT_CLASS}
                    >
                      {groupedModels.map(([provider, models]) => (
                        <optgroup key={provider} label={provider}>
                          {models.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name} · {formatContextWindowLabel(model.context)} ctx
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p className="ui-card-meta">
                      {savingPreference === 'model'
                        ? 'Saving default model...'
                        : formatModelSummary(selectedModel, 'No model selected.')
                      }
                    </p>

                    <label className="ui-card-meta pt-1" htmlFor="settings-thinking">Thinking level</label>
                    <select
                      id="settings-thinking"
                      value={modelState.currentThinkingLevel}
                      onChange={(event) => {
                        void handleModelPreferenceChange({ thinkingLevel: event.target.value }, 'thinking');
                      }}
                      disabled={savingPreference !== null}
                      className={INPUT_CLASS}
                    >
                      {THINKING_LEVEL_OPTIONS.map((option) => (
                        <option key={option.value || 'unset'} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <p className="ui-card-meta">
                      {savingPreference === 'thinking'
                        ? 'Saving thinking level…'
                        : `Current thinking level: ${formatThinkingLevelLabel(modelState.currentThinkingLevel)}`}
                    </p>

                    {selectedModelSupportsFastMode && (
                      <>
                        <label className="inline-flex items-center gap-3 pt-1 text-[14px] text-primary" htmlFor="settings-fast-mode">
                          <input
                            id="settings-fast-mode"
                            type="checkbox"
                            className="h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none"
                            checked={modelState.currentServiceTier === 'priority'}
                            onChange={(event) => {
                              void handleModelPreferenceChange({ serviceTier: event.target.checked ? 'priority' : '' }, 'serviceTier');
                            }}
                            disabled={savingPreference !== null}
                          />
                          <span>Fast mode</span>
                        </label>
                        <p className="ui-card-meta">
                          {savingPreference === 'serviceTier'
                            ? 'Saving fast mode…'
                            : modelState.currentServiceTier === 'priority'
                              ? 'Fast mode is on (service tier: priority).'
                              : 'Fast mode is off.'}
                        </p>
                      </>
                    )}
                  </>
                ) : null}

                {modelError && <p className="text-[12px] text-danger">{modelError}</p>}
              </SettingsPanel>

              <SettingsPanel
                title="Knowledge base"
                description="Point PA at a git repo and let it manage the local mirror and sync loop."
              >
                {knowledgeBaseLoading && !knowledgeBaseState ? (
                  <p className="ui-card-meta">Loading knowledge base…</p>
                ) : knowledgeBaseLoadError && !knowledgeBaseState ? (
                  <p className="text-[12px] text-danger">Failed to load knowledge base: {knowledgeBaseLoadError}</p>
                ) : knowledgeBaseState ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleKnowledgeBaseSave();
                    }}
                  >
                    <label className="ui-card-meta" htmlFor="settings-knowledge-base-repo">Repo URL</label>
                    <input
                      id="settings-knowledge-base-repo"
                      value={knowledgeBaseRepoUrlDraft}
                      onChange={(event) => {
                        setKnowledgeBaseRepoUrlDraft(event.target.value);
                        if (knowledgeBaseSaveError) {
                          setKnowledgeBaseSaveError(null);
                        }
                      }}
                      className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[13px]`}
                      placeholder="https://github.com/you/knowledge-base.git"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={knowledgeBaseAction !== null}
                    />
                    <label className="ui-card-meta" htmlFor="settings-knowledge-base-branch">Branch</label>
                    <input
                      id="settings-knowledge-base-branch"
                      value={knowledgeBaseBranchDraft}
                      onChange={(event) => {
                        setKnowledgeBaseBranchDraft(event.target.value);
                        if (knowledgeBaseSaveError) {
                          setKnowledgeBaseSaveError(null);
                        }
                      }}
                      className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[13px]`}
                      placeholder="main"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={knowledgeBaseAction !== null}
                    />
                    <p className="ui-card-meta break-all">Local mirror · <span className="font-mono text-[11px]">{knowledgeBaseState.managedRoot}</span></p>
                    <p className={cx('ui-card-meta break-all', knowledgeBaseAction === null && knowledgeBaseSyncPresentation.toneClass)}>
                      {knowledgeBaseAction === 'save'
                        ? 'Saving knowledge base…'
                        : knowledgeBaseAction === 'sync'
                          ? 'Syncing knowledge base…'
                          : knowledgeBaseSyncPresentation.text}
                    </p>
                    <p className="ui-card-meta break-all">Recovery copies · <span className="font-mono text-[11px]">{knowledgeBaseState.recoveryDir}</span> · {knowledgeBaseState.recoveredEntryCount} saved</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={knowledgeBaseAction !== null || !knowledgeBaseDirty}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {knowledgeBaseAction === 'save' ? 'Saving…' : 'Save repo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleKnowledgeBaseSync(); }}
                        disabled={knowledgeBaseAction !== null || !knowledgeBaseState.configured}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {knowledgeBaseAction === 'sync' ? 'Syncing…' : 'Sync now'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setKnowledgeBaseRepoUrlDraft('');
                          setKnowledgeBaseBranchDraft('main');
                          void handleKnowledgeBaseSave({ repoUrl: '', branch: 'main' });
                        }}
                        disabled={knowledgeBaseAction !== null || !knowledgeBaseState.configured}
                        className={ACTION_BUTTON_CLASS}
                      >
                        Disable managed sync
                      </button>
                    </div>
                    <p className="ui-card-meta">PA keeps a local clone under runtime state, syncs it in the background, and treats git as the backing store. Folder and file @ mentions read from that local mirror.</p>
                  </form>
                ) : null}

                {knowledgeBaseSaveError && <p className="text-[12px] text-danger">{knowledgeBaseSaveError}</p>}
              </SettingsPanel>

              <SettingsPanel
                title="Indexed root"
                description="Base path for notes, skills, root instructions, and folder-aware @ paths."
              >
                {vaultRootLoading && !vaultRootState ? (
                  <p className="ui-card-meta">Loading indexed root…</p>
                ) : vaultRootLoadError && !vaultRootState ? (
                  <p className="text-[12px] text-danger">Failed to load indexed root: {vaultRootLoadError}</p>
                ) : vaultRootState ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleVaultRootSave();
                    }}
                  >
                    <label className="ui-card-meta" htmlFor="settings-vault-root">Path</label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        id="settings-vault-root"
                        value={vaultRootDraft}
                        onChange={(event) => {
                          setVaultRootDraft(event.target.value);
                          if (vaultRootSaveError) {
                            setVaultRootSaveError(null);
                          }
                        }}
                        className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[13px]`}
                        placeholder="~/Documents/personal-agent"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={savingVaultRoot || pickingVaultRoot || vaultRootManagedByKnowledgeBase}
                      />
                      <ToolbarButton
                        type="button"
                        onClick={() => { void handleVaultRootPick(); }}
                        disabled={savingVaultRoot || pickingVaultRoot || vaultRootManagedByKnowledgeBase}
                        className="shrink-0 text-accent"
                        title="Choose indexed root"
                        aria-label="Choose indexed root"
                      >
                        {pickingVaultRoot ? 'Choosing…' : 'Choose…'}
                      </ToolbarButton>
                    </div>
                    <p className="ui-card-meta break-all">
                      {savingVaultRoot
                        ? 'Saving indexed root…'
                        : vaultRootState.source === 'env'
                          ? `Env override active · ${vaultRootState.effectiveRoot}`
                          : vaultRootManagedByKnowledgeBase
                            ? `Managed by knowledge base repo · ${vaultRootState.effectiveRoot}`
                            : vaultRootState.currentRoot
                              ? `Effective root · ${vaultRootState.effectiveRoot}`
                              : `Default root · ${vaultRootState.defaultRoot}`}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={savingVaultRoot || pickingVaultRoot || vaultRootManagedByKnowledgeBase || !vaultRootDirty}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {savingVaultRoot ? 'Saving…' : 'Save root'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleVaultRootSave(''); }}
                        disabled={savingVaultRoot || pickingVaultRoot || vaultRootManagedByKnowledgeBase || vaultRootState.currentRoot.length === 0}
                        className={ACTION_BUTTON_CLASS}
                      >
                        Use default root
                      </button>
                    </div>
                    <p className="ui-card-meta">
                      {vaultRootManagedByKnowledgeBase
                        ? <>A managed knowledge base repo is active, so PA uses its local mirror as the indexed root. Clear the repo above to override the root directly.</>
                        : <>Sets the base path for indexed folders &amp; files. Use an absolute path or <span className="font-mono text-[11px]">~/…</span>. <span className="font-mono text-[11px]">PERSONAL_AGENT_VAULT_ROOT</span> still wins when set.</>}
                    </p>
                  </form>
                ) : null}

                {vaultRootSaveError && <p className="text-[12px] text-danger">{vaultRootSaveError}</p>}
              </SettingsPanel>

              <SettingsPanel
                title="Working directory"
                description="Fallback cwd for new chats and web actions."
              >
                {defaultCwdLoading && !defaultCwdState ? (
                  <p className="ui-card-meta">Loading default working directory…</p>
                ) : defaultCwdLoadError && !defaultCwdState ? (
                  <p className="text-[12px] text-danger">Failed to load default working directory: {defaultCwdLoadError}</p>
                ) : defaultCwdState ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleDefaultCwdSave();
                    }}
                  >
                    <label className="ui-card-meta" htmlFor="settings-default-cwd">Path</label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        id="settings-default-cwd"
                        value={defaultCwdDraft}
                        onChange={(event) => {
                          setDefaultCwdDraft(event.target.value);
                          if (defaultCwdSaveError) {
                            setDefaultCwdSaveError(null);
                          }
                        }}
                        className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[13px]`}
                        placeholder="~/workingdir/repo"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={savingDefaultCwd || pickingDefaultCwd}
                      />
                      <ToolbarButton
                        type="button"
                        onClick={() => { void handleDefaultCwdPick(); }}
                        disabled={savingDefaultCwd || pickingDefaultCwd}
                        className="shrink-0 text-accent"
                        title="Choose default working directory"
                        aria-label="Choose default working directory"
                      >
                        {pickingDefaultCwd ? 'Choosing…' : 'Choose…'}
                      </ToolbarButton>
                    </div>
                    <p className="ui-card-meta break-all">
                      {savingDefaultCwd
                        ? 'Saving default working directory…'
                        : defaultCwdState.currentCwd
                          ? `Default cwd · ${defaultCwdState.effectiveCwd}`
                          : `Process cwd · ${defaultCwdState.effectiveCwd}`}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={savingDefaultCwd || pickingDefaultCwd || !defaultCwdDirty}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {savingDefaultCwd ? 'Saving…' : 'Save working directory'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleDefaultCwdSave(''); }}
                        disabled={savingDefaultCwd || pickingDefaultCwd || defaultCwdState.currentCwd.length === 0}
                        className={ACTION_BUTTON_CLASS}
                      >
                        Use process cwd
                      </button>
                    </div>
                    <p className="ui-card-meta">
                      Absolute, <span className="font-mono text-[11px]">~/…</span>, or relative. Leave blank to use the runtime process cwd.
                    </p>
                  </form>
                ) : null}

                {defaultCwdSaveError && <p className="text-[12px] text-danger">{defaultCwdSaveError}</p>}
              </SettingsPanel>

              <SettingsPanel
                title="Conversation titles"
                description="Auto-title chats after the first assistant reply."
              >
                {(conversationTitleLoading && !conversationTitleState) || (modelsLoading && !modelState) ? (
                  <p className="ui-card-meta">Loading conversation title settings…</p>
                ) : (!conversationTitleState && conversationTitleError) ? (
                  <p className="text-[12px] text-danger">Failed to load conversation title settings: {conversationTitleError}</p>
                ) : (!modelState && modelsError) ? (
                  <p className="text-[12px] text-danger">Failed to load models: {modelsError}</p>
                ) : conversationTitleState && modelState ? (
                  <>
                    <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="settings-conversation-titles-enabled">
                      <input
                        id="settings-conversation-titles-enabled"
                        type="checkbox"
                        checked={conversationTitleState.enabled}
                        onChange={(event) => {
                          void handleConversationTitleSettingChange({ enabled: event.target.checked }, 'enabled');
                        }}
                        disabled={savingConversationTitle !== null}
                        className={CHECKBOX_CLASS}
                      />
                      <span>Generate titles automatically</span>
                    </label>
                    <p className="ui-card-meta">
                      {savingConversationTitle === 'enabled'
                        ? 'Saving auto-title setting…'
                        : conversationTitleState.enabled
                          ? 'Enabled after the first assistant reply.'
                          : 'Disabled. New conversations keep the fallback title until renamed manually.'}
                    </p>

                    <label className="ui-card-meta pt-1" htmlFor="settings-conversation-title-model">Title model</label>
                    <select
                      id="settings-conversation-title-model"
                      value={conversationTitleState.currentModel}
                      onChange={(event) => {
                        void handleConversationTitleSettingChange({ model: event.target.value || '' }, 'model');
                      }}
                      disabled={savingConversationTitle !== null || modelState.models.length === 0}
                      className={INPUT_CLASS}
                    >
                      <option value="">Use default title model ({conversationTitleState.effectiveModel})</option>
                      {groupedModels.map(([provider, models]) => (
                        <optgroup key={provider} label={provider}>
                          {models.map((model) => (
                            <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                              {model.name} · {formatContextWindowLabel(model.context)} ctx
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p className="ui-card-meta">
                      {savingConversationTitle === 'model'
                        ? 'Saving title model…'
                        : conversationTitleState.currentModel
                          ? `Pinned title model: ${formatModelSummary(selectedConversationTitleModel, conversationTitleState.currentModel)}`
                          : `Using default title model: ${formatModelSummary(effectiveConversationTitleModel, conversationTitleState.effectiveModel)}`}
                    </p>
                  </>
                ) : null}

                {conversationTitleSaveError && <p className="text-[12px] text-danger">{conversationTitleSaveError}</p>}
              </SettingsPanel>
            </div>
          </SettingsSection>

          <SettingsSection
            id="settings-appearance"
            label="Appearance"
            description="Theme and other visual preferences for the web UI."
            className="order-1"
          >
            <div className="space-y-0">
              <SettingsPanel
                title="Theme"
                description="Choose Auto to follow the OS."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="ui-segmented-control" role="group" aria-label="Theme selection">
                    <ThemeButton value="system" current={themePreference} onSelect={setThemePreference} label="auto" />
                    <ThemeButton value="light" current={themePreference} onSelect={setThemePreference} />
                    <ThemeButton value="dark" current={themePreference} onSelect={setThemePreference} />
                  </div>
                  <span className="ui-card-meta">
                    Current theme: {theme}{themePreference === 'system' ? ' (auto)' : ''}
                  </span>
                </div>
              </SettingsPanel>
            </div>
          </SettingsSection>

          <SettingsSection
            id="settings-providers"
            label="Providers"
            description="Provider definitions, model overrides, and credential management."
            className="order-3"
          >
            <div className="space-y-0">
              <SettingsPanel
                title="Provider & model definitions"
                description={(
                  <>
                    Edit <span className="font-mono text-[11px]">{modelProviderState?.filePath ?? 'models.json'}</span> for local overrides.
                  </>
                )}
              >
                <div className="space-y-5">
                <div className="space-y-3 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-medium text-primary">Configured providers</h3>
                    <button
                      type="button"
                      onClick={() => { selectModelProvider(NEW_MODEL_PROVIDER_ID); }}
                      className={ACTION_BUTTON_CLASS}
                    >
                      New provider
                    </button>
                  </div>

                  {modelProviderLoading && !modelProviderState ? (
                    <p className="ui-card-meta">Loading provider definitions…</p>
                  ) : modelProviderError && !modelProviderState ? (
                    <p className="text-[12px] text-danger">Failed to load provider definitions: {modelProviderError}</p>
                  ) : modelProviderState ? (
                    <>
                      {modelProviderState.providers.length > 0 ? (
                        <div className="space-y-px">
                          {modelProviderState.providers.map((provider) => {
                            const selected = provider.id === selectedModelProviderId;
                            return (
                              <button
                                key={provider.id}
                                type="button"
                                onClick={() => { selectModelProvider(provider.id); }}
                                className={cx(
                                  'group ui-list-row w-full justify-between px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
                                  selected ? 'ui-list-row-selected' : 'ui-list-row-hover',
                                )}
                                aria-pressed={selected}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[13px] font-medium text-primary">{provider.id}</span>
                                  <span className="ui-card-meta block truncate">{formatModelProviderSummary(provider)}</span>
                                </span>
                                {provider.baseUrl && (
                                  <span className="ui-card-meta hidden truncate text-right xl:block">{provider.baseUrl}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="ui-card-meta">No custom providers or overrides yet.</p>
                      )}
                      <p className="ui-card-meta">
                        Active profile: <span className="font-mono text-[11px]">{modelProviderState.profile}</span>
                      </p>
                    </>
                  ) : null}
                </div>

                <div className="space-y-8 border-t border-border-subtle pt-6 min-w-0">
                  <div className="space-y-4 min-w-0">
                    <div className="space-y-1">
                      <h3 className="text-[15px] font-medium text-primary">
                        {selectedModelProviderId === NEW_MODEL_PROVIDER_ID ? 'New provider' : (selectedModelProvider?.id ?? 'Provider')}
                      </h3>
                      <p className="ui-card-meta max-w-3xl">
                        Use built-in ids like <span className="font-mono text-[11px]">anthropic</span>, <span className="font-mono text-[11px]">openai</span>, <span className="font-mono text-[11px]">openai-codex</span>, or <span className="font-mono text-[11px]">google</span> to override a built-in provider. Use any new id for a custom provider.
                      </p>
                    </div>

                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSaveModelProvider();
                      }}
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2 min-w-0">
                          <label className="ui-card-meta" htmlFor="settings-model-provider-id">Provider id</label>
                          <input
                            id="settings-model-provider-id"
                            value={modelProviderDraft.id}
                            onChange={(event) => { setModelProviderDraft((current) => ({ ...current, id: event.target.value })); }}
                            className={`${INPUT_CLASS} font-mono text-[13px]`}
                            placeholder="ollama"
                            autoComplete="off"
                            spellCheck={false}
                            disabled={modelProviderAction !== null || selectedModelProviderId !== NEW_MODEL_PROVIDER_ID}
                          />
                        </div>

                        <div className="space-y-2 min-w-0">
                          <label className="ui-card-meta" htmlFor="settings-model-provider-base-url">Base URL</label>
                          <input
                            id="settings-model-provider-base-url"
                            value={modelProviderDraft.baseUrl}
                            onChange={(event) => { setModelProviderDraft((current) => ({ ...current, baseUrl: event.target.value })); }}
                            className={`${INPUT_CLASS} font-mono text-[13px]`}
                            placeholder="http://localhost:11434/v1"
                            autoComplete="off"
                            spellCheck={false}
                            disabled={modelProviderAction !== null}
                          />
                        </div>

                        <div className="space-y-2 min-w-0">
                          <label className="ui-card-meta" htmlFor="settings-model-provider-api">API</label>
                          <select
                            id="settings-model-provider-api"
                            value={modelProviderDraft.api}
                            onChange={(event) => { setModelProviderDraft((current) => ({ ...current, api: event.target.value })); }}
                            className={INPUT_CLASS}
                            disabled={modelProviderAction !== null}
                          >
                            <option value="">Use built-in or inherit</option>
                            {MODEL_PROVIDER_API_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-2 min-w-0">
                          <label className="ui-card-meta" htmlFor="settings-model-provider-api-key">Provider API key</label>
                          <input
                            id="settings-model-provider-api-key"
                            value={modelProviderDraft.apiKey}
                            onChange={(event) => { setModelProviderDraft((current) => ({ ...current, apiKey: event.target.value })); }}
                            className={`${INPUT_CLASS} font-mono text-[13px]`}
                            placeholder="ollama, ENV_VAR, or !command"
                            autoComplete="off"
                            spellCheck={false}
                            disabled={modelProviderAction !== null}
                          />
                        </div>
                      </div>

                      <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="settings-model-provider-auth-header">
                        <input
                          id="settings-model-provider-auth-header"
                          type="checkbox"
                          checked={modelProviderDraft.authHeader}
                          onChange={(event) => { setModelProviderDraft((current) => ({ ...current, authHeader: event.target.checked })); }}
                          disabled={modelProviderAction !== null}
                          className={CHECKBOX_CLASS}
                        />
                        <span>Add <span className="font-mono text-[11px]">Authorization: Bearer</span> from the provider API key</span>
                      </label>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="space-y-2 min-w-0">
                          <label className="ui-card-meta" htmlFor="settings-model-provider-headers">Headers (JSON)</label>
                          <textarea
                            id="settings-model-provider-headers"
                            value={modelProviderDraft.headersText}
                            onChange={(event) => { setModelProviderDraft((current) => ({ ...current, headersText: event.target.value })); }}
                            className={JSON_TEXTAREA_CLASS}
                            placeholder={'{\n  "x-app": "personal-agent"\n}'}
                            spellCheck={false}
                            disabled={modelProviderAction !== null}
                          />
                        </div>

                        <div className="space-y-2 min-w-0">
                          <label className="ui-card-meta" htmlFor="settings-model-provider-compat">Compat (JSON)</label>
                          <textarea
                            id="settings-model-provider-compat"
                            value={modelProviderDraft.compatText}
                            onChange={(event) => { setModelProviderDraft((current) => ({ ...current, compatText: event.target.value })); }}
                            className={JSON_TEXTAREA_CLASS}
                            placeholder={'{\n  "supportsDeveloperRole": false\n}'}
                            spellCheck={false}
                            disabled={modelProviderAction !== null}
                          />
                        </div>

                        <div className="space-y-2 min-w-0 xl:col-span-2">
                          <label className="ui-card-meta" htmlFor="settings-model-provider-overrides">Model overrides (JSON)</label>
                          <textarea
                            id="settings-model-provider-overrides"
                            value={modelProviderDraft.modelOverridesText}
                            onChange={(event) => { setModelProviderDraft((current) => ({ ...current, modelOverridesText: event.target.value })); }}
                            className={JSON_TEXTAREA_CLASS}
                            placeholder={'{\n  "claude-sonnet-4-6": {\n    "name": "Claude Sonnet 4.6 (Proxy)"\n  }\n}'}
                            spellCheck={false}
                            disabled={modelProviderAction !== null}
                          />
                        </div>
                      </div>

                      <p className="ui-card-meta max-w-3xl">
                        Provider API keys here use <span className="font-mono text-[11px]">models.json</span> value resolution. Leave the field blank if you prefer <span className="font-mono text-[11px]">auth.json</span>, OAuth, or environment-only auth.
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={modelProviderAction !== null || modelProviderDraft.id.trim().length === 0}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {modelProviderAction === 'save'
                            ? 'Saving provider…'
                            : selectedModelProviderId === NEW_MODEL_PROVIDER_ID
                              ? 'Create provider'
                              : 'Save provider'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleDeleteModelProvider(); }}
                          disabled={modelProviderAction !== null || selectedModelProviderId === NEW_MODEL_PROVIDER_ID || !selectedModelProvider}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {modelProviderAction === 'delete' ? 'Removing…' : 'Remove provider'}
                        </button>
                      </div>

                      {modelProviderMessage && <p className="text-[12px] text-success">{modelProviderMessage}</p>}
                      {modelProviderEditorError && <p className="text-[12px] text-danger">{modelProviderEditorError}</p>}
                    </form>
                  </div>

                  <div className="space-y-4 border-t border-border-subtle pt-6 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="text-[15px] font-medium text-primary">Models</h3>
                        <p className="ui-card-meta max-w-3xl">
                          {selectedModelProvider
                            ? `Models under ${selectedModelProvider.id}. Matching a built-in id replaces that provider model.`
                            : 'Save or select a provider before adding models.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { startEditingProviderModel(NEW_MODEL_ID); }}
                        disabled={!selectedModelProvider || modelDraftAction !== null}
                        className={ACTION_BUTTON_CLASS}
                      >
                        Add model
                      </button>
                    </div>

                    {selectedModelProvider ? (
                      <>
                        {selectedModelProvider.models.length > 0 ? (
                          <div className="space-y-px">
                            {selectedModelProvider.models.map((model) => (
                              <div
                                key={model.id}
                                className="group ui-list-row ui-list-row-hover justify-between px-3 py-3"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-[13px] font-medium text-primary">{model.id}</p>
                                  <p className="ui-card-meta truncate">{formatProviderModelSummary(model)}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => { startEditingProviderModel(model.id); }}
                                    className={ACTION_BUTTON_CLASS}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { void handleDeleteProviderModel(model.id); }}
                                    disabled={modelDraftAction !== null}
                                    className={ACTION_BUTTON_CLASS}
                                  >
                                    {modelDraftAction === 'delete' && editingModelId === model.id ? 'Removing…' : 'Remove'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="ui-card-meta">No models configured for this provider yet.</p>
                        )}

                        {modelDraftMessage && <p className="text-[12px] text-success">{modelDraftMessage}</p>}
                        {modelDraftError && <p className="text-[12px] text-danger">{modelDraftError}</p>}

                        {(editingModelId === NEW_MODEL_ID || editingProviderModel) && (
                          <form
                            className="space-y-4 border-t border-border-subtle pt-6"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void handleSaveProviderModel();
                            }}
                          >
                            <div className="space-y-1">
                              <h4 className="text-[13px] font-medium text-primary">
                                {editingModelId === NEW_MODEL_ID ? 'New model' : `Edit ${editingProviderModel?.id ?? 'model'}`}
                              </h4>
                              <p className="ui-card-meta max-w-3xl">
                                Only the model id is required. Leave API blank to inherit the provider API.
                              </p>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-id">Model id</label>
                                <input
                                  id="settings-provider-model-id"
                                  value={modelDraft.id}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, id: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
                                  placeholder="llama3.1:8b"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null || editingModelId !== NEW_MODEL_ID}
                                />
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-name">Name</label>
                                <input
                                  id="settings-provider-model-name"
                                  value={modelDraft.name}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, name: event.target.value })); }}
                                  className={INPUT_CLASS}
                                  placeholder="Llama 3.1 8B"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-api">API</label>
                                <select
                                  id="settings-provider-model-api"
                                  value={modelDraft.api}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, api: event.target.value })); }}
                                  className={INPUT_CLASS}
                                  disabled={modelDraftAction !== null}
                                >
                                  <option value="">Inherit provider API</option>
                                  {MODEL_PROVIDER_API_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-base-url">Base URL override</label>
                                <input
                                  id="settings-provider-model-base-url"
                                  value={modelDraft.baseUrl}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, baseUrl: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
                                  placeholder="https://proxy.example.com/v1"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-1.5 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-context">Context window</label>
                                <input
                                  id="settings-provider-model-context"
                                  value={modelDraft.contextWindow}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, contextWindow: event.target.value })); }}
                                  className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                  inputMode="numeric"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-1.5 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-max-tokens">Max tokens</label>
                                <input
                                  id="settings-provider-model-max-tokens"
                                  value={modelDraft.maxTokens}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, maxTokens: event.target.value })); }}
                                  className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                  inputMode="numeric"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-4">
                              <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="settings-provider-model-reasoning">
                                <input
                                  id="settings-provider-model-reasoning"
                                  type="checkbox"
                                  checked={modelDraft.reasoning}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, reasoning: event.target.checked })); }}
                                  disabled={modelDraftAction !== null}
                                  className={CHECKBOX_CLASS}
                                />
                                <span>Reasoning capable</span>
                              </label>

                              <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="settings-provider-model-images">
                                <input
                                  id="settings-provider-model-images"
                                  type="checkbox"
                                  checked={modelDraft.acceptsImages}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, acceptsImages: event.target.checked })); }}
                                  disabled={modelDraftAction !== null}
                                  className={CHECKBOX_CLASS}
                                />
                                <span>Accept images</span>
                              </label>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                              <div className="space-y-1.5 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-input">Input cost / 1M</label>
                                <input
                                  id="settings-provider-model-cost-input"
                                  value={modelDraft.costInput}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costInput: event.target.value })); }}
                                  className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-1.5 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-output">Output cost / 1M</label>
                                <input
                                  id="settings-provider-model-cost-output"
                                  value={modelDraft.costOutput}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costOutput: event.target.value })); }}
                                  className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-1.5 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-cache-read">Cache read / 1M</label>
                                <input
                                  id="settings-provider-model-cost-cache-read"
                                  value={modelDraft.costCacheRead}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costCacheRead: event.target.value })); }}
                                  className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-1.5 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-cache-write">Cache write / 1M</label>
                                <input
                                  id="settings-provider-model-cost-cache-write"
                                  value={modelDraft.costCacheWrite}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costCacheWrite: event.target.value })); }}
                                  className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-headers">Headers (JSON)</label>
                                <textarea
                                  id="settings-provider-model-headers"
                                  value={modelDraft.headersText}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, headersText: event.target.value })); }}
                                  className={JSON_TEXTAREA_CLASS}
                                  placeholder={'{\n  "x-provider-key": "HEADER_VALUE"\n}'}
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-compat">Compat (JSON)</label>
                                <textarea
                                  id="settings-provider-model-compat"
                                  value={modelDraft.compatText}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, compatText: event.target.value })); }}
                                  className={JSON_TEXTAREA_CLASS}
                                  placeholder={'{\n  "supportsReasoningEffort": false\n}'}
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="submit"
                                disabled={modelDraftAction !== null || modelDraft.id.trim().length === 0}
                                className={ACTION_BUTTON_CLASS}
                              >
                                {modelDraftAction === 'save'
                                  ? 'Saving model…'
                                  : editingModelId === NEW_MODEL_ID
                                    ? 'Add model'
                                    : 'Save model'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingModelId(null);
                                  setModelDraft(createModelEditorDraft(null));
                                  setModelDraftError(null);
                                  setModelDraftMessage(null);
                                }}
                                disabled={modelDraftAction !== null}
                                className={ACTION_BUTTON_CLASS}
                              >
                                Cancel
                              </button>
                            </div>

                          </form>
                        )}
                      </>
                    ) : (
                      <p className="ui-card-meta">Select or create a provider to edit its models.</p>
                    )}
                  </div>
                </div>
                </div>
              </SettingsPanel>

              <SettingsPanel
                title="Provider credentials"
                description={(
                  <>
                    Manage API keys and OAuth in <span className="font-mono text-[11px]">{providerAuthState?.authFile ?? 'auth.json'}</span>.
                  </>
                )}
              >
                <div className="space-y-6">
                  <div className="space-y-3 min-w-0">
                    <div className="space-y-1">
                      <h3 className="text-[15px] font-medium text-primary">Provider</h3>
                      <p className="ui-card-meta max-w-2xl">
                        Built-in Pi providers that support auth.json API keys appear here even before any environment variables are set. Provider-level <span className="font-mono text-[11px]">apiKey</span> values set above still live in <span className="font-mono text-[11px]">models.json</span>.
                      </p>
                    </div>

                    {providerAuthLoading && !providerAuthState ? (
                      <p className="ui-card-meta">Loading provider credentials…</p>
                    ) : providerAuthError && !providerAuthState ? (
                      <p className="text-[12px] text-danger">Failed to load provider credentials: {providerAuthError}</p>
                    ) : providerAuthState ? (
                      <>
                        <label className="ui-card-meta" htmlFor="settings-provider-auth">Provider</label>
                        <select
                          id="settings-provider-auth"
                          value={selectedProviderId}
                          onChange={(event) => { setSelectedProviderId(event.target.value); }}
                          disabled={providerCredentialAction !== null || oauthLoginState?.status === 'running' || providerAuthState.providers.length === 0}
                          className={INPUT_CLASS}
                        >
                          {providerAuthState.providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.id}
                            </option>
                          ))}
                        </select>
                        <p className="ui-card-meta">{formatProviderAuthStatus(selectedProvider)}</p>
                        <p className="ui-card-meta">{formatProviderModelCoverage(selectedProvider)}</p>
                      </>
                    ) : null}
                  </div>

                  <div className="space-y-3 border-t border-border-subtle pt-6 min-w-0">
                    <div className="space-y-1">
                      <h3 className="text-[15px] font-medium text-primary">API key and OAuth</h3>
                      <p className="ui-card-meta max-w-2xl">
                        Equivalent to <span className="font-mono text-[11px]">/login</span> and manual auth-file edits in the TUI.
                      </p>
                    </div>

                    {selectedProvider ? (
                      <>
                        {canProviderUseApiKey(selectedProvider) ? (
                          <>
                            <label className="ui-card-meta" htmlFor="settings-provider-api-key">API key</label>
                            <input
                              id="settings-provider-api-key"
                              type="password"
                              value={providerApiKey}
                              onChange={(event) => { setProviderApiKey(event.target.value); }}
                              className={INPUT_CLASS}
                              placeholder="sk-... or op://vault/item/field"
                              autoComplete="off"
                              spellCheck={false}
                              disabled={providerCredentialAction !== null || oauthLoginState?.status === 'running'}
                            />
                            <p className="ui-card-meta">
                              Save a key for <span className="font-mono text-[11px]">{selectedProvider.id}</span>.
                            </p>
                          </>
                        ) : (
                          <p className="ui-card-meta">
                            Stored API keys are not used for <span className="font-mono text-[11px]">{selectedProvider.id}</span>. Use OAuth or provider-specific runtime configuration instead.
                          </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {canProviderUseApiKey(selectedProvider) && (
                            <button
                              type="button"
                              onClick={() => { void handleSaveProviderApiKey(); }}
                              disabled={providerCredentialAction !== null || oauthLoginState?.status === 'running' || providerApiKey.trim().length === 0}
                              className={ACTION_BUTTON_CLASS}
                            >
                              {providerCredentialAction === 'saveKey' ? 'Saving key…' : 'Save API key'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => { void handleRemoveProviderCredential(); }}
                            disabled={providerCredentialAction !== null || oauthLoginState?.status === 'running' || !selectedProvider.hasStoredCredential}
                            className={ACTION_BUTTON_CLASS}
                          >
                            {providerCredentialAction === 'remove' ? 'Removing…' : 'Remove stored credential'}
                          </button>
                        </div>

                        {selectedProvider.oauthSupported ? (
                          <div className="space-y-2 pt-2">
                            <p className="ui-card-meta">
                              OAuth available via {selectedProvider.oauthProviderName || selectedProvider.id}
                              {selectedProvider.oauthUsesCallbackServer ? ' (supports browser callback).' : '.'}
                            </p>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => { void handleStartProviderOAuthLogin(); }}
                                disabled={providerCredentialAction !== null || oauthAction !== null || selectedProviderLogin?.status === 'running'}
                                className={ACTION_BUTTON_CLASS}
                              >
                                {oauthAction === 'start'
                                  ? 'Starting login…'
                                  : selectedProviderLogin?.status === 'running'
                                    ? 'OAuth login running…'
                                    : `Start OAuth login (${selectedProvider.id})`}
                              </button>
                              {selectedProviderLogin?.status === 'running' && (
                                <button
                                  type="button"
                                  onClick={() => { void handleCancelProviderOAuthLogin(); }}
                                  disabled={providerCredentialAction !== null || oauthAction !== null}
                                  className={ACTION_BUTTON_CLASS}
                                >
                                  {oauthAction === 'cancel' ? 'Cancelling…' : 'Cancel login'}
                                </button>
                              )}
                            </div>

                            {selectedProviderLogin ? (
                              <>
                                <p className="ui-card-meta">
                                  Status: <span className="font-medium text-primary">{selectedProviderLogin.status}</span>
                                </p>

                                {selectedProviderLogin.authUrl && (
                                  <p className="ui-card-meta break-all">
                                    Open auth URL:{' '}
                                    <a
                                      href={selectedProviderLogin.authUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-accent hover:underline"
                                    >
                                      {selectedProviderLogin.authUrl}
                                    </a>
                                    {selectedProviderLogin.authInstructions ? ` — ${selectedProviderLogin.authInstructions}` : ''}
                                  </p>
                                )}

                                {selectedProviderLogin.prompt && (
                                  <>
                                    <label className="ui-card-meta" htmlFor="settings-provider-oauth-input">
                                      {selectedProviderLogin.prompt.message}
                                    </label>
                                    <input
                                      id="settings-provider-oauth-input"
                                      type="text"
                                      value={oauthInputValue}
                                      onChange={(event) => { setOauthInputValue(event.target.value); }}
                                      className={INPUT_CLASS}
                                      placeholder={selectedProviderLogin.prompt.placeholder || 'Enter value'}
                                      disabled={providerCredentialAction !== null || oauthAction !== null}
                                      spellCheck={false}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => { void handleSubmitProviderOAuthInput(); }}
                                      disabled={providerCredentialAction !== null || oauthAction !== null}
                                      className={ACTION_BUTTON_CLASS}
                                    >
                                      {oauthAction === 'submit' ? 'Submitting…' : 'Submit input'}
                                    </button>
                                  </>
                                )}

                                {selectedProviderLogin.progress.length > 0 && (
                                  <p className="ui-card-meta">
                                    Latest progress: {selectedProviderLogin.progress[selectedProviderLogin.progress.length - 1]}
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="ui-card-meta">No active OAuth login for this provider.</p>
                            )}
                          </div>
                        ) : (
                          <p className="ui-card-meta">OAuth login is not available for this provider.</p>
                        )}
                      </>
                    ) : (
                      <p className="ui-card-meta">Select a provider to manage credentials.</p>
                    )}

                    {providerCredentialNotice && <p className="text-[12px] text-success">{providerCredentialNotice}</p>}
                    {providerCredentialError && <p className="text-[12px] text-danger">{providerCredentialError}</p>}
                    {oauthError && <p className="text-[12px] text-danger">{oauthError}</p>}
                    {selectedProviderLogin?.status === 'failed' && selectedProviderLogin.error && (
                      <p className="text-[12px] text-danger">OAuth login failed: {selectedProviderLogin.error}</p>
                    )}
                  </div>
                </div>
              </SettingsPanel>

            </div>
          </SettingsSection>

          <DesktopConnectionsSettingsPanel />

          <SettingsSection
            id="settings-interface"
            label="Interface"
            description="Browser-local UI state, saved layout preferences, and reset tools."
            className="order-5"
          >
            <SettingsPanel
              title="Reset saved UI preferences"
              description="Clears saved UI state only. Conversations and data stay intact."
            >
              {resetError && <p className="text-[12px] text-danger">Failed to reset UI state: {resetError}</p>}

              <div className="space-y-6">
                <div className="space-y-2 min-w-0">
                  <h3 className="text-[13px] font-medium text-primary">Layout widths</h3>
                  <p className="ui-card-meta">
                    Clears the stored sidebar width, knowledge sidebar state (expanded folders + open files + open-files shelf height), and per-doc context rail widths, then reloads the page.
                  </p>
                  <button
                    type="button"
                    onClick={() => { void handleReset('layout'); }}
                    disabled={resetting !== null}
                    className={ACTION_BUTTON_CLASS}
                  >
                    {resetting === 'layout' ? 'Resetting…' : 'Reset layout + reload'}
                  </button>
                </div>

                <div className="space-y-2 border-t border-border-subtle pt-6 min-w-0">
                  <h3 className="text-[13px] font-medium text-primary">Conversation UI state</h3>
                  <p className="ui-card-meta">
                    Clears stored open-tab state, seen message counts, and composer history in this browser, plus the durable open-tab snapshot stored by the web UI, then reloads the page.
                  </p>
                  <button
                    type="button"
                    onClick={() => { void handleReset('conversation'); }}
                    disabled={resetting !== null}
                    className={ACTION_BUTTON_CLASS}
                  >
                    {resetting === 'conversation' ? 'Resetting…' : 'Reset conversation UI + reload'}
                  </button>
                </div>
              </div>
            </SettingsPanel>
          </SettingsSection>
        </div>
      </AppPageLayout>
    </div>
  );
}

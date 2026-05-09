import {
  api,
  AppPageIntro,
  AppPageLayout,
  AppPageSection,
  AppPageToc,
  createDesktopAwareEventSource,
  createModelEditorDraft,
  createProviderEditorDraft,
  cx,
  type DesktopAppPreferencesState,
  type DesktopConnectionsState,
  type DesktopEnvironmentState,
  type DesktopHostRecord,
  type DesktopSshConnectionTestResult,
  type ExtensionKeybindingRegistration,
  formatContextWindowLabel,
  formatThinkingLevelLabel,
  getDesktopBridge,
  getModelSelectableServiceTierOptions,
  groupModelsByProvider,
  isDesktopShell,
  type ModelEditorDraft,
  type ModelProviderApi,
  type ModelProviderConfig,
  type ModelProviderModelConfig,
  type ModelProviderState,
  type ModelState,
  parseOptionalJsonObject,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveInteger,
  parseOptionalStringRecord,
  type ProviderAuthSummary,
  type ProviderEditorDraft,
  type ProviderOAuthLoginState,
  type ProviderOAuthLoginStreamEvent,
  readDesktopConnections,
  readDesktopEnvironment,
  SettingsPanelHost,
  subscribeDesktopProviderOAuthLogin,
  type ThemePreference,
  THINKING_LEVEL_OPTIONS,
  ToolbarButton,
  UnifiedSettingsEntry,
  useApi,
  useExtensionRegistry,
  useTheme,
} from '@personal-agent/extensions/settings';
import QRCode from 'qrcode';
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';
const SETTINGS_QUICK_LINKS = [
  { id: 'settings-appearance', label: 'Appearance', summary: 'Theme and display behavior' },
  { id: 'settings-conversation', label: 'Conversation', summary: 'Default model, vision, and thinking' },
  { id: 'settings-workspace', label: 'Workspace', summary: 'Default working directory' },
  { id: 'settings-skills', label: 'Skills', summary: 'Folders and AGENTS.md instructions' },
  { id: 'settings-tools', label: 'Tools', summary: 'MCP wrappers and runtime tool config' },
  { id: 'settings-providers', label: 'Providers', summary: 'Models, overrides, and credentials' },
  { id: 'settings-desktop', label: 'Desktop', summary: 'App behavior and SSH remotes' },
  { id: 'settings-extensions', label: 'Extensions', summary: 'Extension-declared settings' },
  { id: 'settings-keyboard', label: 'Keyboard', summary: 'Desktop shortcuts' },
] as const;

type SettingsQuickLink = (typeof SETTINGS_QUICK_LINKS)[number];
type SettingsQuickLinkId = SettingsQuickLink['id'];
const VisibleSettingsSectionsContext = createContext<ReadonlySet<SettingsQuickLinkId> | null>(null);
type ModelOption = ModelState['models'][number];

type DesktopKeyboardShortcutId = keyof DesktopAppPreferencesState['keyboardShortcuts'];

const DESKTOP_KEYBOARD_SHORTCUT_LABELS: Record<DesktopKeyboardShortcutId, { label: string; description: string }> = {
  showApp: { label: 'Show Personal Agent', description: 'Bring the desktop window forward.' },
  newConversation: { label: 'New conversation', description: 'Start a fresh chat.' },
  closeTab: { label: 'Close tab', description: 'Close the active conversation tab.' },
  reopenClosedTab: { label: 'Reopen closed tab', description: 'Restore the most recently closed conversation tab.' },
  previousConversation: { label: 'Previous conversation', description: 'Move to the previous open conversation.' },
  nextConversation: { label: 'Next conversation', description: 'Move to the next open conversation.' },
  togglePinned: { label: 'Toggle pinned', description: 'Pin or unpin the active conversation.' },
  archiveRestoreConversation: { label: 'Archive / restore', description: 'Archive or restore the active conversation.' },
  renameConversation: { label: 'Rename conversation', description: 'Rename the active conversation.' },
  focusComposer: { label: 'Focus composer', description: 'Move focus to the message composer.' },
  editWorkingDirectory: { label: 'Edit working directory', description: 'Open the working-directory editor.' },
  findOnPage: { label: 'Find on page', description: 'Search text in the current page.' },
  settings: { label: 'Settings', description: 'Open this settings page.' },
  quit: { label: 'Quit', description: 'Quit the desktop app.' },
  conversationMode: { label: 'Conversation mode', description: 'Show the normal chat layout.' },
  workbenchMode: { label: 'Workbench mode', description: 'Show the chat and workbench layout.' },
  toggleSidebar: { label: 'Toggle left sidebar', description: 'Collapse or restore the conversation sidebar.' },
  toggleRightRail: { label: 'Toggle right rail', description: 'Collapse or restore the active workbench rail.' },
};

const DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS: DesktopAppPreferencesState['keyboardShortcuts'] = {
  showApp: 'CommandOrControl+Shift+A',
  newConversation: 'CommandOrControl+N',
  closeTab: 'CommandOrControl+W',
  reopenClosedTab: 'Command+Shift+N',
  previousConversation: 'CommandOrControl+[',
  nextConversation: 'CommandOrControl+]',
  togglePinned: 'CommandOrControl+Alt+P',
  archiveRestoreConversation: 'CommandOrControl+Alt+A',
  renameConversation: 'CommandOrControl+Alt+R',
  focusComposer: 'CommandOrControl+L',
  editWorkingDirectory: 'CommandOrControl+Shift+L',
  findOnPage: 'CommandOrControl+F',
  settings: 'CommandOrControl+,',
  quit: 'CommandOrControl+Q',
  conversationMode: 'F1',
  workbenchMode: 'F2',
  toggleSidebar: 'CommandOrControl+/',
  toggleRightRail: 'CommandOrControl+\\',
};

const DESKTOP_KEYBOARD_SHORTCUT_IDS = Object.keys(DESKTOP_KEYBOARD_SHORTCUT_LABELS) as DesktopKeyboardShortcutId[];

type ShortcutListItem = {
  id: string;
  owner: string;
  label: string;
  description?: string;
  shortcuts: string[];
  editable: boolean;
  extensionId?: string;
  keybindingId?: string;
  enabled?: boolean;
  defaultShortcuts?: string[];
};

function normalizeShortcutForConflict(shortcut: string): string {
  return shortcut
    .trim()
    .toLowerCase()
    .replace(/commandorcontrol|cmdorctrl|cmd|command/g, 'mod')
    .replace(/control/g, 'ctrl');
}

const MODEL_PROVIDER_API_OPTIONS: Array<{ value: ModelProviderApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
];

const NEW_MODEL_PROVIDER_ID = '__new-model-provider__';
const NEW_MODEL_ID = '__new-model__';
const ADD_CUSTOM_PROVIDER_ID = '__add-custom-provider__';
const JSON_TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[88px] font-mono text-[11px] leading-5`;
const COMPACT_META_INPUT_CLASS = `${INPUT_CLASS} px-2.5 py-1.5 text-[12px]`;

function formatModelProviderSummary(provider: ModelProviderConfig): string {
  if (provider.models.length === 0) {
    return 'Provider override only';
  }

  return `${provider.models.length} ${provider.models.length === 1 ? 'model' : 'models'}`;
}

function formatProviderModelSummary(model: ModelProviderModelConfig): string {
  const parts = [model.name || model.id, `${formatContextWindowLabel(model.contextWindow ?? 128_000)} ctx`];

  if (model.reasoning) {
    parts.push('reasoning');
  }

  if (model.input.includes('image')) {
    parts.push('images');
  }

  return parts.join(' · ');
}

function listKnownModelProviderIds(
  modelProviderState: ModelProviderState | undefined,
  providerAuthState: { providers: ProviderAuthSummary[] } | undefined,
  models: ModelOption[] | undefined,
): string[] {
  const providerIds = new Set<string>();

  for (const provider of modelProviderState?.providers ?? []) {
    const id = provider.id.trim();
    if (id) {
      providerIds.add(id);
    }
  }

  for (const provider of providerAuthState?.providers ?? []) {
    const id = provider.id.trim();
    if (id) {
      providerIds.add(id);
    }
  }

  for (const model of models ?? []) {
    const provider = model.provider.trim();
    if (provider) {
      providerIds.add(provider);
    }
  }

  return [...providerIds].sort((left, right) => left.localeCompare(right));
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
      return provider.hasStoredCredential ? 'Stored API key in auth.json.' : 'API key is available at runtime.';
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

function ThemeButton({
  value,
  current,
  onSelect,
  label,
}: {
  value: ThemePreference;
  current: ThemePreference;
  onSelect: (theme: ThemePreference) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cx('ui-segmented-button capitalize', current === value && 'ui-segmented-button-active')}
      aria-pressed={current === value}
    >
      {label}
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
  id: SettingsQuickLinkId;
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const visibleSections = useContext(VisibleSettingsSectionsContext);
  if (visibleSections && !visibleSections.has(id)) {
    return null;
  }

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
    <section
      id={id}
      className={cx(
        'scroll-mt-24 grid gap-5 border-t border-border-subtle/70 py-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-8',
        className,
      )}
    >
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
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="16" height="10" rx="2.5" />
      <path d="M8 19h8" />
      <path d="M12 15v4" />
    </svg>
  );
}

function SshRemoteIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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
    case 'ready':
      return update.downloadedVersion
        ? state.autoInstallUpdates
          ? `Personal Agent ${update.downloadedVersion} is ready and will install automatically.`
          : `Personal Agent ${update.downloadedVersion} is ready. Quit the app to finish installing it.`
        : `Current version: ${update.currentVersion}.`;
    case 'installing':
      return update.downloadedVersion ? `Installing Personal Agent ${update.downloadedVersion}…` : 'Installing the downloaded update…';
    case 'error':
      return update.lastError ? `Update error: ${update.lastError}` : 'The last update action failed.';
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

function formatKeyboardShortcutLabel(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, '⌘/Ctrl')
    .replace(/Command/g, '⌘')
    .replace(/Control/g, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function normalizeKeyboardShortcutKey(event: ReactKeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code;

  switch (event.code) {
    case 'Space':
      return 'Space';
    case 'Tab':
      return 'Tab';
    case 'Enter':
    case 'NumpadEnter':
      return 'Enter';
    case 'Escape':
      return 'Escape';
    case 'Backspace':
      return 'Backspace';
    case 'Delete':
      return 'Delete';
    case 'Insert':
      return 'Insert';
    case 'Home':
      return 'Home';
    case 'End':
      return 'End';
    case 'PageUp':
      return 'PageUp';
    case 'PageDown':
      return 'PageDown';
    case 'ArrowUp':
      return 'Up';
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case 'Minus':
      return '-';
    case 'Equal':
      return '=';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Backslash':
      return '\\';
    case 'Semicolon':
      return ';';
    case 'Quote':
      return "'";
    case 'Comma':
      return ',';
    case 'Period':
      return '.';
    case 'Slash':
      return '/';
    case 'Backquote':
      return '`';
    case 'NumpadAdd':
      return 'Plus';
    case 'NumpadSubtract':
      return '-';
    case 'NumpadMultiply':
      return '*';
    case 'NumpadDivide':
      return '/';
    case 'NumpadDecimal':
      return '.';
    default:
      if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
      return null;
  }
}

function resolveKeyboardShortcutFromEvent(event: ReactKeyboardEvent): string | null {
  const key = normalizeKeyboardShortcutKey(event);
  if (!key) return null;

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  if (parts.length === 0 && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return null;
  }

  parts.push(key);
  return parts.join('+');
}

function KeyboardShortcutCaptureInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (shortcut: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      onClick={() => {
        setCapturing(true);
        setInvalid(false);
      }}
      onBlur={() => {
        setCapturing(false);
        setInvalid(false);
      }}
      onKeyDown={(event) => {
        if (!capturing) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setCapturing(true);
            setInvalid(false);
          }
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Escape') {
          setCapturing(false);
          setInvalid(false);
          return;
        }

        const shortcut = resolveKeyboardShortcutFromEvent(event);
        if (!shortcut) {
          setInvalid(true);
          return;
        }

        setInvalid(false);
        setCapturing(false);
        onChange(shortcut);
      }}
      className={cx(INPUT_CLASS, 'text-left', capturing && 'border-accent/60 bg-surface', invalid && 'border-danger/70')}
      aria-label={capturing ? 'Press a keyboard shortcut' : `Keyboard shortcut ${formatKeyboardShortcutLabel(value)}`}
    >
      <span className={cx('block truncate', capturing && 'text-accent', invalid && 'text-danger')}>
        {capturing ? (invalid ? 'Use a modifier, or press an F-key…' : 'Press shortcut…') : formatKeyboardShortcutLabel(value)}
      </span>
    </button>
  );
}

export function DesktopKeyboardShortcutsSettingsSection() {
  const [preferencesState, setPreferencesState] = useState<DesktopAppPreferencesState | null>(null);
  const [draft, setDraft] = useState<DesktopAppPreferencesState['keyboardShortcuts']>(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS);
  const [extensionKeybindings, setExtensionKeybindings] = useState<ExtensionKeybindingRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (!preferencesState) return false;
    return DESKTOP_KEYBOARD_SHORTCUT_IDS.some((id) => draft[id] !== preferencesState.keyboardShortcuts[id]);
  }, [draft, preferencesState]);

  const shortcutItems = useMemo<ShortcutListItem[]>(() => {
    const coreItems = DESKTOP_KEYBOARD_SHORTCUT_IDS.map((id) => ({
      id,
      owner: 'Core',
      label: DESKTOP_KEYBOARD_SHORTCUT_LABELS[id].label,
      description: DESKTOP_KEYBOARD_SHORTCUT_LABELS[id].description,
      shortcuts: [draft[id]],
      editable: true,
    }));
    const extensionItems = extensionKeybindings.map((keybinding) => ({
      id: `${keybinding.extensionId}:${keybinding.surfaceId}`,
      owner: keybinding.extensionId.replace(/^system-/, ''),
      label: keybinding.title,
      description: keybinding.scope === 'surface' ? 'Surface shortcut' : 'Extension shortcut',
      shortcuts: keybinding.enabled ? keybinding.keys : [],
      editable: true,
      extensionId: keybinding.extensionId,
      keybindingId: keybinding.surfaceId,
      enabled: keybinding.enabled,
      defaultShortcuts: keybinding.defaultKeys,
    }));
    return [...coreItems, ...extensionItems];
  }, [draft, extensionKeybindings]);

  const duplicateShortcut = useMemo(() => {
    const seen = new Map<string, ShortcutListItem>();
    for (const item of shortcutItems) {
      for (const shortcut of item.shortcuts) {
        const normalized = normalizeShortcutForConflict(shortcut);
        const previous = seen.get(normalized);
        if (previous) return { shortcut, first: previous, second: item };
        seen.set(normalized, item);
      }
    }
    return null;
  }, [shortcutItems]);

  const loadPreferences = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setLoading(false);
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    try {
      const state = await bridge.readDesktopAppPreferences();
      setPreferencesState(state);
      setDraft(state.keyboardShortcuts);
      setError(null);

      try {
        setExtensionKeybindings(await api.extensionKeybindings());
      } catch {
        setExtensionKeybindings([]);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  async function saveExtensionKeybinding(item: ShortcutListItem, input: { keys?: string[]; enabled?: boolean; reset?: boolean }) {
    if (!item.extensionId || !item.keybindingId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateExtensionKeybinding(item.extensionId, item.keybindingId, input);
      setExtensionKeybindings(await api.extensionKeybindings());
      setNotice('Saved extension shortcut.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  }

  async function saveKeyboardShortcuts(nextShortcuts = draft) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const state = await bridge.updateDesktopAppPreferences({ keyboardShortcuts: nextShortcuts });
      setPreferencesState(state);
      setDraft(state.keyboardShortcuts);
      setNotice('Saved. The app menu updated immediately.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection id="settings-keyboard" label="Keyboard" description="Configure desktop app shortcuts.">
      <SettingsPanel title="Keyboard shortcuts" description="Every desktop menu shortcut is configurable and auto-saves immediately.">
        {loading ? <p className="ui-card-meta">Loading keyboard shortcuts…</p> : null}
        {!loading && !preferencesState ? <p className="ui-card-meta">Keyboard shortcuts are available in the desktop app.</p> : null}
        {preferencesState ? (
          <div className="space-y-4">
            <div className="divide-y divide-border-subtle/70">
              {shortcutItems.map((item) => {
                const editableId = item.extensionId ? null : item.editable ? (item.id as DesktopKeyboardShortcutId) : null;
                const shortcutValue = item.extensionId
                  ? (item.shortcuts[0] ?? item.defaultShortcuts?.[0] ?? '')
                  : editableId
                    ? draft[editableId]
                    : '';
                return (
                  <div key={item.id} className="grid gap-3 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center">
                    <span className="min-w-0 space-y-1">
                      <span className="block text-[13px] font-medium text-primary">{item.label}</span>
                      <span className="block text-[12px] leading-5 text-secondary">
                        {item.owner}
                        {item.description ? ` · ${item.description}` : ''}
                      </span>
                    </span>
                    {editableId || item.extensionId ? (
                      <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                        <KeyboardShortcutCaptureInput
                          id={`settings-keyboard-${item.id}`}
                          value={item.enabled === false ? 'Disabled' : shortcutValue}
                          onChange={(shortcut) => {
                            if (editableId) {
                              const nextDraft = { ...draft, [editableId]: shortcut };
                              setDraft(nextDraft);
                              setError(null);
                              setNotice(null);
                              void saveKeyboardShortcuts(nextDraft);
                              return;
                            }
                            void saveExtensionKeybinding(item, { keys: [shortcut], enabled: true });
                          }}
                          disabled={saving || item.enabled === false}
                        />
                        {item.extensionId ? (
                          <>
                            <button
                              type="button"
                              className={ACTION_BUTTON_CLASS}
                              disabled={saving}
                              onClick={() => void saveExtensionKeybinding(item, { enabled: item.enabled === false })}
                            >
                              {item.enabled === false ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              type="button"
                              className={ACTION_BUTTON_CLASS}
                              disabled={saving}
                              onClick={() => void saveExtensionKeybinding(item, { reset: true })}
                            >
                              Reset
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {duplicateShortcut ? (
              <p className="text-[12px] text-danger">
                {formatKeyboardShortcutLabel(duplicateShortcut.shortcut)} is assigned to both {duplicateShortcut.first.label} and{' '}
                {duplicateShortcut.second.label}.
              </p>
            ) : null}
            {error ? <p className="text-[12px] text-danger">{error}</p> : null}
            {notice ? <p className="text-[12px] text-success">{notice}</p> : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className="ui-card-meta">{saving ? 'Saving…' : dirty ? 'Unsaved change pending…' : 'Auto-saved'}</span>
              <button
                type="button"
                onClick={() => {
                  setDraft(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS);
                  void saveKeyboardShortcuts(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS);
                }}
                disabled={saving || duplicateShortcut !== null}
                className={ACTION_BUTTON_CLASS}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        ) : null}
      </SettingsPanel>
    </SettingsSection>
  );
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
    const data = (await response.json()) as { error?: string };
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

export function formatCompanionTimestamp(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/);
  if (!match || !hasValidIsoDateParts(match)) {
    return value;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
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
    const selectedLink = latestSetup?.links.find((entry) => entry.id === selectedSetupLinkId) ?? latestSetup?.links[0] ?? null;
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
    })
      .then((svg) => {
        if (active) {
          setSetupQrSvg(svg);
        }
      })
      .catch((nextError) => {
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
      const result = await requestCompanionJson<{ devices: CompanionDeviceSummaryState[] }>(
        'DELETE',
        `/companion/v1/admin/devices/${encodeURIComponent(deviceId)}`,
      );
      setAdminState((current) => (current ? { ...current, devices: result.devices } : { pendingPairings: [], devices: result.devices }));
      setNotice('Paired device revoked.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  };

  const selectedSetupLink = latestSetup?.links.find((entry) => entry.id === selectedSetupLinkId) ?? latestSetup?.links[0] ?? null;

  return (
    <SettingsPanel
      title="Companion access"
      description="Generate phone setup QR codes and manage companion devices for the daemon-backed companion API. The desktop app will enable local-network phone access automatically when needed."
    >
      {loading ? <p className="ui-card-meta">Loading companion access state…</p> : null}
      {hello ? (
        <div className="space-y-1 text-[12px] text-secondary">
          <p>
            <span className="text-primary">{hello.hostLabel}</span> · protocol {hello.protocolVersion}
          </p>
          <p className="font-mono text-[11px] text-dim break-all">{hello.hostInstanceId}</p>
        </div>
      ) : null}
      {notice ? <p className="text-[12px] text-accent">{notice}</p> : null}
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void handleCreatePairingCode();
          }}
          disabled={action !== null}
          className={ACTION_BUTTON_CLASS}
        >
          {action === 'create-setup' ? 'Creating…' : 'Generate setup QR'}
        </button>
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
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
                  <p>
                    <span className="text-primary">Base URL</span> ·{' '}
                    <span className="font-mono break-all">{selectedSetupLink?.baseUrl}</span>
                  </p>
                  <p>
                    <span className="text-primary">Route</span> · <span className="font-mono break-all">{selectedSetupLink?.label}</span>
                  </p>
                  <p className="text-[11px] text-dim">
                    If the phone camera does not open the app directly, scan this QR inside the iPhone app instead.
                  </p>
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
                  onClick={() => {
                    void handleRevokeDevice(device.id);
                  }}
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
  return <AppPageToc items={items} activeId={activeId} onNavigate={onNavigate} ariaLabel="Settings sections" />;
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

  const selectedHost = useMemo(() => connections?.hosts.find((host) => host.id === selectedHostId) ?? null, [connections, selectedHostId]);

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
    bridge
      .readDesktopAppPreferences()
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

  async function handleUpdateAppPreferences(nextPreferences: {
    autoInstallUpdates?: boolean;
    startOnSystemStart?: boolean;
    keyboardShortcuts?: Record<string, string>;
  }) {
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
    <SettingsSection id="settings-desktop" label="Desktop" description="Manage local app behavior and SSH remotes.">
      <SettingsPanel title="App behavior" description="Control how the menu bar app starts and how downloaded updates install.">
        {!getDesktopBridge() && isDesktopShell() ? (
          <p className="text-[12px] text-danger">Desktop bridge unavailable. Restart the desktop app and try again.</p>
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
              <span>Install downloaded updates automatically</span>
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
                  <p className="mt-1 text-[12px] text-secondary">
                    Use SSH aliases from <span className="font-mono text-[11px]">~/.ssh/config</span> or full targets.
                  </p>
                </div>
                <button type="button" onClick={beginNewRemote} disabled={action !== null} className={ACTION_BUTTON_CLASS}>
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
                        onClick={() => {
                          selectRemote(host);
                        }}
                        disabled={action !== null}
                        className={cx(
                          'group flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
                          selected
                            ? 'bg-accent/6 text-primary ring-1 ring-accent/15'
                            : 'text-secondary hover:bg-surface hover:text-primary',
                        )}
                      >
                        <SshRemoteIcon
                          className={cx('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-dim/80 group-hover:text-accent')}
                        />
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
                  <p className="mt-1 text-[12px] leading-5 text-secondary">
                    Add an SSH target here, then pick it per conversation from the footer.
                  </p>
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
                    onClick={() => {
                      void handleDelete(selectedHost.id);
                    }}
                    disabled={action !== null}
                    className={ACTION_BUTTON_CLASS}
                  >
                    {action === 'delete' ? 'Deleting…' : 'Delete remote'}
                  </button>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 min-w-0">
                  <label className="ui-card-meta" htmlFor="desktop-host-id">
                    Host id
                  </label>
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
                  <label className="ui-card-meta" htmlFor="desktop-host-label">
                    Label
                  </label>
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
                  <label className="ui-card-meta" htmlFor="desktop-host-ssh-target">
                    SSH target
                  </label>
                  <input
                    id="desktop-host-ssh-target"
                    value={draft.sshTarget}
                    onChange={(event) => updateDraft((current) => ({ ...current, sshTarget: event.target.value }))}
                    disabled={action !== null}
                    className={`${INPUT_CLASS} font-mono text-[13px]`}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="user@desktop"
                  />
                  <p className="text-[11px] text-dim">
                    Use a host alias or any target that works with your normal <span className="font-mono">ssh</span> command.
                  </p>
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
                  onClick={() => {
                    void handleTestSshConnection();
                  }}
                  disabled={action !== null}
                  className={ACTION_BUTTON_CLASS}
                >
                  {action === 'test-ssh' ? 'Testing…' : 'Test SSH'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSave();
                  }}
                  disabled={action !== null}
                  className={ACTION_BUTTON_CLASS}
                >
                  {action === 'save' ? 'Saving…' : selectedHost ? 'Save changes' : 'Add remote'}
                </button>
                {selectedHost ? (
                  <button type="button" onClick={beginNewRemote} disabled={action !== null} className={ACTION_BUTTON_CLASS}>
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

function ExtensionSettingsSection() {
  const { data: values, loading, error } = useApi<Record<string, unknown>>(api.settings as never);
  const { data: schema, loading: schemaLoading, error: schemaError } = useApi<UnifiedSettingsEntry[]>(api.settingsSchema as never);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

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

  useEffect(() => {
    if (!values || !draft) return;
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
  }, [draft, values]);

  const grouped = useMemo(() => {
    if (!schema) return new Map<string, UnifiedSettingsEntry[]>();
    const groups = new Map<string, UnifiedSettingsEntry[]>();
    for (const entry of schema) {
      const group = entry.group || 'General';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(entry);
    }
    for (const [, entries] of groups) {
      entries.sort((a, b) => a.order - b.order);
    }
    return groups;
  }, [schema]);

  if (loading || schemaLoading) return null;
  if (error || schemaError) return null;
  if (grouped.size === 0) return null;

  return (
    <SettingsSection
      id="settings-extensions"
      label="Extension Settings"
      description="User-facing settings declared by extensions. Changes save to the unified settings store."
    >
      <div className="space-y-0">
        {[...grouped.entries()].map(([group, entries]) => (
          <SettingsPanel key={group} title={group}>
            {entries.map((entry) => {
              const currentValue = draft[entry.key] ?? entry.default;
              return (
                <div key={entry.key} className="space-y-2 py-3 first:pt-0">
                  <label className="block text-[13px] font-medium text-primary">
                    {entry.key.split('.').pop() ?? entry.key}
                    {entry.description ? <span className="ml-2 font-normal text-[12px] text-secondary">{entry.description}</span> : null}
                  </label>
                  {entry.type === 'boolean' ? (
                    <label className="inline-flex items-center gap-3 text-[14px] text-primary">
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
                      className={INPUT_CLASS}
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
                      className={INPUT_CLASS}
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
                      className={`${INPUT_CLASS} font-mono text-[13px]`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  )}
                </div>
              );
            })}
            {saving ? <p className="ui-card-meta">Saving…</p> : null}
            {saveNotice ? <p className="text-[12px] text-accent">{saveNotice}</p> : null}
            {saveError ? <p className="text-[12px] text-danger">{saveError}</p> : null}
          </SettingsPanel>
        ))}
      </div>
    </SettingsSection>
  );
}

export function SettingsPage({ sectionIds }: { sectionIds?: SettingsQuickLinkId[] } = {}) {
  const { settingsComponent } = useExtensionRegistry();
  const { theme, themePreference, lightTheme, darkTheme, availableThemes, setThemePreference, setLightTheme, setDarkTheme } = useTheme();
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
  const { data: modelState, loading: modelsLoading, error: modelsError, refetch: refetchModels } = useApi(api.models);
  const {
    data: modelProviderState,
    loading: modelProviderLoading,
    error: modelProviderError,
    replaceData: replaceModelProviderState,
  } = useApi(api.modelProviders);
  const {
    data: defaultCwdState,
    loading: defaultCwdLoading,
    error: defaultCwdLoadError,
    refetch: refetchDefaultCwd,
  } = useApi(api.defaultCwd);
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
  const [savingPreference, setSavingPreference] = useState<'model' | 'visionModel' | 'thinking' | 'serviceTier' | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [defaultCwdDraft, setDefaultCwdDraft] = useState('');
  const [savingDefaultCwd, setSavingDefaultCwd] = useState(false);
  const [defaultCwdSaveError, setDefaultCwdSaveError] = useState<string | null>(null);
  const [pathPickerTarget, setPathPickerTarget] = useState<'default-cwd' | 'skill-folders' | 'instruction-files' | null>(null);
  const [selectedModelProviderId, setSelectedModelProviderId] = useState('');
  const [providerEditorMode, setProviderEditorMode] = useState<'provider' | 'custom'>('custom');
  const [modelProviderPickerId, setModelProviderPickerId] = useState('');
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
  const settingsScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeQuickLinkId, setActiveQuickLinkId] = useState<SettingsQuickLinkId>(SETTINGS_QUICK_LINKS[0].id);

  const visibleSectionIds = useMemo(() => (sectionIds ? new Set(sectionIds) : null), [sectionIds]);
  const visibleQuickLinks = useMemo<readonly SettingsQuickLink[]>(() => {
    const extensionSectionIds = settingsComponent ? new Set([settingsComponent.sectionId]) : new Set();
    const shellFiltered =
      desktopEnvironment?.isElectron || isDesktopShell()
        ? SETTINGS_QUICK_LINKS
        : SETTINGS_QUICK_LINKS.filter((item) => item.id !== 'settings-desktop' && item.id !== 'settings-keyboard');
    const extensionFiltered = shellFiltered.filter((item) => item.id !== 'settings-dictation' || extensionSectionIds.has(item.id));
    return visibleSectionIds ? extensionFiltered.filter((item) => visibleSectionIds.has(item.id)) : extensionFiltered;
  }, [desktopEnvironment?.isElectron, settingsComponent, visibleSectionIds]);

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

    const sections = visibleQuickLinks
      .map((item) => {
        const section = container.querySelector<HTMLElement>(`#${item.id}`);
        return section ? { id: item.id, section } : null;
      })
      .filter((item): item is { id: SettingsQuickLinkId; section: HTMLElement } => item !== null);
    if (sections.length === 0) {
      return undefined;
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const visibleIds = new Set<SettingsQuickLinkId>();
      const updateActiveQuickLink = () => {
        let nextId = sections[0].id;
        for (const item of sections) {
          if (visibleIds.has(item.id)) {
            nextId = item.id;
          }
        }

        setActiveQuickLinkId((current) => (current === nextId ? current : nextId));
      };

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const sectionId = entry.target.id as SettingsQuickLinkId;
            if (entry.isIntersecting) {
              visibleIds.add(sectionId);
            } else {
              visibleIds.delete(sectionId);
            }
          }

          updateActiveQuickLink();
        },
        {
          root: container,
          rootMargin: '-96px 0px -60% 0px',
          threshold: 0,
        },
      );

      for (const item of sections) {
        observer.observe(item.section);
      }

      return () => {
        observer.disconnect();
      };
    }

    let frame: number | null = null;
    const updateActiveQuickLink = () => {
      frame = null;
      const containerTop = container.getBoundingClientRect().top;
      let nextId = sections[0].id;

      for (const item of sections) {
        if (item.section.getBoundingClientRect().top - containerTop <= 96) {
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

  const groupedModels = useMemo(() => groupModelsByProvider(modelState?.models ?? []), [modelState?.models]);
  const imageCapableModels = useMemo(
    () => (modelState?.models ?? []).filter((model) => model.input?.includes('image')),
    [modelState?.models],
  );
  const groupedImageCapableModels = useMemo(() => groupModelsByProvider(imageCapableModels), [imageCapableModels]);

  const selectedModel = useMemo(() => {
    if (!modelState?.currentModel) {
      return null;
    }

    return modelState.models.find((model) => model.id === modelState.currentModel) ?? null;
  }, [modelState]);

  const selectedVisionModel = useMemo(
    () => findModelByRef(modelState?.models ?? [], modelState?.currentVisionModel ?? ''),
    [modelState?.currentVisionModel, modelState?.models],
  );

  const selectedModelServiceTierOptions = useMemo(() => getModelSelectableServiceTierOptions(selectedModel), [selectedModel]);
  const selectedModelSupportsFastMode = useMemo(
    () => selectedModelServiceTierOptions.some((option) => option.value === 'priority'),
    [selectedModelServiceTierOptions],
  );

  const availableModelProviderIds = useMemo(
    () => listKnownModelProviderIds(modelProviderState, providerAuthState, modelState?.models),
    [modelProviderState, providerAuthState, modelState?.models],
  );
  const unconfiguredModelProviderIds = useMemo(() => {
    const configured = new Set((modelProviderState?.providers ?? []).map((provider) => provider.id));
    for (const provider of providerAuthState?.providers ?? []) {
      if (provider.authType !== 'none' || provider.hasStoredCredential) {
        configured.add(provider.id);
      }
    }
    return availableModelProviderIds.filter((providerId) => !configured.has(providerId));
  }, [availableModelProviderIds, modelProviderState?.providers, providerAuthState?.providers]);
  const configuredProviderSummaries = useMemo(() => {
    const summaries = new Map<string, { id: string; modelProvider: ModelProviderConfig | null; auth: ProviderAuthSummary | null }>();

    for (const provider of modelProviderState?.providers ?? []) {
      summaries.set(provider.id, { id: provider.id, modelProvider: provider, auth: null });
    }

    for (const auth of providerAuthState?.providers ?? []) {
      const isConfigured = auth.authType !== 'none' || auth.hasStoredCredential;
      if (!isConfigured) {
        continue;
      }

      const current = summaries.get(auth.id);
      summaries.set(auth.id, {
        id: auth.id,
        modelProvider: current?.modelProvider ?? null,
        auth,
      });
    }

    return [...summaries.values()].sort((left, right) => left.id.localeCompare(right.id));
  }, [modelProviderState?.providers, providerAuthState?.providers]);

  const selectedModelProvider = useMemo(() => {
    if (!modelProviderState || !selectedModelProviderId || selectedModelProviderId === NEW_MODEL_PROVIDER_ID) {
      return null;
    }

    return modelProviderState.providers.find((provider) => provider.id === selectedModelProviderId) ?? null;
  }, [modelProviderState, selectedModelProviderId]);

  const editableModelProviderId = useMemo(() => {
    if (selectedModelProvider) {
      return selectedModelProvider.id;
    }

    if (selectedModelProviderId === NEW_MODEL_PROVIDER_ID) {
      return modelProviderDraft.id.trim();
    }

    return '';
  }, [modelProviderDraft.id, selectedModelProvider, selectedModelProviderId]);

  const builtInProviderModels = useMemo(
    () => (modelState?.models ?? []).filter((model) => model.provider === editableModelProviderId),
    [editableModelProviderId, modelState?.models],
  );

  const editingProviderModel = useMemo(() => {
    if (!selectedModelProvider || !editingModelId || editingModelId === NEW_MODEL_ID) {
      return null;
    }

    return selectedModelProvider.models.find((model) => model.id === editingModelId) ?? null;
  }, [editingModelId, selectedModelProvider]);

  const isEditingBuiltInOverride = useMemo(
    () =>
      editingModelId !== null &&
      editingModelId !== NEW_MODEL_ID &&
      editingProviderModel === null &&
      builtInProviderModels.some((model) => model.id === editingModelId),
    [editingModelId, editingProviderModel, builtInProviderModels],
  );

  const selectedProvider = useMemo(() => {
    if (!providerAuthState || !selectedProviderId) {
      return null;
    }

    return providerAuthState.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  }, [providerAuthState, selectedProviderId]);

  const modalProviderAuth = useMemo(() => {
    if (!providerAuthState || !editableModelProviderId) {
      return null;
    }

    return providerAuthState.providers.find((provider) => provider.id === editableModelProviderId) ?? null;
  }, [editableModelProviderId, providerAuthState]);

  const defaultCwdDirty = defaultCwdState ? defaultCwdDraft.trim() !== defaultCwdState.currentCwd : false;
  const skillFoldersDirty = skillFoldersState
    ? skillFoldersDraft.length !== skillFoldersState.skillDirs.length ||
      skillFoldersDraft.some((value, index) => value !== skillFoldersState.skillDirs[index])
    : false;
  const instructionFilesDirty = instructionFilesState
    ? instructionFilesDraft.length !== instructionFilesState.instructionFiles.length ||
      instructionFilesDraft.some((value, index) => value !== instructionFilesState.instructionFiles[index])
    : false;
  const pickingDefaultCwd = pathPickerTarget === 'default-cwd';
  const pickingSkillFolders = pathPickerTarget === 'skill-folders';
  const pickingInstructionFiles = pathPickerTarget === 'instruction-files';

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
    if (!modelProviderState || !selectedModelProviderId) {
      return;
    }

    if (selectedModelProviderId !== NEW_MODEL_PROVIDER_ID) {
      const selectedStillExists = modelProviderState.providers.some((provider) => provider.id === selectedModelProviderId);
      if (!selectedStillExists) {
        setSelectedModelProviderId('');
        setSelectedProviderId('');
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

  // Open auth URL in system browser when it becomes available during OAuth login.
  // Electron's shell.openExternal is not subject to popup-blocker timing, unlike window.open from this async effect.
  useEffect(() => {
    if (oauthLoginState?.status !== 'running' || !oauthLoginState.authUrl) {
      return;
    }

    const desktopBridge = getDesktopBridge();
    if (desktopBridge && desktopEnvironment?.activeHostKind === 'local') {
      void desktopBridge.openExternalUrl(oauthLoginState.authUrl);
      return;
    }

    window.open(oauthLoginState.authUrl, '_blank');
  }, [desktopEnvironment?.activeHostKind, oauthLoginState?.authUrl, oauthLoginState?.status]);

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
      void Promise.all([refetchProviderAuth({ resetLoading: false }), refetchModels({ resetLoading: false })]);
      return;
    }

    if (oauthLoginState.status === 'failed') {
      setOauthError(oauthLoginState.error || `OAuth login failed for ${oauthLoginState.provider}.`);
    }
  }, [oauthLoginState, refetchModels, refetchProviderAuth]);

  const selectedProviderLogin =
    oauthLoginState && selectedProvider && oauthLoginState.provider === selectedProvider.id ? oauthLoginState : null;

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

      setSkillFoldersDraft((current) => (current.includes(result.path) ? current : [...current, result.path]));
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

  async function handleModelPreferenceChange(
    input: { model?: string; visionModel?: string; thinkingLevel?: string; serviceTier?: string },
    field: 'model' | 'visionModel' | 'thinking' | 'serviceTier',
  ) {
    if (!modelState || savingPreference !== null) {
      return;
    }

    if (field === 'model' && (!input.model || input.model === modelState.currentModel)) {
      return;
    }

    if (field === 'visionModel' && input.visionModel === modelState.currentVisionModel) {
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
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingPreference(null);
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

  useEffect(() => {
    if (!skillFoldersState || !skillFoldersDirty || savingSkillFolders || pickingSkillFolders) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void handleSaveSkillFolders();
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pickingSkillFolders, savingSkillFolders, skillFoldersDirty, skillFoldersDraft, skillFoldersState]);

  useEffect(() => {
    if (!instructionFilesState || !instructionFilesDirty || savingInstructionFiles || pickingInstructionFiles) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void handleSaveInstructionFiles();
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [instructionFilesDirty, instructionFilesDraft, instructionFilesState, pickingInstructionFiles, savingInstructionFiles]);

  useEffect(() => {
    if (!defaultCwdState || !defaultCwdDirty || savingDefaultCwd || pickingDefaultCwd) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void handleDefaultCwdSave();
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [defaultCwdDirty, defaultCwdDraft, defaultCwdState, pickingDefaultCwd, savingDefaultCwd]);

  function startNewModelProvider(initialId = '', mode: 'provider' | 'custom' = initialId ? 'provider' : 'custom') {
    setSelectedModelProviderId(NEW_MODEL_PROVIDER_ID);
    setSelectedProviderId(mode === 'provider' ? initialId : '');
    setModelProviderDraft({
      ...createProviderEditorDraft(null),
      id: mode === 'provider' ? initialId : '',
    });
    setEditingModelId(null);
    setModelDraft(createModelEditorDraft(null));
    setModelProviderEditorError(null);
    setModelProviderMessage(null);
    setModelDraftError(null);
    setModelDraftMessage(null);
    setProviderCredentialError(null);
    setProviderCredentialNotice(null);
    setProviderEditorMode(mode);
  }

  function selectModelProvider(providerId: string) {
    if (providerId === NEW_MODEL_PROVIDER_ID) {
      startNewModelProvider();
      return;
    }

    const provider = modelProviderState?.providers.find((candidate) => candidate.id === providerId) ?? null;
    setSelectedModelProviderId(providerId);
    setSelectedProviderId(providerId);
    setModelProviderDraft(createProviderEditorDraft(provider));
    setEditingModelId(null);
    setModelDraft(createModelEditorDraft(null));
    setModelProviderEditorError(null);
    setModelProviderMessage(null);
    setModelDraftError(null);
    setModelDraftMessage(null);
    setProviderCredentialError(null);
    setProviderCredentialNotice(null);
    setProviderEditorMode('custom');
  }

  function closeProviderEditor() {
    if (modelProviderAction !== null || modelDraftAction !== null || providerCredentialAction !== null || oauthAction !== null) {
      return;
    }

    setSelectedModelProviderId('');
    setSelectedProviderId('');
    setEditingModelId(null);
    setModelDraft(createModelEditorDraft(null));
    setModelProviderEditorError(null);
    setModelProviderMessage(null);
    setModelDraftError(null);
    setModelDraftMessage(null);
    setProviderCredentialError(null);
    setProviderCredentialNotice(null);
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

  function startEditingBuiltInModel(modelId: string) {
    const builtInModel = builtInProviderModels.find((candidate) => candidate.id === modelId);
    if (!builtInModel) {
      return;
    }

    // Check if there's already a custom override for this built-in model
    const existingOverride = selectedModelProvider?.models.find((candidate) => candidate.id === modelId) ?? null;
    if (existingOverride) {
      startEditingProviderModel(modelId);
      return;
    }

    // Pre-fill the model editor with the built-in model's values so the user
    // can create a custom override with changes (e.g. a different context window).
    setEditingModelId(modelId);
    setModelDraft({
      ...createModelEditorDraft(null),
      id: builtInModel.id,
      name: builtInModel.name,
      contextWindow: String(builtInModel.context),
    });
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
      setSelectedProviderId(providerId);
      setModelProviderMessage(existed ? `Saved ${providerId}.` : `Created ${providerId}.`);
      await Promise.all([refetchModels({ resetLoading: false }), refetchProviderAuth({ resetLoading: false })]);
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
      await Promise.all([refetchModels({ resetLoading: false }), refetchProviderAuth({ resetLoading: false })]);
    } catch (error) {
      setModelProviderEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelProviderAction(null);
    }
  }

  async function handleSaveProviderModel() {
    if (modelDraftAction !== null) {
      return;
    }

    const providerId = editableModelProviderId;
    if (!providerId) {
      setModelDraftError('Pick or type a provider id first.');
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
      const contextWindow = parseOptionalPositiveInteger(modelDraft.contextWindow, 'Context window');
      const maxTokens = parseOptionalPositiveInteger(modelDraft.maxTokens, 'Max tokens');
      const costInput = parseOptionalNonNegativeNumber(modelDraft.costInput, 'Input cost');
      const costOutput = parseOptionalNonNegativeNumber(modelDraft.costOutput, 'Output cost');
      const costCacheRead = parseOptionalNonNegativeNumber(modelDraft.costCacheRead, 'Cache read cost');
      const costCacheWrite = parseOptionalNonNegativeNumber(modelDraft.costCacheWrite, 'Cache write cost');
      const existed = editingProviderModel?.id === modelId;

      setModelDraftAction('save');
      setModelDraftError(null);
      setModelDraftMessage(null);

      const state = await api.saveModelProviderModel(providerId, {
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

      syncModelProviderSelection(state, providerId, modelId);
      setSelectedProviderId(providerId);
      setModelDraftMessage(existed ? `Saved ${modelId}.` : `Added ${modelId}.`);
      await Promise.all([refetchModels({ resetLoading: false }), refetchProviderAuth({ resetLoading: false })]);
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
      await Promise.all([refetchModels({ resetLoading: false }), refetchProviderAuth({ resetLoading: false })]);
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
      await Promise.all([refetchProviderAuth({ resetLoading: false }), refetchModels({ resetLoading: false })]);
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
      await Promise.all([refetchProviderAuth({ resetLoading: false }), refetchModels({ resetLoading: false })]);
    } catch (error) {
      setProviderCredentialError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderCredentialAction(null);
    }
  }

  async function handleStartProviderOAuthLogin() {
    if (!modalProviderAuth || !modalProviderAuth.oauthSupported || oauthAction !== null) {
      return;
    }

    setProviderCredentialNotice(null);
    setProviderCredentialError(null);
    setOauthError(null);
    setOauthInputValue('');
    setOauthAction('start');

    try {
      const login = await api.startProviderOAuthLogin(modalProviderAuth.id);
      setOauthLoginState(login);

      if (login.status === 'completed') {
        setProviderCredentialNotice(`Logged in to ${login.providerName}.`);
        await Promise.all([refetchProviderAuth({ resetLoading: false }), refetchModels({ resetLoading: false })]);
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

  function navigateToSection(sectionId: SettingsQuickLinkId) {
    setActiveQuickLinkId(sectionId);
    const section = settingsScrollRef.current?.querySelector<HTMLElement>(`#${sectionId}`);
    section?.scrollIntoView({ block: 'start' });
  }

  return (
    <VisibleSettingsSectionsContext.Provider value={visibleSectionIds}>
      <div ref={settingsScrollRef} className="h-full overflow-y-auto">
        <AppPageLayout
          asideLayout="centered"
          contentClassName="flex flex-col gap-10"
          aside={
            visibleQuickLinks.length > 1 ? (
              <SettingsTableOfContents items={visibleQuickLinks} activeId={activeQuickLinkId} onNavigate={navigateToSection} />
            ) : undefined
          }
        >
          <AppPageIntro title="Settings" summary="Appearance, conversation defaults, workspace, skills, providers, and runtime behavior." />

          <div className="flex flex-col gap-12">
            <SettingsSection
              id="settings-appearance"
              label="Appearance"
              description="Theme and other visual preferences for the desktop app."
            >
              <div className="space-y-0">
                <SettingsPanel title="Theme" description="Choose Auto to follow the OS.">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="ui-segmented-control" role="group" aria-label="Theme mode selection">
                        <ThemeButton value="system" current={themePreference} onSelect={setThemePreference} label="Auto" />
                        <ThemeButton value="light" current={themePreference} onSelect={setThemePreference} label="Light" />
                        <ThemeButton value="dark" current={themePreference} onSelect={setThemePreference} label="Dark" />
                      </div>
                      <span className="ui-card-meta">
                        Current theme: {availableThemes.find((availableTheme) => availableTheme.id === theme)?.label ?? theme}
                        {themePreference === 'system' ? ' (auto)' : ''}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5 text-xs font-medium text-secondary">
                        <span>Light default</span>
                        <select className="ui-input" value={lightTheme} onChange={(event) => setLightTheme(event.target.value)}>
                          {availableThemes
                            .filter((availableTheme) => availableTheme.appearance === 'light')
                            .map((availableTheme) => (
                              <option key={availableTheme.id} value={availableTheme.id}>
                                {availableTheme.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-xs font-medium text-secondary">
                        <span>Dark default</span>
                        <select className="ui-input" value={darkTheme} onChange={(event) => setDarkTheme(event.target.value)}>
                          {availableThemes
                            .filter((availableTheme) => availableTheme.appearance === 'dark')
                            .map((availableTheme) => (
                              <option key={availableTheme.id} value={availableTheme.id}>
                                {availableTheme.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </SettingsPanel>
              </div>
            </SettingsSection>
            <SettingsSection
              id="settings-skills"
              label="Skills"
              description="Skill discovery folders and extra runtime AGENTS.md instructions."
            >
              <div className="space-y-0">
                <SettingsPanel title="Skill folders" description="Load extra skill folders alongside the root skills directory.">
                  {skillFoldersLoading && !skillFoldersState ? (
                    <p className="ui-card-meta">Loading skill folders…</p>
                  ) : skillFoldersError && !skillFoldersState ? (
                    <p className="text-[12px] text-danger">Failed to load skill folders: {skillFoldersError}</p>
                  ) : skillFoldersState ? (
                    <div className="space-y-3">
                      <p className="ui-card-meta break-all">
                        Configured in <span className="font-mono text-[11px]">{skillFoldersState.configFile}</span>.
                      </p>
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
                                  onClick={() => {
                                    handleMoveSkillFolder(index, -1);
                                  }}
                                  disabled={savingSkillFolders || index === 0}
                                  className={ACTION_BUTTON_CLASS}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleMoveSkillFolder(index, 1);
                                  }}
                                  disabled={savingSkillFolders || index === skillFoldersDraft.length - 1}
                                  className={ACTION_BUTTON_CLASS}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleRemoveSkillFolder(index);
                                  }}
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
                          onClick={() => {
                            void handleAddSkillFolder();
                          }}
                          disabled={savingSkillFolders || pickingSkillFolders}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {pickingSkillFolders ? 'Picking…' : 'Add folder'}
                        </button>
                        <span className="ui-card-meta">
                          {savingSkillFolders ? 'Saving…' : skillFoldersDirty ? 'Auto-save pending…' : 'Auto-saved'}
                        </span>
                      </div>
                      <p className="ui-card-meta">Folders load in the saved order after the root skills directory.</p>
                    </div>
                  ) : null}

                  {skillFoldersSaveError && <p className="text-[12px] text-danger">{skillFoldersSaveError}</p>}
                </SettingsPanel>

                <SettingsPanel title="AGENTS.md files" description="Append extra AGENTS.md-style files to the runtime prompt.">
                  {instructionFilesLoading && !instructionFilesState ? (
                    <p className="ui-card-meta">Loading AGENTS.md files…</p>
                  ) : instructionFilesError && !instructionFilesState ? (
                    <p className="text-[12px] text-danger">Failed to load AGENTS.md files: {instructionFilesError}</p>
                  ) : instructionFilesState ? (
                    <div className="space-y-3">
                      <p className="ui-card-meta break-all">
                        Configured in <span className="font-mono text-[11px]">{instructionFilesState.configFile}</span>.
                      </p>
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
                                  onClick={() => {
                                    handleMoveInstructionFile(index, -1);
                                  }}
                                  disabled={savingInstructionFiles || index === 0}
                                  className={ACTION_BUTTON_CLASS}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleMoveInstructionFile(index, 1);
                                  }}
                                  disabled={savingInstructionFiles || index === instructionFilesDraft.length - 1}
                                  className={ACTION_BUTTON_CLASS}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleRemoveInstructionFile(index);
                                  }}
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
                          onClick={() => {
                            void handleAddInstructionFiles();
                          }}
                          disabled={savingInstructionFiles || pickingInstructionFiles}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {pickingInstructionFiles ? 'Picking…' : 'Add files'}
                        </button>
                        <span className="ui-card-meta">
                          {savingInstructionFiles ? 'Saving…' : instructionFilesDirty ? 'Auto-save pending…' : 'Auto-saved'}
                        </span>
                      </div>
                      <p className="ui-card-meta">Files append in the saved order after the root AGENTS.md.</p>
                    </div>
                  ) : null}

                  {instructionFilesSaveError && <p className="text-[12px] text-danger">{instructionFilesSaveError}</p>}
                </SettingsPanel>
              </div>
            </SettingsSection>

            <SettingsSection
              id="settings-conversation"
              label="Conversation"
              description="Default model, vision model, thinking level, and fast mode for new conversations."
            >
              <div className="space-y-0">
                <SettingsPanel title="Default model" description="Used for new chats and runs unless a model is picked explicitly.">
                  {modelsLoading && !modelState ? (
                    <p className="ui-card-meta">Loading models…</p>
                  ) : modelsError && !modelState ? (
                    <p className="text-[12px] text-danger">Failed to load models: {modelsError}</p>
                  ) : modelState ? (
                    <>
                      <label className="ui-card-meta" htmlFor="settings-model">
                        Model
                      </label>
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
                        {savingPreference === 'model' ? 'Saving default model...' : formatModelSummary(selectedModel, 'No model selected.')}
                      </p>

                      <label className="ui-card-meta pt-1" htmlFor="settings-vision-model">
                        Vision model for text-only chats
                      </label>
                      <select
                        id="settings-vision-model"
                        value={modelState.currentVisionModel}
                        onChange={(event) => {
                          void handleModelPreferenceChange({ visionModel: event.target.value }, 'visionModel');
                        }}
                        disabled={savingPreference !== null || imageCapableModels.length === 0}
                        className={INPUT_CLASS}
                      >
                        <option value="">Not configured</option>
                        {groupedImageCapableModels.map(([provider, models]) => (
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
                        {savingPreference === 'visionModel'
                          ? 'Saving vision model…'
                          : modelState.currentVisionModel
                            ? `Text-only image probing uses ${formatModelSummary(selectedVisionModel, modelState.currentVisionModel)}.`
                            : 'Required before text-only models can inspect uploaded images.'}
                      </p>

                      <label className="ui-card-meta pt-1" htmlFor="settings-thinking">
                        Thinking level
                      </label>
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
                          <option key={option.value || 'unset'} value={option.value}>
                            {option.label}
                          </option>
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
              </div>
            </SettingsSection>

            <SettingsSection id="settings-workspace" label="Workspace" description="Default working directory for project context.">
              <div className="space-y-0">
                <SettingsPanel title="Working directory" description="Fallback cwd for new chats and web actions.">
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
                      <label className="ui-card-meta" htmlFor="settings-default-cwd">
                        Path
                      </label>
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
                          onClick={() => {
                            void handleDefaultCwdPick();
                          }}
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
                        <span className="ui-card-meta">
                          {savingDefaultCwd ? 'Saving…' : defaultCwdDirty ? 'Auto-save pending…' : 'Auto-saved'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void handleDefaultCwdSave('');
                          }}
                          disabled={savingDefaultCwd || pickingDefaultCwd || defaultCwdState.currentCwd.length === 0}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Use process cwd
                        </button>
                      </div>
                      <p className="ui-card-meta">
                        Absolute, <span className="font-mono text-[11px]">~/…</span>, or relative. Leave blank to use the runtime process
                        cwd.
                      </p>
                    </form>
                  ) : null}

                  {defaultCwdSaveError && <p className="text-[12px] text-danger">{defaultCwdSaveError}</p>}
                </SettingsPanel>
              </div>
            </SettingsSection>

            {settingsComponent ? (
              <SettingsSection
                key={`${settingsComponent.extensionId}:${settingsComponent.id}`}
                id={settingsComponent.sectionId as SettingsQuickLinkId}
                label={settingsComponent.label}
                description={settingsComponent.description}
              >
                <SettingsPanelHost registration={settingsComponent} />
              </SettingsSection>
            ) : null}

            <SettingsSection
              id="settings-providers"
              label="Providers"
              description="Provider definitions, model overrides, and credential management."
            >
              <div className="space-y-0">
                <SettingsPanel title="Provider & model definitions">
                  <div className="space-y-5">
                    <div className="space-y-3 min-w-0">
                      <h3 className="text-[13px] font-medium text-primary">Providers</h3>

                      {modelProviderLoading && !modelProviderState ? (
                        <p className="ui-card-meta">Loading provider definitions…</p>
                      ) : modelProviderError && !modelProviderState ? (
                        <p className="text-[12px] text-danger">Failed to load provider definitions: {modelProviderError}</p>
                      ) : modelProviderState ? (
                        <>
                          {providerAuthLoading && !providerAuthState && <p className="ui-card-meta">Loading provider credentials…</p>}
                          {providerAuthError && !providerAuthState && (
                            <p className="text-[12px] text-danger">Failed to load provider credentials: {providerAuthError}</p>
                          )}
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <p className="ui-card-meta">Configured providers</p>
                              {configuredProviderSummaries.length > 0 ? (
                                <div className="space-y-px">
                                  {configuredProviderSummaries.map((provider) => {
                                    const selected = provider.id === selectedModelProviderId || provider.id === selectedProviderId;
                                    return (
                                      <button
                                        key={provider.id}
                                        type="button"
                                        onClick={() => {
                                          if (provider.modelProvider) {
                                            selectModelProvider(provider.id);
                                          } else {
                                            startNewModelProvider(provider.id, 'provider');
                                          }
                                        }}
                                        className={cx(
                                          'group ui-list-row w-full justify-between px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
                                          selected ? 'ui-list-row-selected' : 'ui-list-row-hover',
                                        )}
                                        aria-pressed={selected}
                                      >
                                        <span className="min-w-0">
                                          <span className="block truncate text-[13px] font-medium text-primary">{provider.id}</span>
                                          <span className="ui-card-meta block truncate">
                                            {provider.modelProvider
                                              ? formatModelProviderSummary(provider.modelProvider)
                                              : formatProviderAuthStatus(provider.auth)}
                                          </span>
                                        </span>
                                        {provider.modelProvider?.baseUrl && (
                                          <span className="ui-card-meta hidden truncate text-right xl:block">
                                            {provider.modelProvider.baseUrl}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="ui-card-meta">No custom providers or overrides yet.</p>
                              )}
                            </div>

                            <div className="space-y-3 border-t border-border-subtle pt-4">
                              <div className="space-y-1">
                                <h4 className="text-[13px] font-medium text-primary">Add provider</h4>
                              </div>
                              <div className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-center">
                                <select
                                  id="settings-model-provider-picker"
                                  value={modelProviderPickerId}
                                  onChange={(event) => {
                                    setModelProviderPickerId(event.target.value);
                                  }}
                                  className={`${INPUT_CLASS} h-9 py-1.5 text-[12px]`}
                                >
                                  <option value="">Choose provider…</option>
                                  {unconfiguredModelProviderIds.map((providerId) => (
                                    <option key={providerId} value={providerId}>
                                      {providerId}
                                    </option>
                                  ))}
                                  <option value={ADD_CUSTOM_PROVIDER_ID}>Add custom provider…</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (modelProviderPickerId === ADD_CUSTOM_PROVIDER_ID) {
                                      startNewModelProvider('', 'custom');
                                    } else {
                                      startNewModelProvider(modelProviderPickerId, 'provider');
                                    }
                                  }}
                                  disabled={!modelProviderPickerId}
                                  className={`${ACTION_BUTTON_CLASS} h-9 shrink-0`}
                                >
                                  Continue
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>

                    {selectedModelProviderId !== '' && (
                      <div className="space-y-5 rounded-2xl border border-border-subtle bg-surface/50 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <h3 className="text-[15px] font-medium text-primary">
                              {providerEditorMode === 'custom'
                                ? selectedModelProvider
                                  ? `Edit provider · ${selectedModelProvider.id}`
                                  : 'Add custom provider'
                                : `Provider · ${editableModelProviderId}`}
                            </h3>
                          </div>
                          <button
                            type="button"
                            onClick={closeProviderEditor}
                            disabled={
                              modelProviderAction !== null ||
                              modelDraftAction !== null ||
                              providerCredentialAction !== null ||
                              oauthAction !== null
                            }
                            className={ACTION_BUTTON_CLASS}
                          >
                            Close
                          </button>
                        </div>
                        <div className="space-y-6 min-w-0">
                          {(providerEditorMode === 'custom' || selectedModelProvider) && (
                            <div className="space-y-4 min-w-0">
                              <div className="space-y-1">
                                <h3 className="text-[15px] font-medium text-primary">
                                  {selectedModelProviderId === NEW_MODEL_PROVIDER_ID
                                    ? modelProviderDraft.id.trim()
                                      ? `New provider · ${modelProviderDraft.id.trim()}`
                                      : 'New provider'
                                    : (selectedModelProvider?.id ?? 'Provider')}
                                </h3>
                                <p className="ui-card-meta max-w-3xl">
                                  Use built-in ids like <span className="font-mono text-[11px]">anthropic</span>,{' '}
                                  <span className="font-mono text-[11px]">openai</span>,{' '}
                                  <span className="font-mono text-[11px]">openai-codex</span>, or{' '}
                                  <span className="font-mono text-[11px]">google</span> to override a built-in provider. Use any new id for
                                  a custom provider.
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
                                    <label className="ui-card-meta" htmlFor="settings-model-provider-id">
                                      Provider id
                                    </label>
                                    <input
                                      id="settings-model-provider-id"
                                      value={modelProviderDraft.id}
                                      onChange={(event) => {
                                        setModelProviderDraft((current) => ({ ...current, id: event.target.value }));
                                      }}
                                      className={`${INPUT_CLASS} font-mono text-[13px]`}
                                      placeholder="ollama"
                                      autoComplete="off"
                                      spellCheck={false}
                                      disabled={modelProviderAction !== null || selectedModelProviderId !== NEW_MODEL_PROVIDER_ID}
                                    />
                                  </div>

                                  <div className="space-y-2 min-w-0">
                                    <label className="ui-card-meta" htmlFor="settings-model-provider-base-url">
                                      Base URL
                                    </label>
                                    <input
                                      id="settings-model-provider-base-url"
                                      value={modelProviderDraft.baseUrl}
                                      onChange={(event) => {
                                        setModelProviderDraft((current) => ({ ...current, baseUrl: event.target.value }));
                                      }}
                                      className={`${INPUT_CLASS} font-mono text-[13px]`}
                                      placeholder="http://localhost:11434/v1"
                                      autoComplete="off"
                                      spellCheck={false}
                                      disabled={modelProviderAction !== null}
                                    />
                                  </div>

                                  <div className="space-y-2 min-w-0">
                                    <label className="ui-card-meta" htmlFor="settings-model-provider-api">
                                      API
                                    </label>
                                    <select
                                      id="settings-model-provider-api"
                                      value={modelProviderDraft.api}
                                      onChange={(event) => {
                                        setModelProviderDraft((current) => ({ ...current, api: event.target.value }));
                                      }}
                                      className={INPUT_CLASS}
                                      disabled={modelProviderAction !== null}
                                    >
                                      <option value="">Use built-in or inherit</option>
                                      {MODEL_PROVIDER_API_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div className="space-y-2 min-w-0">
                                    <label className="ui-card-meta" htmlFor="settings-model-provider-api-key">
                                      Provider API key
                                    </label>
                                    <input
                                      id="settings-model-provider-api-key"
                                      value={modelProviderDraft.apiKey}
                                      onChange={(event) => {
                                        setModelProviderDraft((current) => ({ ...current, apiKey: event.target.value }));
                                      }}
                                      className={`${INPUT_CLASS} font-mono text-[13px]`}
                                      placeholder="ollama, ENV_VAR, or !command"
                                      autoComplete="off"
                                      spellCheck={false}
                                      disabled={modelProviderAction !== null}
                                    />
                                  </div>
                                </div>

                                <label
                                  className="inline-flex items-center gap-3 text-[14px] text-primary"
                                  htmlFor="settings-model-provider-auth-header"
                                >
                                  <input
                                    id="settings-model-provider-auth-header"
                                    type="checkbox"
                                    checked={modelProviderDraft.authHeader}
                                    onChange={(event) => {
                                      setModelProviderDraft((current) => ({ ...current, authHeader: event.target.checked }));
                                    }}
                                    disabled={modelProviderAction !== null}
                                    className={CHECKBOX_CLASS}
                                  />
                                  <span>
                                    Add <span className="font-mono text-[11px]">Authorization: Bearer</span> from the provider API key
                                  </span>
                                </label>

                                <div className="grid gap-4 xl:grid-cols-2">
                                  <div className="space-y-2 min-w-0">
                                    <label className="ui-card-meta" htmlFor="settings-model-provider-headers">
                                      Headers (JSON)
                                    </label>
                                    <textarea
                                      id="settings-model-provider-headers"
                                      value={modelProviderDraft.headersText}
                                      onChange={(event) => {
                                        setModelProviderDraft((current) => ({ ...current, headersText: event.target.value }));
                                      }}
                                      className={JSON_TEXTAREA_CLASS}
                                      placeholder={'{\n  "x-app": "personal-agent"\n}'}
                                      spellCheck={false}
                                      disabled={modelProviderAction !== null}
                                    />
                                  </div>

                                  <div className="space-y-2 min-w-0">
                                    <label className="ui-card-meta" htmlFor="settings-model-provider-compat">
                                      Compat (JSON)
                                    </label>
                                    <textarea
                                      id="settings-model-provider-compat"
                                      value={modelProviderDraft.compatText}
                                      onChange={(event) => {
                                        setModelProviderDraft((current) => ({ ...current, compatText: event.target.value }));
                                      }}
                                      className={JSON_TEXTAREA_CLASS}
                                      placeholder={'{\n  "supportsDeveloperRole": false\n}'}
                                      spellCheck={false}
                                      disabled={modelProviderAction !== null}
                                    />
                                  </div>

                                  <div className="space-y-2 min-w-0 xl:col-span-2">
                                    <label className="ui-card-meta" htmlFor="settings-model-provider-overrides">
                                      Model overrides (JSON)
                                    </label>
                                    <textarea
                                      id="settings-model-provider-overrides"
                                      value={modelProviderDraft.modelOverridesText}
                                      onChange={(event) => {
                                        setModelProviderDraft((current) => ({ ...current, modelOverridesText: event.target.value }));
                                      }}
                                      className={JSON_TEXTAREA_CLASS}
                                      placeholder={'{\n  "claude-sonnet-4-6": {\n    "name": "Claude Sonnet 4.6 (Proxy)"\n  }\n}'}
                                      spellCheck={false}
                                      disabled={modelProviderAction !== null}
                                    />
                                  </div>
                                </div>

                                <p className="ui-card-meta max-w-3xl">
                                  Provider API keys here use <span className="font-mono text-[11px]">models.json</span> value resolution.
                                  Leave the field blank if you prefer <span className="font-mono text-[11px]">auth.json</span>, OAuth, or
                                  environment-only auth.
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
                                    onClick={() => {
                                      void handleDeleteModelProvider();
                                    }}
                                    disabled={
                                      modelProviderAction !== null ||
                                      selectedModelProviderId === NEW_MODEL_PROVIDER_ID ||
                                      !selectedModelProvider
                                    }
                                    className={ACTION_BUTTON_CLASS}
                                  >
                                    {modelProviderAction === 'delete' ? 'Removing…' : 'Remove provider'}
                                  </button>
                                </div>

                                {modelProviderMessage && <p className="text-[12px] text-success">{modelProviderMessage}</p>}
                                {modelProviderEditorError && <p className="text-[12px] text-danger">{modelProviderEditorError}</p>}
                              </form>
                            </div>
                          )}

                          <div className="space-y-2 border-t border-border-subtle pt-3 min-w-0">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <h3 className="text-[14px] font-medium text-primary">Models</h3>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  startEditingProviderModel(NEW_MODEL_ID);
                                }}
                                disabled={!editableModelProviderId || modelDraftAction !== null}
                                className={ACTION_BUTTON_CLASS}
                              >
                                Add model
                              </button>
                            </div>

                            {editableModelProviderId ? (
                              <>
                                {builtInProviderModels.length > 0 && (
                                  <div className="space-y-1.5">
                                    <h4 className="text-[12px] font-medium text-secondary">Built-in models</h4>
                                    <div className="space-y-px">
                                      {builtInProviderModels.map((model) => {
                                        const hasOverride = selectedModelProvider?.models.some((candidate) => candidate.id === model.id);
                                        return (
                                          <button
                                            key={`${model.provider}/${model.id}`}
                                            type="button"
                                            onClick={() => {
                                              startEditingBuiltInModel(model.id);
                                            }}
                                            disabled={modelDraftAction !== null}
                                            className={cx(
                                              'group ui-list-row w-full justify-between px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
                                              editingModelId === model.id && !editingProviderModel
                                                ? 'ui-list-row-selected'
                                                : 'ui-list-row-hover',
                                            )}
                                            aria-pressed={editingModelId === model.id && !editingProviderModel}
                                          >
                                            <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
                                              <span className="truncate font-medium text-primary">{model.id}</span>
                                              <span className="shrink-0 text-dim">{formatContextWindowLabel(model.context)} ctx</span>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                              {hasOverride ? (
                                                <span className="text-[11px] text-accent">Overridden</span>
                                              ) : (
                                                <span className="text-[11px] text-dim/70 opacity-0 transition-opacity group-hover:opacity-100">
                                                  Override
                                                </span>
                                              )}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                <div className="space-y-1.5">
                                  <h4 className="text-[12px] font-medium text-secondary">Additional models</h4>
                                  {selectedModelProvider && selectedModelProvider.models.length > 0 ? (
                                    <div className="space-y-px">
                                      {selectedModelProvider.models.map((model) => (
                                        <div key={model.id} className="group ui-list-row ui-list-row-hover justify-between px-2 py-1">
                                          <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
                                            <span className="truncate font-medium text-primary">{model.id}</span>
                                            <span className="truncate text-dim">{formatProviderModelSummary(model)}</span>
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                startEditingProviderModel(model.id);
                                              }}
                                              className={ACTION_BUTTON_CLASS}
                                            >
                                              Edit
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                void handleDeleteProviderModel(model.id);
                                              }}
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
                                    <p className="text-[12px] text-dim">None yet.</p>
                                  )}
                                </div>

                                {modelDraftMessage && <p className="text-[12px] text-success">{modelDraftMessage}</p>}
                                {modelDraftError && <p className="text-[12px] text-danger">{modelDraftError}</p>}

                                {editingModelId === NEW_MODEL_ID && (
                                  <form
                                    className="flex flex-col gap-2 border-t border-border-subtle pt-3 sm:flex-row sm:items-end"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      void handleSaveProviderModel();
                                    }}
                                  >
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                      <label className="ui-card-meta" htmlFor="settings-provider-model-id">
                                        Model id
                                      </label>
                                      <input
                                        id="settings-provider-model-id"
                                        value={modelDraft.id}
                                        onChange={(event) => {
                                          setModelDraft((current) => ({ ...current, id: event.target.value }));
                                        }}
                                        className={`${INPUT_CLASS} font-mono text-[13px]`}
                                        placeholder="gpt-5.6"
                                        autoComplete="off"
                                        spellCheck={false}
                                        disabled={modelDraftAction !== null}
                                        autoFocus
                                      />
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        type="submit"
                                        disabled={modelDraftAction !== null || modelDraft.id.trim().length === 0}
                                        className={ACTION_BUTTON_CLASS}
                                      >
                                        {modelDraftAction === 'save' ? 'Adding…' : 'Add model'}
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

                                {(editingProviderModel || isEditingBuiltInOverride) && (
                                  <form
                                    className="space-y-3 border-t border-border-subtle pt-4"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      void handleSaveProviderModel();
                                    }}
                                  >
                                    <div className="space-y-1">
                                      <h4 className="text-[13px] font-medium text-primary">
                                        {editingProviderModel ? `Edit ${editingProviderModel.id}` : `Override ${modelDraft.id}`}
                                      </h4>
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                                      <div className="space-y-2 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-id">
                                          Model id
                                        </label>
                                        <input
                                          id="settings-provider-model-id"
                                          value={modelDraft.id}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, id: event.target.value }));
                                          }}
                                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                                          placeholder="llama3.1:8b"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null || editingModelId !== NEW_MODEL_ID}
                                        />
                                      </div>

                                      <div className="space-y-2 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-name">
                                          Name
                                        </label>
                                        <input
                                          id="settings-provider-model-name"
                                          value={modelDraft.name}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, name: event.target.value }));
                                          }}
                                          className={INPUT_CLASS}
                                          placeholder="Llama 3.1 8B"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>

                                      <div className="space-y-2 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-api">
                                          API
                                        </label>
                                        <select
                                          id="settings-provider-model-api"
                                          value={modelDraft.api}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, api: event.target.value }));
                                          }}
                                          className={INPUT_CLASS}
                                          disabled={modelDraftAction !== null}
                                        >
                                          <option value="">Inherit provider API</option>
                                          {MODEL_PROVIDER_API_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div className="space-y-2 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-base-url">
                                          Base URL override
                                        </label>
                                        <input
                                          id="settings-provider-model-base-url"
                                          value={modelDraft.baseUrl}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, baseUrl: event.target.value }));
                                          }}
                                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                                          placeholder="https://proxy.example.com/v1"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>

                                      <div className="space-y-1.5 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-context">
                                          Context window
                                        </label>
                                        <input
                                          id="settings-provider-model-context"
                                          value={modelDraft.contextWindow}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, contextWindow: event.target.value }));
                                          }}
                                          className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                          inputMode="numeric"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>

                                      <div className="space-y-1.5 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-max-tokens">
                                          Max tokens
                                        </label>
                                        <input
                                          id="settings-provider-model-max-tokens"
                                          value={modelDraft.maxTokens}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, maxTokens: event.target.value }));
                                          }}
                                          className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                          inputMode="numeric"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap gap-4">
                                      <label
                                        className="inline-flex items-center gap-3 text-[14px] text-primary"
                                        htmlFor="settings-provider-model-reasoning"
                                      >
                                        <input
                                          id="settings-provider-model-reasoning"
                                          type="checkbox"
                                          checked={modelDraft.reasoning}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, reasoning: event.target.checked }));
                                          }}
                                          disabled={modelDraftAction !== null}
                                          className={CHECKBOX_CLASS}
                                        />
                                        <span>Reasoning capable</span>
                                      </label>

                                      <label
                                        className="inline-flex items-center gap-3 text-[14px] text-primary"
                                        htmlFor="settings-provider-model-images"
                                      >
                                        <input
                                          id="settings-provider-model-images"
                                          type="checkbox"
                                          checked={modelDraft.acceptsImages}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, acceptsImages: event.target.checked }));
                                          }}
                                          disabled={modelDraftAction !== null}
                                          className={CHECKBOX_CLASS}
                                        />
                                        <span>Accept images</span>
                                      </label>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                                      <div className="space-y-1.5 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-cost-input">
                                          Input cost / 1M
                                        </label>
                                        <input
                                          id="settings-provider-model-cost-input"
                                          value={modelDraft.costInput}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, costInput: event.target.value }));
                                          }}
                                          className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                          inputMode="decimal"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>

                                      <div className="space-y-1.5 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-cost-output">
                                          Output cost / 1M
                                        </label>
                                        <input
                                          id="settings-provider-model-cost-output"
                                          value={modelDraft.costOutput}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, costOutput: event.target.value }));
                                          }}
                                          className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                          inputMode="decimal"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>

                                      <div className="space-y-1.5 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-cost-cache-read">
                                          Cache read / 1M
                                        </label>
                                        <input
                                          id="settings-provider-model-cost-cache-read"
                                          value={modelDraft.costCacheRead}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, costCacheRead: event.target.value }));
                                          }}
                                          className={`${COMPACT_META_INPUT_CLASS} font-mono`}
                                          inputMode="decimal"
                                          autoComplete="off"
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>

                                      <div className="space-y-1.5 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-cost-cache-write">
                                          Cache write / 1M
                                        </label>
                                        <input
                                          id="settings-provider-model-cost-cache-write"
                                          value={modelDraft.costCacheWrite}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, costCacheWrite: event.target.value }));
                                          }}
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
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-headers">
                                          Headers (JSON)
                                        </label>
                                        <textarea
                                          id="settings-provider-model-headers"
                                          value={modelDraft.headersText}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, headersText: event.target.value }));
                                          }}
                                          className={JSON_TEXTAREA_CLASS}
                                          placeholder={'{\n  "x-provider-key": "HEADER_VALUE"\n}'}
                                          spellCheck={false}
                                          disabled={modelDraftAction !== null}
                                        />
                                      </div>

                                      <div className="space-y-2 min-w-0">
                                        <label className="ui-card-meta" htmlFor="settings-provider-model-compat">
                                          Compat (JSON)
                                        </label>
                                        <textarea
                                          id="settings-provider-model-compat"
                                          value={modelDraft.compatText}
                                          onChange={(event) => {
                                            setModelDraft((current) => ({ ...current, compatText: event.target.value }));
                                          }}
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
                                        {modelDraftAction === 'save' ? 'Saving model…' : 'Save model'}
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
                              <p className="ui-card-meta">Select a provider, or type a provider id above, to edit its models.</p>
                            )}
                          </div>

                          <div className="space-y-3 border-t border-border-subtle pt-4 min-w-0">
                            <div>
                              <h3 className="text-[15px] font-medium text-primary">Credentials</h3>
                            </div>

                            {modalProviderAuth ? (
                              <div className="space-y-2.5">
                                <p className="text-[12px] text-secondary">{formatProviderAuthStatus(modalProviderAuth)}</p>

                                {canProviderUseApiKey(modalProviderAuth) ? (
                                  <div className="space-y-2">
                                    <label className="ui-card-meta" htmlFor="settings-provider-api-key-modal">
                                      API key
                                    </label>
                                    <input
                                      id="settings-provider-api-key-modal"
                                      type="password"
                                      value={providerApiKey}
                                      onChange={(event) => {
                                        setProviderApiKey(event.target.value);
                                      }}
                                      className={INPUT_CLASS}
                                      placeholder="sk-... or op://vault/item/field"
                                      autoComplete="off"
                                      spellCheck={false}
                                      disabled={providerCredentialAction !== null || oauthLoginState?.status === 'running'}
                                    />
                                  </div>
                                ) : null}

                                <div className="flex flex-wrap gap-2">
                                  {canProviderUseApiKey(modalProviderAuth) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleSaveProviderApiKey();
                                      }}
                                      disabled={
                                        providerCredentialAction !== null ||
                                        oauthLoginState?.status === 'running' ||
                                        providerApiKey.trim().length === 0
                                      }
                                      className={ACTION_BUTTON_CLASS}
                                    >
                                      {providerCredentialAction === 'saveKey' ? 'Saving key…' : 'Save API key'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleRemoveProviderCredential();
                                    }}
                                    disabled={
                                      providerCredentialAction !== null ||
                                      oauthLoginState?.status === 'running' ||
                                      !modalProviderAuth.hasStoredCredential
                                    }
                                    className={ACTION_BUTTON_CLASS}
                                  >
                                    {providerCredentialAction === 'remove' ? 'Removing…' : 'Remove stored credential'}
                                  </button>
                                  {modalProviderAuth.oauthSupported && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleStartProviderOAuthLogin();
                                      }}
                                      disabled={
                                        providerCredentialAction !== null ||
                                        oauthAction !== null ||
                                        selectedProviderLogin?.status === 'running'
                                      }
                                      className={ACTION_BUTTON_CLASS}
                                    >
                                      {oauthAction === 'start' ? 'Starting login…' : `Start OAuth login (${modalProviderAuth.id})`}
                                    </button>
                                  )}
                                </div>

                                {selectedProviderLogin?.status === 'running' && (
                                  <div className="space-y-2 border-t border-border-subtle pt-3">
                                    <p className="ui-card-meta">
                                      OAuth login running for {selectedProviderLogin.providerName}.
                                      {selectedProviderLogin.authUrl ? (
                                        <>
                                          {' Opened the '}
                                          <a
                                            href={selectedProviderLogin.authUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={selectedProviderLogin.authUrl}
                                            className="underline text-interactive hover:text-interactive-hover"
                                            onClick={(e) => {
                                              e.preventDefault();
                                              window.open(selectedProviderLogin.authUrl, '_blank');
                                            }}
                                          >
                                            authorization page
                                          </a>
                                          .
                                        </>
                                      ) : (
                                        ''
                                      )}
                                    </p>
                                    {selectedProviderLogin.progress.length > 0 && (
                                      <p className="ui-card-meta">
                                        {selectedProviderLogin.progress[selectedProviderLogin.progress.length - 1]}
                                      </p>
                                    )}
                                    {selectedProviderLogin.prompt && (
                                      <form
                                        className="flex flex-col gap-2 sm:flex-row sm:items-end"
                                        onSubmit={(event) => {
                                          event.preventDefault();
                                          void handleSubmitProviderOAuthInput();
                                        }}
                                      >
                                        <div className="min-w-0 flex-1 space-y-1.5">
                                          <label className="ui-card-meta" htmlFor="settings-provider-oauth-input">
                                            {selectedProviderLogin.prompt.message}
                                          </label>
                                          <input
                                            id="settings-provider-oauth-input"
                                            value={oauthInputValue}
                                            onChange={(event) => {
                                              setOauthInputValue(event.target.value);
                                            }}
                                            className={INPUT_CLASS}
                                            placeholder={selectedProviderLogin.prompt.placeholder}
                                            autoComplete="off"
                                            disabled={oauthAction !== null}
                                          />
                                        </div>
                                        <button
                                          type="submit"
                                          disabled={
                                            oauthAction !== null ||
                                            (!selectedProviderLogin.prompt.allowEmpty && oauthInputValue.trim().length === 0)
                                          }
                                          className={ACTION_BUTTON_CLASS}
                                        >
                                          {oauthAction === 'submit' ? 'Submitting…' : 'Submit'}
                                        </button>
                                      </form>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleCancelProviderOAuthLogin();
                                      }}
                                      disabled={oauthAction !== null}
                                      className={ACTION_BUTTON_CLASS}
                                    >
                                      {oauthAction === 'cancel' ? 'Cancelling…' : 'Cancel OAuth login'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : editableModelProviderId ? (
                              <p className="ui-card-meta">Save or select the provider before managing stored credentials.</p>
                            ) : (
                              <p className="ui-card-meta">Choose or create a provider first.</p>
                            )}

                            {providerCredentialNotice && <p className="text-[12px] text-success">{providerCredentialNotice}</p>}
                            {providerCredentialError && <p className="text-[12px] text-danger">{providerCredentialError}</p>}
                            {oauthError && <p className="text-[12px] text-danger">{oauthError}</p>}
                            {selectedProviderLogin?.status === 'failed' && selectedProviderLogin.error && (
                              <p className="text-[12px] text-danger">OAuth login failed: {selectedProviderLogin.error}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </SettingsPanel>
              </div>
            </SettingsSection>

            <DesktopConnectionsSettingsPanel />

            {desktopEnvironment?.isElectron || isDesktopShell() ? <DesktopKeyboardShortcutsSettingsSection /> : null}

            <ExtensionSettingsSection />
          </div>
        </AppPageLayout>
      </div>
    </VisibleSettingsSectionsContext.Provider>
  );
}

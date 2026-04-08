import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { formatContextWindowLabel, formatThinkingLevelLabel } from '../conversationHeader';
import { api } from '../api';
import { useApi } from '../hooks';
import { THINKING_LEVEL_OPTIONS, groupModelsByProvider } from '../modelPreferences';
import { resetStoredConversationUiState, resetStoredLayoutPreferences } from '../localSettings';
import { type ThemePreference, useTheme } from '../theme';
import type {
  CodexPlanUsageState,
  ModelProviderApi,
  ModelProviderConfig,
  ModelProviderModelConfig,
  ModelProviderState,
  ModelState,
  ProviderAuthSummary,
  ProviderOAuthLoginState,
  ProviderOAuthLoginStreamEvent,
} from '../types';
import { CodexPlanUsageSummary } from '../components/CodexPlanUsageSummary';
import { SystemSettingsContent } from '../components/SystemSettingsContent';
import { PageHeader, PageHeading, SectionLabel, ToolbarButton, cx } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';

type ModelOption = ModelState['models'][number];

const EMPTY_CODEX_PLAN_USAGE: CodexPlanUsageState = {
  available: false,
  planType: null,
  fiveHour: null,
  weekly: null,
  credits: null,
  updatedAt: null,
  error: null,
};

const MODEL_PROVIDER_API_OPTIONS: Array<{ value: ModelProviderApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
];

const NEW_MODEL_PROVIDER_ID = '__new-model-provider__';
const NEW_MODEL_ID = '__new-model__';
const JSON_TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[112px] font-mono text-[12px] leading-5`;

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

function SettingsPanel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('space-y-5 border-t border-border-subtle pt-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl space-y-1">
          <h2 className="text-[15px] font-medium text-primary">{title}</h2>
          {description ? <p className="ui-card-meta max-w-3xl">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { theme, themePreference, setThemePreference } = useTheme();
  const {
    data: profileState,
    loading: profilesLoading,
    error: profilesError,
    refetch: refetchProfiles,
  } = useApi(api.profiles);
  const {
    data: modelState,
    loading: modelsLoading,
    error: modelsError,
    refetch: refetchModels,
  } = useApi(api.models);
  const {
    data: modelProviderState,
    loading: modelProviderLoading,
    error: modelProviderError,
    refetch: refetchModelProviders,
    replaceData: replaceModelProviderState,
  } = useApi(api.modelProviders);
  const {
    data: vaultRootState,
    loading: vaultRootLoading,
    error: vaultRootLoadError,
    refetch: refetchVaultRoot,
  } = useApi(api.vaultRoot);
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
    data: status,
    error: statusError,
    refetch: refetchStatus,
  } = useApi(api.status);
  const {
    data: providerAuthState,
    loading: providerAuthLoading,
    error: providerAuthError,
    refetch: refetchProviderAuth,
  } = useApi(api.providerAuth);
  const codexUsageEnabled = providerAuthState?.providers.some((provider) => provider.id === 'openai-codex' && provider.authType === 'oauth') ?? false;
  const {
    data: codexPlanUsage,
    loading: codexPlanUsageLoading,
    refreshing: codexPlanUsageRefreshing,
    refetch: refetchCodexPlanUsage,
  } = useApi(
    () => codexUsageEnabled ? api.codexPlanUsage() : Promise.resolve(EMPTY_CODEX_PLAN_USAGE),
    `codex-plan-usage:${codexUsageEnabled ? 'enabled' : 'disabled'}`,
  );
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingPreference, setSavingPreference] = useState<'model' | 'thinking' | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [vaultRootDraft, setVaultRootDraft] = useState('');
  const [savingVaultRoot, setSavingVaultRoot] = useState(false);
  const [vaultRootSaveError, setVaultRootSaveError] = useState<string | null>(null);
  const [defaultCwdDraft, setDefaultCwdDraft] = useState('');
  const [savingDefaultCwd, setSavingDefaultCwd] = useState(false);
  const [defaultCwdSaveError, setDefaultCwdSaveError] = useState<string | null>(null);
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
  const [resetting, setResetting] = useState<'layout' | 'conversation' | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const pageMeta = [
    'Theme, defaults, providers, workspace, and system controls.',
    `theme ${theme}`,
    profileState ? `profile ${profileState.currentProfile}` : null,
    modelState?.currentModel ? `model ${modelState.currentModel}` : null,
  ].filter(Boolean).join(' · ');

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
  const defaultCwdDirty = defaultCwdState
    ? defaultCwdDraft.trim() !== defaultCwdState.currentCwd
    : false;

  useEffect(() => {
    if (vaultRootState) {
      setVaultRootDraft(vaultRootState.currentRoot);
    }
  }, [vaultRootState?.currentRoot]);

  useEffect(() => {
    if (defaultCwdState) {
      setDefaultCwdDraft(defaultCwdState.currentCwd);
    }
  }, [defaultCwdState?.currentCwd]);

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
    const stream = new EventSource(`/api/provider-auth/oauth/${encodeURIComponent(loginId)}/events`);
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

    return () => {
      stream.close();
    };
  }, [oauthLoginState?.id, oauthLoginState?.status]);

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

  async function handleProfileChange(nextProfile: string) {
    if (!profileState || nextProfile === profileState.currentProfile || switchingProfile) {
      return;
    }

    setProfileError(null);
    setSwitchingProfile(true);

    try {
      await api.setCurrentProfile(nextProfile);
      window.location.reload();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : String(error));
      setSwitchingProfile(false);
    }
  }

  async function handleModelPreferenceChange(input: { model?: string; thinkingLevel?: string }, field: 'model' | 'thinking') {
    if (!modelState || savingPreference !== null) {
      return;
    }

    if (field === 'model' && (!input.model || input.model === modelState.currentModel)) {
      return;
    }

    if (field === 'thinking' && input.thinkingLevel === modelState.currentThinkingLevel) {
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
    if (!vaultRootState || savingVaultRoot) {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader actions={<ToolbarButton onClick={() => {
        void Promise.all([
          refetchProfiles({ resetLoading: false }),
          refetchModels({ resetLoading: false }),
          refetchModelProviders({ resetLoading: false }),
          refetchVaultRoot({ resetLoading: false }),
          refetchDefaultCwd({ resetLoading: false }),
          refetchConversationTitleSettings({ resetLoading: false }),
          refetchProviderAuth({ resetLoading: false }),
          refetchCodexPlanUsage({ resetLoading: false }),
          refetchStatus({ resetLoading: false }),
          oauthLoginState ? api.providerOAuthLogin(oauthLoginState.id).then(setOauthLoginState).catch(() => null) : Promise.resolve(null),
        ]);
      }}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Settings"
          meta={pageMeta}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-6xl pb-6 space-y-10">
          <section className="space-y-4">
              <SectionLabel label="Appearance" />

              <SettingsPanel
                title="Theme"
                description="Theme is stored in this browser only. Choose Auto to follow the OS appearance without reloading."
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
            </section>

          <section className="space-y-5">
              <SectionLabel label="Agent defaults" />

              <div className="space-y-4">
                <SettingsPanel
                  title="Profile"
                  description="Changes the active profile for inbox, docs, AGENTS/skills context, and new live sessions. The app reloads after switching."
                >
                  {profilesLoading && !profileState ? (
                    <p className="ui-card-meta">Loading profiles…</p>
                  ) : profilesError && !profileState ? (
                    <p className="text-[12px] text-danger">Failed to load profiles: {profilesError}</p>
                  ) : profileState ? (
                    <>
                      <label className="ui-card-meta" htmlFor="settings-profile">Active profile</label>
                      <select
                        id="settings-profile"
                        value={profileState.currentProfile}
                        onChange={(event) => { void handleProfileChange(event.target.value); }}
                        disabled={switchingProfile || profileState.profiles.length === 0}
                        className={INPUT_CLASS}
                      >
                        {profileState.profiles.map((profile) => (
                          <option key={profile} value={profile}>{profile}</option>
                        ))}
                      </select>
                      <p className="ui-card-meta">
                        {switchingProfile
                          ? 'Switching profile and reloading…'
                          : `${profileState.profiles.length} available ${profileState.profiles.length === 1 ? 'profile' : 'profiles'}.`}
                      </p>
                    </>
                  ) : null}

                  {profileError && <p className="text-[12px] text-danger">{profileError}</p>}
                </SettingsPanel>

                <SettingsPanel
                  title="Default model"
                  description={(
                    <>
                      Updates the saved runtime defaults for newly created live sessions and other runs that do not explicitly pick a model.
                      Saving an explicit model here clears the active profile&apos;s default preset.
                    </>
                  )}
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
                    </>
                  ) : null}

                  {modelError && <p className="text-[12px] text-danger">{modelError}</p>}
                </SettingsPanel>

                <SettingsPanel
                  title="Knowledge vault root"
                  description="Sets the canonical vault location for notes, skills, and profile files. The agent and supporting vault lookups use this path as the durable knowledge home."
                >
                  {vaultRootLoading && !vaultRootState ? (
                    <p className="ui-card-meta">Loading knowledge vault root…</p>
                  ) : vaultRootLoadError && !vaultRootState ? (
                    <p className="text-[12px] text-danger">Failed to load knowledge vault root: {vaultRootLoadError}</p>
                  ) : vaultRootState ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleVaultRootSave();
                      }}
                    >
                      <label className="ui-card-meta" htmlFor="settings-vault-root">Path</label>
                      <input
                        id="settings-vault-root"
                        value={vaultRootDraft}
                        onChange={(event) => {
                          setVaultRootDraft(event.target.value);
                          if (vaultRootSaveError) {
                            setVaultRootSaveError(null);
                          }
                        }}
                        className={`${INPUT_CLASS} font-mono text-[13px]`}
                        placeholder="~/Documents/personal-agent"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={savingVaultRoot}
                      />
                      <p className="ui-card-meta break-all">
                        {savingVaultRoot
                          ? 'Saving knowledge vault root…'
                          : vaultRootState.source === 'env'
                            ? `Environment override active. Effective root: ${vaultRootState.effectiveRoot}`
                            : vaultRootState.currentRoot
                              ? `Effective root: ${vaultRootState.effectiveRoot}`
                              : `Using default root: ${vaultRootState.defaultRoot}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={savingVaultRoot || !vaultRootDirty}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {savingVaultRoot ? 'Saving…' : 'Save vault root'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleVaultRootSave(''); }}
                          disabled={savingVaultRoot || vaultRootState.currentRoot.length === 0}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Use default root
                        </button>
                      </div>
                      <p className="ui-card-meta">
                        Use an absolute path or <span className="font-mono text-[11px]">~/…</span>. Environment variable <span className="font-mono text-[11px]">PERSONAL_AGENT_VAULT_ROOT</span> still overrides this setting when present.
                      </p>
                    </form>
                  ) : null}

                  {vaultRootSaveError && <p className="text-[12px] text-danger">{vaultRootSaveError}</p>}
                </SettingsPanel>

                <SettingsPanel
                  title="Default working directory"
                  description="Used when a new live session or other web action starts without an explicit cwd. A single referenced tracked-doc repo root still takes priority."
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
                      <input
                        id="settings-default-cwd"
                        value={defaultCwdDraft}
                        onChange={(event) => {
                          setDefaultCwdDraft(event.target.value);
                          if (defaultCwdSaveError) {
                            setDefaultCwdSaveError(null);
                          }
                        }}
                        className={`${INPUT_CLASS} font-mono text-[13px]`}
                        placeholder="~/workingdir/repo"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={savingDefaultCwd}
                      />
                      <p className="ui-card-meta break-all">
                        {savingDefaultCwd
                          ? 'Saving default working directory…'
                          : defaultCwdState.currentCwd
                            ? `Effective default: ${defaultCwdState.effectiveCwd}`
                            : `Using process cwd: ${defaultCwdState.effectiveCwd}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={savingDefaultCwd || !defaultCwdDirty}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {savingDefaultCwd ? 'Saving…' : 'Save working directory'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleDefaultCwdSave(''); }}
                          disabled={savingDefaultCwd || defaultCwdState.currentCwd.length === 0}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Use process cwd
                        </button>
                      </div>
                      <p className="ui-card-meta">
                        Use an absolute path, <span className="font-mono text-[11px]">~/…</span>, or a relative path. Leave it blank to fall back to the web server process cwd.
                      </p>
                    </form>
                  ) : null}

                  {defaultCwdSaveError && <p className="text-[12px] text-danger">{defaultCwdSaveError}</p>}
                </SettingsPanel>

                <SettingsPanel
                  title="Conversation titles"
                  description="Auto-renames chats after the first assistant reply. Use the runtime default model or pin a dedicated title model."
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
                        <option value="">Use default runtime model ({conversationTitleState.effectiveModel})</option>
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
                            : `Using runtime default: ${formatModelSummary(effectiveConversationTitleModel, conversationTitleState.effectiveModel)}`}
                      </p>
                    </>
                  ) : null}

                  {conversationTitleSaveError && <p className="text-[12px] text-danger">{conversationTitleSaveError}</p>}
                </SettingsPanel>
              </div>
            </section>

          <section className="space-y-8">
            <SectionLabel label="Providers & models" />

            <div className="space-y-4">
              <SettingsPanel
                title="Provider & model definitions"
                description={(
                  <>
                    Edit <span className="font-mono text-[11px]">{modelProviderState?.filePath ?? 'models.json'}</span> for the active profile. Built-in providers still exist even when they are not listed here. Add a provider to create a custom provider or a built-in override.
                  </>
                )}
              >
                <div className="space-y-8">
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

                      <div className="grid gap-4 lg:grid-cols-3">
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

                        <div className="space-y-2 min-w-0">
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

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-context">Context window</label>
                                <input
                                  id="settings-provider-model-context"
                                  value={modelDraft.contextWindow}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, contextWindow: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
                                  inputMode="numeric"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-max-tokens">Max tokens</label>
                                <input
                                  id="settings-provider-model-max-tokens"
                                  value={modelDraft.maxTokens}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, maxTokens: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
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

                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-input">Input cost / 1M</label>
                                <input
                                  id="settings-provider-model-cost-input"
                                  value={modelDraft.costInput}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costInput: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-output">Output cost / 1M</label>
                                <input
                                  id="settings-provider-model-cost-output"
                                  value={modelDraft.costOutput}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costOutput: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-cache-read">Cache read / 1M</label>
                                <input
                                  id="settings-provider-model-cost-cache-read"
                                  value={modelDraft.costCacheRead}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costCacheRead: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  disabled={modelDraftAction !== null}
                                />
                              </div>

                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor="settings-provider-model-cost-cache-write">Cache write / 1M</label>
                                <input
                                  id="settings-provider-model-cost-cache-write"
                                  value={modelDraft.costCacheWrite}
                                  onChange={(event) => { setModelDraft((current) => ({ ...current, costCacheWrite: event.target.value })); }}
                                  className={`${INPUT_CLASS} font-mono text-[13px]`}
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
                    Manage API-key and OAuth credentials per provider. Stored credentials are written to <span className="font-mono text-[11px]">{providerAuthState?.authFile ?? 'auth.json'}</span>.
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

              <CodexPlanUsageSummary
                usage={codexPlanUsage}
                loading={codexUsageEnabled && codexPlanUsageLoading}
                refreshing={codexPlanUsageRefreshing}
              />
            </div>
          </section>

          <section className="space-y-5">
            <SectionLabel label="Interface state" />

            <SettingsPanel
              title="Reset saved UI preferences"
              description="These actions clear saved UI state. They do not delete conversations, docs, or agent data."
            >
              {resetError && <p className="text-[12px] text-danger">Failed to reset UI state: {resetError}</p>}

              <div className="space-y-6">
                <div className="space-y-2 min-w-0">
                  <h3 className="text-[13px] font-medium text-primary">Layout widths</h3>
                  <p className="ui-card-meta">
                    Clears the stored sidebar width and per-doc context rail widths, then reloads the page.
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
          </section>

          <section className="space-y-5">
            <SystemSettingsContent />
          </section>

          <section className="space-y-4">
            <SectionLabel label="Workspace" />

            <SettingsPanel
              title="Repo root"
              description="The repository root currently used by the web app for docs, tasks, and profile resources."
            >
              <p className="break-all font-mono text-[12px] leading-relaxed text-primary">
                {status?.repoRoot ?? 'Unavailable'}
              </p>
              {statusError && <p className="text-[12px] text-danger">Failed to load workspace details: {statusError}</p>}
            </SettingsPanel>
          </section>
        </div>
      </div>
    </div>
  );
}

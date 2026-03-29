import { useEffect, useMemo, useRef, useState } from 'react';
import { formatContextWindowLabel, formatThinkingLevelLabel } from '../conversationHeader';
import { api } from '../api';
import { useApi } from '../hooks';
import { THINKING_LEVEL_OPTIONS, groupModelsByProvider } from '../modelPreferences';
import { resetStoredConversationUiState, resetStoredLayoutPreferences } from '../localSettings';
import { type ThemePreference, useTheme } from '../theme';
import type {
  CodexPlanUsageState,
  ModelPresetPreferencesState,
  ModelProviderApi,
  ModelProviderConfig,
  ModelProviderModelConfig,
  ModelProviderState,
  ModelState,
  ProviderAuthSummary,
  ProviderOAuthLoginState,
  ProviderOAuthLoginStreamEvent,
} from '../types';
import { useLocation } from 'react-router-dom';
import { CodexPlanUsageSummary } from '../components/CodexPlanUsageSummary';
import { getSettingsPage, readSettingsPageId, SettingsSplitLayout } from '../components/SettingsLayout';
import { SystemSettingsContent } from '../components/SystemSettingsContent';
import { PageHeader, PageHeading, SectionLabel, ToolbarButton, cx } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'inline-flex items-center rounded-lg border border-border-subtle bg-base px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface focus-visible:outline-none focus-visible:border-accent/60 disabled:opacity-50';
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
const NEW_MODEL_PRESET_ID = '__new-model-preset__';
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

interface ModelPresetFallbackDraft {
  key: string;
  model: string;
  thinkingLevel: string;
}

interface ModelPresetDraft {
  id: string;
  description: string;
  model: string;
  thinkingLevel: string;
  fallbacks: ModelPresetFallbackDraft[];
  goodForText: string;
  avoidForText: string;
  instructionAddendum: string;
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

function createFallbackDraft(input?: { model?: string; thinkingLevel?: string }): ModelPresetFallbackDraft {
  return {
    key: Math.random().toString(16).slice(2, 10),
    model: input?.model ?? '',
    thinkingLevel: input?.thinkingLevel ?? '',
  };
}

function joinStringList(values: string[]): string {
  return values.join('\n');
}

function splitStringList(text: string): string[] {
  return text
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter((value): value is string => value.length > 0);
}

function createModelPresetDraft(preset: ModelPresetPreferencesState['presets'][number] | null): ModelPresetDraft {
  return {
    id: preset?.id ?? '',
    description: preset?.description ?? '',
    model: preset?.model ?? '',
    thinkingLevel: preset?.thinkingLevel ?? '',
    fallbacks: preset?.fallbacks.map((fallback) => createFallbackDraft(fallback)) ?? [],
    goodForText: joinStringList(preset?.goodFor ?? []),
    avoidForText: joinStringList(preset?.avoidFor ?? []),
    instructionAddendum: preset?.instructionAddendum ?? '',
  };
}

function formatModelRefLabel(modelRef: string, models: ModelOption[]): string {
  return formatModelSummary(findModelByRef(models, modelRef), modelRef || 'Select a model');
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

export function SettingsPage() {
  const location = useLocation();
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
    data: modelPresetState,
    loading: modelPresetLoading,
    error: modelPresetLoadError,
    refetch: refetchModelPresetSettings,
  } = useApi(api.modelPresetSettings);
  const {
    data: modelProviderState,
    loading: modelProviderLoading,
    error: modelProviderError,
    refetch: refetchModelProviders,
    replaceData: replaceModelProviderState,
  } = useApi(api.modelProviders);
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
  const [selectedModelPresetId, setSelectedModelPresetId] = useState('');
  const [modelPresetDraft, setModelPresetDraft] = useState<ModelPresetDraft>(() => createModelPresetDraft(null));
  const [defaultPresetDraftId, setDefaultPresetDraftId] = useState('');
  const [modelPresetAction, setModelPresetAction] = useState<'save' | 'delete' | 'default' | null>(null);
  const [modelPresetMessage, setModelPresetMessage] = useState<string | null>(null);
  const [modelPresetError, setModelPresetError] = useState<string | null>(null);
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
  const activePageId = useMemo(() => readSettingsPageId(location.search), [location.search]);
  const activePage = useMemo(() => getSettingsPage(activePageId), [activePageId]);
  const activeSystemComponent = useMemo(() => {
    switch (activePageId) {
      case 'system-web-ui':
        return 'web-ui' as const;
      case 'system-daemon':
        return 'daemon' as const;
      case 'system-sync':
        return 'sync' as const;
      default:
        return null;
    }
  }, [activePageId]);

  const pageMeta = activePageId.startsWith('system')
    ? ''
    : [
      `theme ${theme}`,
      profileState ? `profile ${profileState.currentProfile}` : null,
      modelState?.currentModel ? `model ${modelState.currentModel}` : null,
    ].filter(Boolean).join(' · ');

  const headingMeta = [activePage.summary, pageMeta].filter(Boolean).join(' · ');

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

  const selectedModelPreset = useMemo(() => {
    if (!modelPresetState || !selectedModelPresetId) {
      return null;
    }

    return modelPresetState.presets.find((preset) => preset.id === selectedModelPresetId) ?? null;
  }, [modelPresetState, selectedModelPresetId]);

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

  const defaultCwdDirty = defaultCwdState
    ? defaultCwdDraft.trim() !== defaultCwdState.currentCwd
    : false;
  const modelPresetDefaultDirty = modelPresetState
    ? defaultPresetDraftId !== modelPresetState.defaultPresetId
    : false;

  useEffect(() => {
    if (defaultCwdState) {
      setDefaultCwdDraft(defaultCwdState.currentCwd);
    }
  }, [defaultCwdState?.currentCwd]);

  useEffect(() => {
    if (!modelPresetState) {
      return;
    }

    setDefaultPresetDraftId(modelPresetState.defaultPresetId);

    if (!selectedModelPresetId) {
      const firstPreset = modelPresetState.presets[0] ?? null;
      setSelectedModelPresetId(firstPreset?.id ?? NEW_MODEL_PRESET_ID);
      setModelPresetDraft(createModelPresetDraft(firstPreset));
      return;
    }

    if (selectedModelPresetId === NEW_MODEL_PRESET_ID) {
      return;
    }

    const nextPreset = modelPresetState.presets.find((preset) => preset.id === selectedModelPresetId) ?? null;
    if (!nextPreset) {
      const firstPreset = modelPresetState.presets[0] ?? null;
      setSelectedModelPresetId(firstPreset?.id ?? NEW_MODEL_PRESET_ID);
      setModelPresetDraft(createModelPresetDraft(firstPreset));
      return;
    }

    setModelPresetDraft(createModelPresetDraft(nextPreset));
  }, [modelPresetState, selectedModelPresetId]);

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

  function handleSelectModelPreset(presetId: string) {
    if (!modelPresetState) {
      return;
    }

    if (presetId === NEW_MODEL_PRESET_ID) {
      setSelectedModelPresetId(NEW_MODEL_PRESET_ID);
      setModelPresetDraft(createModelPresetDraft(null));
      setModelPresetError(null);
      setModelPresetMessage(null);
      return;
    }

    const preset = modelPresetState.presets.find((entry) => entry.id === presetId) ?? null;
    setSelectedModelPresetId(presetId);
    setModelPresetDraft(createModelPresetDraft(preset));
    setModelPresetError(null);
    setModelPresetMessage(null);
  }

  async function handleSaveModelPreset() {
    if (!modelPresetState || modelPresetAction !== null) {
      return;
    }

    const normalizedId = modelPresetDraft.id.trim();
    if (!normalizedId) {
      setModelPresetError('Preset id is required.');
      return;
    }

    if (!modelPresetDraft.model.trim()) {
      setModelPresetError('Primary model is required.');
      return;
    }

    const nextPreset = {
      id: normalizedId,
      description: modelPresetDraft.description.trim(),
      model: modelPresetDraft.model.trim(),
      thinkingLevel: modelPresetDraft.thinkingLevel.trim(),
      fallbacks: modelPresetDraft.fallbacks
        .map((fallback) => ({
          model: fallback.model.trim(),
          thinkingLevel: fallback.thinkingLevel.trim(),
        }))
        .filter((fallback) => fallback.model.length > 0),
      goodFor: splitStringList(modelPresetDraft.goodForText),
      avoidFor: splitStringList(modelPresetDraft.avoidForText),
      instructionAddendum: modelPresetDraft.instructionAddendum.trim(),
    };

    const filteredPresets = modelPresetState.presets.filter((preset) => preset.id !== selectedModelPreset?.id);
    const duplicate = filteredPresets.some((preset) => preset.id === normalizedId);
    if (duplicate) {
      setModelPresetError(`Preset ${normalizedId} already exists.`);
      return;
    }

    const nextDefaultPresetId = defaultPresetDraftId === selectedModelPreset?.id
      ? normalizedId
      : defaultPresetDraftId;

    setModelPresetError(null);
    setModelPresetMessage(null);
    setModelPresetAction('save');

    try {
      const saved = await api.updateModelPresetSettings({
        defaultPresetId: nextDefaultPresetId,
        presets: [...filteredPresets, nextPreset].sort((left, right) => left.id.localeCompare(right.id)),
      });
      setSelectedModelPresetId(normalizedId);
      setDefaultPresetDraftId(saved.defaultPresetId);
      setModelPresetMessage(`Saved preset ${normalizedId}.`);
      await Promise.all([
        refetchModelPresetSettings({ resetLoading: false }),
        refetchModels({ resetLoading: false }),
        refetchConversationTitleSettings({ resetLoading: false }),
      ]);
    } catch (error) {
      setModelPresetError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelPresetAction(null);
    }
  }

  async function handleDeleteModelPreset() {
    if (!modelPresetState || !selectedModelPreset || modelPresetAction !== null) {
      return;
    }

    setModelPresetError(null);
    setModelPresetMessage(null);
    setModelPresetAction('delete');

    try {
      const remainingPresets = modelPresetState.presets.filter((preset) => preset.id !== selectedModelPreset.id);
      const nextDefaultPresetId = defaultPresetDraftId === selectedModelPreset.id ? '' : defaultPresetDraftId;
      await api.updateModelPresetSettings({
        defaultPresetId: nextDefaultPresetId,
        presets: remainingPresets,
      });
      const nextSelectedPreset = remainingPresets[0] ?? null;
      setSelectedModelPresetId(nextSelectedPreset?.id ?? NEW_MODEL_PRESET_ID);
      setModelPresetDraft(createModelPresetDraft(nextSelectedPreset));
      setDefaultPresetDraftId(nextDefaultPresetId);
      setModelPresetMessage(`Deleted preset ${selectedModelPreset.id}.`);
      await Promise.all([
        refetchModelPresetSettings({ resetLoading: false }),
        refetchModels({ resetLoading: false }),
        refetchConversationTitleSettings({ resetLoading: false }),
      ]);
    } catch (error) {
      setModelPresetError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelPresetAction(null);
    }
  }

  async function handleSaveDefaultPreset() {
    if (!modelPresetState || modelPresetAction !== null) {
      return;
    }

    setModelPresetError(null);
    setModelPresetMessage(null);
    setModelPresetAction('default');

    try {
      const saved = await api.updateModelPresetSettings({
        defaultPresetId: defaultPresetDraftId,
        presets: modelPresetState.presets,
      });
      setDefaultPresetDraftId(saved.defaultPresetId);
      setModelPresetMessage(saved.defaultPresetId
        ? `Default preset set to ${saved.defaultPresetId}.`
        : 'Cleared the default preset.');
      await Promise.all([
        refetchModelPresetSettings({ resetLoading: false }),
        refetchModels({ resetLoading: false }),
        refetchConversationTitleSettings({ resetLoading: false }),
      ]);
    } catch (error) {
      setModelPresetError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelPresetAction(null);
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
    <SettingsSplitLayout>
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader actions={activePageId.startsWith('system') ? null : <ToolbarButton onClick={() => {
          void Promise.all([
            refetchProfiles({ resetLoading: false }),
            refetchModels({ resetLoading: false }),
            refetchModelPresetSettings({ resetLoading: false }),
            refetchModelProviders({ resetLoading: false }),
            refetchDefaultCwd({ resetLoading: false }),
            refetchConversationTitleSettings({ resetLoading: false }),
            refetchProviderAuth({ resetLoading: false }),
            refetchCodexPlanUsage({ resetLoading: false }),
            refetchStatus({ resetLoading: false }),
            oauthLoginState ? api.providerOAuthLogin(oauthLoginState.id).then(setOauthLoginState).catch(() => null) : Promise.resolve(null),
          ]);
        }}>↻ Refresh</ToolbarButton>}>
          <PageHeading
            title={activePage.label}
            meta={headingMeta || 'Stable preferences, provider credentials, and interface reset tools.'}
          />
        </PageHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className={cx(activePageId.startsWith('system') ? 'max-w-6xl' : 'max-w-5xl', 'pb-6')}>
            <section className={cx('space-y-4', activePageId !== 'appearance' && 'hidden')}>
              <SectionLabel label="Appearance" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Theme</h2>
              <p className="ui-card-meta max-w-2xl">
                Theme is stored in this browser only. Choose Auto to follow the OS appearance without reloading.
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="ui-segmented-control" role="group" aria-label="Theme selection">
                <ThemeButton value="system" current={themePreference} onSelect={setThemePreference} label="auto" />
                <ThemeButton value="light" current={themePreference} onSelect={setThemePreference} />
                <ThemeButton value="dark" current={themePreference} onSelect={setThemePreference} />
              </div>
              <span className="ui-card-meta">
                Current theme: {theme}{themePreference === 'system' ? ' (auto)' : ''}
              </span>
            </div>
          </section>

          <section className={cx('space-y-5', activePageId !== 'defaults' && 'hidden')}>
            <SectionLabel label="Agent defaults" />

            <div className="grid gap-8 lg:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-3 min-w-0">
                <div className="space-y-1">
                  <h2 className="text-[15px] font-medium text-primary">Profile</h2>
                  <p className="ui-card-meta max-w-xl">
                    Changes the active profile for inbox, projects, AGENTS/skills context, and new live sessions. The app reloads after switching.
                  </p>
                </div>

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
              </div>

              <div className="space-y-3 min-w-0">
                <div className="space-y-1">
                  <h2 className="text-[15px] font-medium text-primary">Default model</h2>
                  <p className="ui-card-meta max-w-xl">
                    Updates the saved runtime defaults for newly created live sessions and other runs that do not explicitly pick a model.
                    Saving an explicit model here clears the active profile&apos;s default preset.
                  </p>
                </div>

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
                        ? 'Saving default model…'
                        : formatModelSummary(selectedModel, 'No model selected.')}
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
              </div>

              <div className="space-y-3 min-w-0">
                <div className="space-y-1">
                  <h2 className="text-[15px] font-medium text-primary">Default working directory</h2>
                  <p className="ui-card-meta max-w-xl">
                    Used when a new live session or other web action starts without an explicit cwd. A single referenced project repo root still takes priority.
                  </p>
                </div>

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
                      placeholder="~/workingdir/project"
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
              </div>

              <div className="space-y-3 min-w-0">
                <div className="space-y-1">
                  <h2 className="text-[15px] font-medium text-primary">Conversation titles</h2>
                  <p className="ui-card-meta max-w-xl">
                    Auto-renames chats after the first assistant reply. Use the runtime default model or pin a dedicated title model.
                  </p>
                </div>

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
              </div>
            </div>

            <div className="space-y-6 border-t border-border-subtle pt-6">
              <div className="space-y-1">
                <h2 className="text-[15px] font-medium text-primary">Model presets</h2>
                <p className="ui-card-meta max-w-3xl">
                  Presets are stored with the active profile. Switch profiles above to edit a different profile&apos;s routing defaults and fallback chains.
                </p>
              </div>

              {(modelPresetLoading && !modelPresetState) || (modelsLoading && !modelState) ? (
                <p className="ui-card-meta">Loading model presets…</p>
              ) : (!modelPresetState && modelPresetLoadError) ? (
                <p className="text-[12px] text-danger">Failed to load model presets: {modelPresetLoadError}</p>
              ) : (!modelState && modelsError) ? (
                <p className="text-[12px] text-danger">Failed to load models: {modelsError}</p>
              ) : modelPresetState && modelState ? (
                <div className="grid gap-8 xl:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="space-y-4 min-w-0">
                    <div className="space-y-2">
                      <label className="ui-card-meta" htmlFor="settings-default-model-preset">Default preset for new sessions</label>
                      <select
                        id="settings-default-model-preset"
                        value={defaultPresetDraftId}
                        onChange={(event) => {
                          setDefaultPresetDraftId(event.target.value);
                          setModelPresetError(null);
                          setModelPresetMessage(null);
                        }}
                        disabled={modelPresetAction !== null}
                        className={INPUT_CLASS}
                      >
                        <option value="">No default preset</option>
                        {modelPresetState.presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.id}</option>
                        ))}
                      </select>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { void handleSaveDefaultPreset(); }}
                          disabled={modelPresetAction !== null || !modelPresetDefaultDirty}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {modelPresetAction === 'default' ? 'Saving…' : 'Save default preset'}
                        </button>
                      </div>
                      <p className="ui-card-meta">
                        {modelPresetState.defaultPresetId
                          ? `Current default: ${modelPresetState.defaultPresetId}`
                          : 'No preset selected by default. Explicit model defaults are used instead.'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[13px] font-medium text-primary">Preset library</h3>
                        <button
                          type="button"
                          onClick={() => { handleSelectModelPreset(NEW_MODEL_PRESET_ID); }}
                          className={ACTION_BUTTON_CLASS}
                        >
                          New preset
                        </button>
                      </div>

                      {modelPresetState.presets.length > 0 ? (
                        <div className="overflow-hidden rounded-lg border border-border-subtle">
                          {modelPresetState.presets.map((preset, index) => {
                            const selected = preset.id === selectedModelPresetId;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => { handleSelectModelPreset(preset.id); }}
                                className={cx(
                                  'flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:bg-surface',
                                  index > 0 && 'border-t border-border-subtle',
                                  selected && 'bg-surface',
                                )}
                                aria-pressed={selected}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[13px] font-medium text-primary">{preset.id}</span>
                                  <span className="ui-card-meta block truncate">{formatModelRefLabel(preset.model, modelState.models)}</span>
                                </span>
                                {preset.fallbacks.length > 0 && (
                                  <span className="ui-card-meta hidden xl:block">{preset.fallbacks.length} fallback{preset.fallbacks.length === 1 ? '' : 's'}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="ui-card-meta">No presets saved for this profile yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 min-w-0">
                    <div className="space-y-1">
                      <h3 className="text-[15px] font-medium text-primary">
                        {selectedModelPresetId === NEW_MODEL_PRESET_ID ? 'New preset' : (selectedModelPreset?.id ?? 'Preset')}
                      </h3>
                      <p className="ui-card-meta max-w-3xl">
                        Choose the primary model first, then add ordered fallbacks that should be tried when the primary target is unavailable for this profile.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="ui-card-meta" htmlFor="settings-model-preset-id">Preset id</label>
                        <input
                          id="settings-model-preset-id"
                          value={modelPresetDraft.id}
                          onChange={(event) => {
                            setModelPresetDraft((current) => ({ ...current, id: event.target.value }));
                            setModelPresetError(null);
                            setModelPresetMessage(null);
                          }}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          placeholder="balanced"
                          autoComplete="off"
                          spellCheck={false}
                          disabled={modelPresetAction !== null}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="ui-card-meta" htmlFor="settings-model-preset-description">Description</label>
                        <input
                          id="settings-model-preset-description"
                          value={modelPresetDraft.description}
                          onChange={(event) => {
                            setModelPresetDraft((current) => ({ ...current, description: event.target.value }));
                            setModelPresetError(null);
                            setModelPresetMessage(null);
                          }}
                          className={INPUT_CLASS}
                          placeholder="Normal day-to-day work"
                          autoComplete="off"
                          disabled={modelPresetAction !== null}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="ui-card-meta" htmlFor="settings-model-preset-primary-model">Primary model</label>
                        <select
                          id="settings-model-preset-primary-model"
                          value={modelPresetDraft.model}
                          onChange={(event) => {
                            setModelPresetDraft((current) => ({ ...current, model: event.target.value }));
                            setModelPresetError(null);
                            setModelPresetMessage(null);
                          }}
                          disabled={modelPresetAction !== null || modelState.models.length === 0}
                          className={INPUT_CLASS}
                        >
                          <option value="">Select a model</option>
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
                      </div>
                      <div className="space-y-2">
                        <label className="ui-card-meta" htmlFor="settings-model-preset-primary-thinking">Primary thinking level</label>
                        <select
                          id="settings-model-preset-primary-thinking"
                          value={modelPresetDraft.thinkingLevel}
                          onChange={(event) => {
                            setModelPresetDraft((current) => ({ ...current, thinkingLevel: event.target.value }));
                            setModelPresetError(null);
                            setModelPresetMessage(null);
                          }}
                          disabled={modelPresetAction !== null}
                          className={INPUT_CLASS}
                        >
                          {THINKING_LEVEL_OPTIONS.map((option) => (
                            <option key={option.value || 'unset'} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-[13px] font-medium text-primary">Fallback targets</h4>
                        <button
                          type="button"
                          onClick={() => {
                            setModelPresetDraft((current) => ({ ...current, fallbacks: [...current.fallbacks, createFallbackDraft()] }));
                            setModelPresetError(null);
                            setModelPresetMessage(null);
                          }}
                          disabled={modelPresetAction !== null}
                          className={ACTION_BUTTON_CLASS}
                        >
                          Add fallback
                        </button>
                      </div>

                      {modelPresetDraft.fallbacks.length > 0 ? (
                        <div className="space-y-3">
                          {modelPresetDraft.fallbacks.map((fallback, index) => (
                            <div key={fallback.key} className="grid gap-3 rounded-lg border border-border-subtle p-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                              <div className="space-y-2 min-w-0">
                                <label className="ui-card-meta" htmlFor={`settings-model-preset-fallback-model-${fallback.key}`}>Fallback {index + 1}</label>
                                <select
                                  id={`settings-model-preset-fallback-model-${fallback.key}`}
                                  value={fallback.model}
                                  onChange={(event) => {
                                    setModelPresetDraft((current) => ({
                                      ...current,
                                      fallbacks: current.fallbacks.map((entry) => entry.key === fallback.key ? { ...entry, model: event.target.value } : entry),
                                    }));
                                    setModelPresetError(null);
                                    setModelPresetMessage(null);
                                  }}
                                  disabled={modelPresetAction !== null || modelState.models.length === 0}
                                  className={INPUT_CLASS}
                                >
                                  <option value="">Select a model</option>
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
                              </div>
                              <div className="space-y-2">
                                <label className="ui-card-meta" htmlFor={`settings-model-preset-fallback-thinking-${fallback.key}`}>Thinking level</label>
                                <select
                                  id={`settings-model-preset-fallback-thinking-${fallback.key}`}
                                  value={fallback.thinkingLevel}
                                  onChange={(event) => {
                                    setModelPresetDraft((current) => ({
                                      ...current,
                                      fallbacks: current.fallbacks.map((entry) => entry.key === fallback.key ? { ...entry, thinkingLevel: event.target.value } : entry),
                                    }));
                                    setModelPresetError(null);
                                    setModelPresetMessage(null);
                                  }}
                                  disabled={modelPresetAction !== null}
                                  className={INPUT_CLASS}
                                >
                                  {THINKING_LEVEL_OPTIONS.map((option) => (
                                    <option key={option.value || 'unset'} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModelPresetDraft((current) => ({
                                      ...current,
                                      fallbacks: current.fallbacks.filter((entry) => entry.key !== fallback.key),
                                    }));
                                    setModelPresetError(null);
                                    setModelPresetMessage(null);
                                  }}
                                  disabled={modelPresetAction !== null}
                                  className={ACTION_BUTTON_CLASS}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="ui-card-meta">No fallbacks configured. The preset will use only its primary model.</p>
                      )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="ui-card-meta" htmlFor="settings-model-preset-good-for">Good for</label>
                        <textarea
                          id="settings-model-preset-good-for"
                          value={modelPresetDraft.goodForText}
                          onChange={(event) => {
                            setModelPresetDraft((current) => ({ ...current, goodForText: event.target.value }));
                            setModelPresetError(null);
                            setModelPresetMessage(null);
                          }}
                          className={JSON_TEXTAREA_CLASS}
                          placeholder={"normal coding\nroutine debugging"}
                          disabled={modelPresetAction !== null}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="ui-card-meta" htmlFor="settings-model-preset-avoid-for">Avoid for</label>
                        <textarea
                          id="settings-model-preset-avoid-for"
                          value={modelPresetDraft.avoidForText}
                          onChange={(event) => {
                            setModelPresetDraft((current) => ({ ...current, avoidForText: event.target.value }));
                            setModelPresetError(null);
                            setModelPresetMessage(null);
                          }}
                          className={JSON_TEXTAREA_CLASS}
                          placeholder={"short low-risk lookups\npurely mechanical chores"}
                          disabled={modelPresetAction !== null}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="ui-card-meta" htmlFor="settings-model-preset-guidance">Instruction addendum</label>
                      <textarea
                        id="settings-model-preset-guidance"
                        value={modelPresetDraft.instructionAddendum}
                        onChange={(event) => {
                          setModelPresetDraft((current) => ({ ...current, instructionAddendum: event.target.value }));
                          setModelPresetError(null);
                          setModelPresetMessage(null);
                        }}
                        className={JSON_TEXTAREA_CLASS}
                        placeholder="Use solid judgment and normal depth."
                        disabled={modelPresetAction !== null}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void handleSaveModelPreset(); }}
                        disabled={modelPresetAction !== null}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {modelPresetAction === 'save' ? 'Saving…' : 'Save preset'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleDeleteModelPreset(); }}
                        disabled={modelPresetAction !== null || !selectedModelPreset}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {modelPresetAction === 'delete' ? 'Deleting…' : 'Delete preset'}
                      </button>
                    </div>

                    {modelPresetMessage && <p className="ui-card-meta">{modelPresetMessage}</p>}
                    {modelPresetError && <p className="text-[12px] text-danger">{modelPresetError}</p>}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className={cx('space-y-8', activePageId !== 'providers' && 'hidden')}>
            <SectionLabel label="Providers & models" />

            <div className="space-y-8">
              <div className="space-y-1">
                <h2 className="text-[15px] font-medium text-primary">Provider &amp; model definitions</h2>
                <p className="ui-card-meta max-w-3xl">
                  Edit <span className="font-mono text-[11px]">{modelProviderState?.filePath ?? 'models.json'}</span> for the active profile. Built-in providers still exist even when they are not listed here. Add a provider to create a custom provider or a built-in override.
                </p>
              </div>

              <div className="grid gap-8 xl:grid-cols-[240px_minmax(0,1fr)]">
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
                        <div className="overflow-hidden rounded-lg border border-border-subtle">
                          {modelProviderState.providers.map((provider, index) => {
                            const selected = provider.id === selectedModelProviderId;
                            return (
                              <button
                                key={provider.id}
                                type="button"
                                onClick={() => { selectModelProvider(provider.id); }}
                                className={cx(
                                  'flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:bg-surface',
                                  index > 0 && 'border-t border-border-subtle',
                                  selected && 'bg-surface',
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

                <div className="space-y-8 min-w-0">
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
                          <div className="overflow-hidden rounded-lg border border-border-subtle">
                            {selectedModelProvider.models.map((model, index) => (
                              <div
                                key={model.id}
                                className={cx('flex items-start justify-between gap-3 px-3 py-3', index > 0 && 'border-t border-border-subtle')}
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

              <div className="space-y-5 border-t border-border-subtle pt-8">
                <div className="space-y-1">
                  <h2 className="text-[15px] font-medium text-primary">Provider credentials</h2>
                  <p className="ui-card-meta max-w-2xl">
                    Manage API-key and OAuth credentials per provider. Stored credentials are written to <span className="font-mono text-[11px]">{providerAuthState?.authFile ?? 'auth.json'}</span>.
                  </p>
                </div>

                <div className="grid gap-8 lg:grid-cols-2">
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

                  <div className="space-y-3 min-w-0">
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
              </div>

              <CodexPlanUsageSummary
                usage={codexPlanUsage}
                loading={codexUsageEnabled && codexPlanUsageLoading}
                refreshing={codexPlanUsageRefreshing}
              />
            </div>
          </section>

          <section className={cx('space-y-5', activePageId !== 'interface' && 'hidden')}>
            <SectionLabel label="Interface state" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Reset saved UI preferences</h2>
              <p className="ui-card-meta max-w-3xl">
                These actions clear saved UI state. They do not delete conversations, project nodes, note nodes, skill nodes, or agent data.
              </p>
              {resetError && <p className="text-[12px] text-danger">Failed to reset UI state: {resetError}</p>}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2 min-w-0">
                <h3 className="text-[13px] font-medium text-primary">Layout widths</h3>
                <p className="ui-card-meta">
                  Clears the stored sidebar width and per-page context rail widths, then reloads the page.
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

              <div className="space-y-2 min-w-0">
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
          </section>

          <section className={cx('space-y-5', !activePageId.startsWith('system') && 'hidden')}>
            <SystemSettingsContent componentId={activeSystemComponent ?? undefined} />
          </section>

          <section className={cx('space-y-4', activePageId !== 'workspace' && 'hidden')}>
            <SectionLabel label="Workspace" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Repo root</h2>
              <p className="ui-card-meta max-w-3xl">
                The repository root currently used by the web app for projects, memory, tasks, and profile resources.
              </p>
            </div>

            <p className="break-all font-mono text-[12px] leading-relaxed text-primary">
              {status?.repoRoot ?? 'Unavailable'}
            </p>
            {statusError && <p className="text-[12px] text-danger">Failed to load workspace details: {statusError}</p>}
          </section>
        </div>
      </div>
    </div>
    </SettingsSplitLayout>
  );
}

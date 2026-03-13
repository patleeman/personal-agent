import { useMemo, useState } from 'react';
import { formatContextWindowLabel, formatThinkingLevelLabel } from '../conversationHeader';
import { api } from '../api';
import { useApi } from '../hooks';
import { THINKING_LEVEL_OPTIONS, groupModelsByProvider } from '../modelPreferences';
import { resetStoredConversationUiState, resetStoredLayoutPreferences } from '../localSettings';
import { type Theme, useTheme } from '../theme';
import type { ModelState } from '../types';
import { PageHeader, PageHeading, SectionLabel, ToolbarButton, cx } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'inline-flex items-center rounded-lg border border-border-subtle bg-base px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:opacity-50';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';

type ModelOption = ModelState['models'][number];

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

function ThemeButton({
  value,
  current,
  onSelect,
}: {
  value: Theme;
  current: Theme;
  onSelect: (theme: Theme) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cx('ui-segmented-button capitalize', current === value && 'ui-segmented-button-active')}
      aria-pressed={current === value}
    >
      {value}
    </button>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
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
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingPreference, setSavingPreference] = useState<'model' | 'thinking' | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [savingConversationTitle, setSavingConversationTitle] = useState<'enabled' | 'model' | null>(null);
  const [conversationTitleSaveError, setConversationTitleSaveError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<'layout' | 'conversation' | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const pageMeta = [
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
    <div className="flex h-full flex-col">
      <PageHeader actions={<ToolbarButton onClick={() => {
        void Promise.all([
          refetchProfiles({ resetLoading: false }),
          refetchModels({ resetLoading: false }),
          refetchConversationTitleSettings({ resetLoading: false }),
          refetchStatus({ resetLoading: false }),
        ]);
      }}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Settings"
          meta={pageMeta || 'Theme, profile defaults, model defaults, and interface reset tools.'}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-5xl space-y-8 pb-6">
          <section className="space-y-4">
            <SectionLabel label="Appearance" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Theme</h2>
              <p className="ui-card-meta max-w-2xl">
                Theme is stored in this browser only. Switch any time without reloading.
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="ui-segmented-control" role="group" aria-label="Theme selection">
                <ThemeButton value="light" current={theme} onSelect={setTheme} />
                <ThemeButton value="dark" current={theme} onSelect={setTheme} />
              </div>
              <span className="ui-card-meta capitalize">Current theme: {theme}</span>
            </div>
          </section>

          <section className="space-y-5 border-t border-border-subtle pt-6">
            <SectionLabel label="Agent defaults" />

            <div className="grid gap-8 lg:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-3 min-w-0">
                <div className="space-y-1">
                  <h2 className="text-[15px] font-medium text-primary">Profile</h2>
                  <p className="ui-card-meta max-w-xl">
                    Changes the active profile for inbox, projects, memory, gateway, and new live sessions. The app reloads after switching.
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
          </section>

          <section className="space-y-5 border-t border-border-subtle pt-6">
            <SectionLabel label="Interface state" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Reset saved UI preferences</h2>
              <p className="ui-card-meta max-w-3xl">
                These actions clear saved UI state. They do not delete conversations, projects, memory docs, or agent data.
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

          <section className="space-y-4 border-t border-border-subtle pt-6">
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
  );
}

import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageIntro, AppPageLayout, AppPageSection, ToolbarButton } from '@personal-agent/extensions/ui';
import React from 'react';

const PROVIDER_ID = 'mlx-local';
const BASE_URL = 'http://127.0.0.1:8011/v1';

type Status = {
  selectedModelId: string;
  loadedModelId: string | null;
  installed: boolean;
  downloaded?: string;
  server: { reachable: boolean; models: string[]; error?: string };
  setup: { status: 'running' | 'succeeded' | 'failed'; message: string; progress: number; error: string | null } | null;
  process: { managedRunning: boolean };
  log: string;
};

type SearchResult = { id: string; downloads: number; likes: number; tags: string[] };

type PageState = {
  status: Status | null;
  busy: string | null;
  error: string | null;
  modelInput: string;
  searchQuery: string;
  searchResults: SearchResult[];
  searchBusy: boolean;
};

function asStatus(value: unknown): Status | null {
  return value && typeof value === 'object' ? (value as Status) : null;
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function registerModelProvider(modelId: string) {
  await postJson('/api/model-providers/providers', {
    provider: PROVIDER_ID,
    api: 'openai-completions',
    baseUrl: BASE_URL,
    apiKey: 'local',
    authHeader: false,
    compat: { stream: true },
  });
  await postJson(`/api/model-providers/providers/${encodeURIComponent(PROVIDER_ID)}/models`, {
    modelId,
    name: modelId.split('/').pop() || modelId,
    api: 'openai-completions',
    baseUrl: BASE_URL,
    reasoning: true,
    input: ['text'],
    contextWindow: 131072,
  });
}

async function tryRegisterModelProvider(modelId: string) {
  try {
    await registerModelProvider(modelId);
  } catch {
    // The local API may be unavailable in extension preview/testing contexts.
    // Saving the selected model should still succeed; setup/start will use extension storage.
  }
}

function Toggle({ checked, disabled, onClick }: { checked: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className="relative inline-block shrink-0 rounded-full align-middle transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        width: 44,
        height: 24,
        padding: 0,
        border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: checked ? 'var(--color-accent)' : '#2a2f45',
      }}
    >
      <span
        className="absolute rounded-full bg-white shadow-sm transition-[left]"
        style={{ left: checked ? 21 : 1, top: 1, width: 20, height: 20 }}
      />
    </button>
  );
}

export class QwenMlxPage extends React.Component<ExtensionSurfaceProps, PageState> {
  state: PageState = { status: null, busy: null, error: null, modelInput: '', searchQuery: '', searchResults: [], searchBusy: false };
  private timer: number | null = null;

  componentDidMount() {
    void this.refresh(true);
    this.timer = window.setInterval(() => void this.refresh(), 5000);
  }

  componentWillUnmount() {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  private refresh = async (syncInput = false) => {
    try {
      const status = asStatus(await this.props.pa.extension.invoke('status', {}));
      this.setState((prev) => ({
        status,
        error: null,
        modelInput: syncInput && status ? status.selectedModelId : prev.modelInput || status?.selectedModelId || '',
      }));
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  private run = async (label: string, action: () => Promise<void>) => {
    this.setState({ busy: label, error: null });
    try {
      await action();
      await this.refresh();
      const modelId = this.state.status?.selectedModelId || this.state.modelInput.trim();
      if (modelId) await tryRegisterModelProvider(modelId);
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.setState({ busy: null });
    }
  };

  private toggleServer = async () => {
    const { status } = this.state;
    const shouldStop = status?.server.reachable || status?.process.managedRunning;
    await this.run(shouldStop ? 'Stopping…' : 'Starting…', async () => {
      await this.props.pa.extension.invoke(shouldStop ? 'stop' : 'start', {});
    });
  };

  private saveModel = async (modelId = this.state.modelInput) => {
    await this.run('Saving…', async () => {
      await this.props.pa.extension.invoke('setModel', { modelId: modelId.trim() });
    });
  };

  private searchModels = async () => {
    const query = this.state.searchQuery.trim();
    if (!query) return;
    this.setState({ searchBusy: true, error: null });
    try {
      const response = (await this.props.pa.extension.invoke('searchModels', { query })) as { models?: SearchResult[] };
      this.setState({ searchResults: response.models ?? [] });
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.setState({ searchBusy: false });
    }
  };

  render() {
    const { status, busy, error, modelInput, searchQuery, searchResults, searchBusy } = this.state;
    const running = Boolean(status?.server.reachable);
    const starting = Boolean(status?.process.managedRunning && !running);
    const setupRunning = status?.setup?.status === 'running';
    const ready = Boolean(status?.installed);
    const progress = Math.max(0, Math.min(100, Math.round(status?.setup?.progress ?? (ready ? 100 : 0))));
    const loadedModel = status?.loadedModelId || 'None';
    const title = running ? 'Enabled' : starting ? 'Starting' : setupRunning ? 'Downloading' : ready ? 'Ready' : 'Not installed';
    const subtitle = running
      ? `Loaded: ${loadedModel}`
      : setupRunning
        ? status?.setup?.message
        : ready
          ? `${status?.downloaded || 'Model'} downloaded`
          : 'Choose any MLX-compatible Hugging Face model, download it, then enable it locally.';

    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
          <AppPageIntro
            title="MLX Local Models"
            summary="Run Hugging Face MLX models locally and expose the loaded model through the PA model picker."
            actions={
              <div className="flex items-center gap-3">
                <span className="text-sm text-secondary">Enable</span>
                <Toggle
                  checked={running || starting}
                  disabled={Boolean(busy || setupRunning || !ready)}
                  onClick={() => void this.toggleServer()}
                />
              </div>
            }
          />

          <section className="space-y-5">
            <div className="flex flex-col gap-5 border-y border-border-subtle py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="text-2xl font-semibold tracking-[-0.03em] text-primary">{title}</div>
                  <div className="text-sm text-secondary">{busy || error || status?.setup?.error || status?.server.error || subtitle}</div>
                </div>
                <div className="truncate text-sm text-secondary">
                  Current loaded model: <span className="font-medium text-primary">{loadedModel}</span>
                </div>
              </div>
              <button
                disabled={Boolean(busy)}
                onClick={() => void this.refresh()}
                className="self-start text-sm text-secondary hover:text-primary disabled:opacity-60 sm:self-center"
                type="button"
              >
                Refresh
              </button>
            </div>
            {(setupRunning || progress > 0) && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-border-subtle">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            )}
          </section>

          <AppPageSection
            title="Model"
            description="Pick the MLX-compatible Hugging Face model to download and serve. Stop the current model before changing it."
          >
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={modelInput}
                  disabled={running || starting || Boolean(busy)}
                  onChange={(event) => this.setState({ modelInput: event.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent disabled:opacity-60"
                  placeholder="org/model-name-MLX"
                />
                <ToolbarButton disabled={Boolean(busy || running || starting || !modelInput.trim())} onClick={() => void this.saveModel()}>
                  Save
                </ToolbarButton>
                <ToolbarButton
                  disabled={Boolean(busy || setupRunning || !modelInput.trim())}
                  onClick={() =>
                    void this.run(
                      'Downloading…',
                      async () => void (await this.props.pa.extension.invoke('setup', { modelId: modelInput.trim() })),
                    )
                  }
                >
                  Setup / download
                </ToolbarButton>
              </div>
              <div className="text-xs text-dim">Selected: {status?.selectedModelId || modelInput || 'None'}</div>
            </div>
          </AppPageSection>

          <AppPageSection
            title="Search Hugging Face"
            description="Search public MLX models, then click a result to use its model id above."
          >
            <div className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={searchQuery}
                  onChange={(event) => this.setState({ searchQuery: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void this.searchModels();
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                  placeholder="Search MLX models"
                />
                <ToolbarButton disabled={searchBusy || !searchQuery.trim()} onClick={() => void this.searchModels()}>
                  {searchBusy ? 'Searching…' : 'Search'}
                </ToolbarButton>
              </div>
              {searchResults.length > 0 ? (
                <div className="divide-y divide-border-subtle border-y border-border-subtle text-sm">
                  {searchResults.map((model) => (
                    <div key={model.id} className="flex items-center justify-between gap-4 py-3">
                      <button
                        type="button"
                        disabled={running || starting}
                        onClick={() => this.setState({ modelInput: model.id })}
                        className="min-w-0 flex-1 truncate text-left font-medium text-primary hover:text-accent disabled:opacity-60"
                      >
                        {model.id}
                      </button>
                      <span className="shrink-0 text-xs text-secondary">{model.downloads.toLocaleString()} downloads</span>
                      <ToolbarButton disabled={Boolean(busy || running || starting)} onClick={() => void this.saveModel(model.id)}>
                        Use model
                      </ToolbarButton>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-secondary">Search for a model name like “Qwen MLX” or “Llama 4bit”.</div>
              )}
            </div>
          </AppPageSection>

          <AppPageSection title="Logs" description="Setup and server output from the local MLX process.">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-4 text-xs leading-relaxed text-secondary">
              {status?.log?.trim() || 'No logs yet.'}
            </pre>
          </AppPageSection>
        </AppPageLayout>
      </div>
    );
  }
}

export default QwenMlxPage;

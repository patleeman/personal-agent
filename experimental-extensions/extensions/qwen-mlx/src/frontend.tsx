import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageIntro, AppPageLayout, ToolbarButton } from '@personal-agent/extensions/ui';
import React from 'react';

const PROVIDER_ID = 'qwen-mlx';
const MODEL_ID = 'unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit';
const BASE_URL = 'http://127.0.0.1:8011/v1';

type Status = {
  installed: boolean;
  downloaded?: string;
  server: { reachable: boolean; models: string[]; error?: string };
  setup: { status: 'running' | 'succeeded' | 'failed'; message: string; progress: number; error: string | null } | null;
  process: { managedRunning: boolean };
  log: string;
};

type PageState = {
  status: Status | null;
  busy: string | null;
  error: string | null;
  showLog: boolean;
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

async function registerModelProvider() {
  await postJson('/api/model-providers/providers', {
    provider: PROVIDER_ID,
    api: 'openai-completions',
    baseUrl: BASE_URL,
    apiKey: 'local',
    authHeader: false,
    compat: { stream: true },
  });
  await postJson(`/api/model-providers/providers/${encodeURIComponent(PROVIDER_ID)}/models`, {
    modelId: MODEL_ID,
    name: 'Qwen3.6 35B A3B MLX 4-bit',
    api: 'openai-completions',
    baseUrl: BASE_URL,
    reasoning: true,
    input: ['text'],
    contextWindow: 131072,
  });
}

export class QwenMlxPage extends React.Component<ExtensionSurfaceProps, PageState> {
  state: PageState = { status: null, busy: null, error: null, showLog: false };
  private timer: number | null = null;

  componentDidMount() {
    void this.run('Registering…', async () => {
      await registerModelProvider();
      await this.refresh();
    });
    this.timer = window.setInterval(() => void this.refresh(), 5000);
  }

  componentWillUnmount() {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  private refresh = async () => {
    const status = asStatus(await this.props.pa.extension.invoke('status', {}));
    this.setState({ status });
  };

  private run = async (label: string, action: () => Promise<void>) => {
    this.setState({ busy: label, error: null });
    try {
      await action();
      await this.refresh();
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

  render() {
    const { status, busy, error, showLog } = this.state;
    const running = Boolean(status?.server.reachable);
    const starting = Boolean(status?.process.managedRunning && !running);
    const setupRunning = status?.setup?.status === 'running';
    const ready = Boolean(status?.installed);
    const progress = Math.max(0, Math.min(100, Math.round(status?.setup?.progress ?? (ready ? 100 : 0))));
    const title = running ? 'Running' : starting ? 'Starting' : setupRunning ? 'Downloading' : ready ? 'Ready' : 'Not installed';
    const subtitle = running
      ? BASE_URL
      : setupRunning
        ? status?.setup?.message
        : ready
          ? `${status?.downloaded || 'Model'} downloaded`
          : 'Download once, then start the local model when you need it.';

    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[56rem]" contentClassName="space-y-8">
          <AppPageIntro
            title="Qwen MLX"
            summary="Local Qwen3.6 35B MLX for PA. It registers itself in the model picker."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <ToolbarButton
                  disabled={Boolean(busy || setupRunning)}
                  onClick={() => void this.run('Downloading…', async () => void (await this.props.pa.extension.invoke('setup', {})))}
                >
                  Setup / download
                </ToolbarButton>
                <ToolbarButton disabled={Boolean(busy || setupRunning || !ready)} onClick={() => void this.toggleServer()}>
                  {running || starting ? 'Stop model' : 'Start model'}
                </ToolbarButton>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void this.refresh()}
                  className="px-2 text-sm text-secondary hover:text-primary disabled:opacity-60"
                  type="button"
                >
                  Refresh
                </button>
              </div>
            }
          />

          <section className="space-y-2">
            <div className="text-xl font-semibold text-primary">{title}</div>
            <div className="text-sm text-secondary">{busy || error || status?.setup?.error || status?.server.error || subtitle}</div>
            {(setupRunning || progress > 0) && (
              <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-border-subtle">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            )}
          </section>

          {status?.log && (
            <section className="space-y-3">
              <button
                onClick={() => this.setState({ showLog: !showLog })}
                className="text-sm text-secondary hover:text-primary"
                type="button"
              >
                {showLog ? 'Hide log' : 'Show log'}
              </button>
              {showLog && <pre className="whitespace-pre-wrap text-xs leading-relaxed text-secondary">{status.log}</pre>}
            </section>
          )}
        </AppPageLayout>
      </div>
    );
  }
}

export default QwenMlxPage;

import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageIntro, AppPageLayout, ToolbarButton } from '@personal-agent/extensions/ui';
import { useEffect, useState } from 'react';

type RuntimeStatus = {
  available: boolean;
  cliPath: string;
  modelCacheRoot: string;
  message?: string;
  version?: string;
};

type DownloadResult = {
  modelPath: string;
  bytes: number;
  cached: boolean;
};

export function LlamaCppPage({ pa }: ExtensionSurfaceProps) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [repo, setRepo] = useState('unsloth/Qwen3.6-35B-A3B-MTP-GGUF');
  const [filename, setFilename] = useState('');
  const [modelPath, setModelPath] = useState('');
  const [prompt, setPrompt] = useState('Write a short hello world in Rust.');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);

  async function refreshStatus() {
    const nextStatus = await pa.extension.invoke<RuntimeStatus>('runtimeStatus', {});
    setStatus(nextStatus);
  }

  async function downloadModel() {
    setBusy(true);
    setOutput('Downloading model. This can take a while for large GGUF files.');
    try {
      const result = await pa.extension.invoke<DownloadResult>('downloadModel', { repo, filename });
      setModelPath(result.modelPath);
      setOutput(`${result.cached ? 'Using cached model' : 'Downloaded model'}: ${result.modelPath}\nSize: ${result.bytes} bytes`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runPrompt() {
    setBusy(true);
    setOutput('');
    try {
      const result = await pa.extension.invoke<{ output: string }>('runPrompt', { modelPath, prompt, gpuLayers: 999, contextSize: 8192 });
      setOutput(result.output);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-8">
        <AppPageIntro title="llama.cpp" summary="Run local GGUF models with a bundled Metal-enabled llama.cpp runtime." />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-primary">Runtime</h2>
            <ToolbarButton onClick={() => void refreshStatus()}>Refresh</ToolbarButton>
          </div>
          <div className="space-y-1 text-sm text-secondary">
            <div>Status: {status?.available ? 'available' : 'missing'}</div>
            <div>
              Binary: <code className="text-dim">{status?.cliPath ?? 'checking…'}</code>
            </div>
            <div>
              Model cache: <code className="text-dim">{status?.modelCacheRoot ?? 'checking…'}</code>
            </div>
            {status?.version ? <pre className="whitespace-pre-wrap text-dim">{status.version}</pre> : null}
            {status?.message ? <p className="text-warning">{status.message}</p> : null}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-primary">Download GGUF from Hugging Face</h2>
          <label className="block space-y-2 text-sm">
            <span className="text-secondary">Repository</span>
            <input
              className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-primary"
              value={repo}
              placeholder="unsloth/Qwen3.6-35B-A3B-MTP-GGUF"
              onChange={(event) => setRepo(event.target.value)}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span className="text-secondary">GGUF filename</span>
            <input
              className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-primary"
              value={filename}
              placeholder="Exact .gguf filename from the repo"
              onChange={(event) => setFilename(event.target.value)}
            />
          </label>
          <ToolbarButton disabled={busy || !repo || !filename} onClick={() => void downloadModel()}>
            Download / use cache
          </ToolbarButton>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-primary">One-shot prompt</h2>
          <label className="block space-y-2 text-sm">
            <span className="text-secondary">GGUF model path</span>
            <input
              className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-primary"
              value={modelPath}
              placeholder="/path/to/model.gguf"
              onChange={(event) => setModelPath(event.target.value)}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span className="text-secondary">Prompt</span>
            <textarea
              className="min-h-32 w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-primary"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <ToolbarButton disabled={busy || !modelPath || !prompt || !status?.available} onClick={() => void runPrompt()}>
            {busy ? 'Working…' : 'Run'}
          </ToolbarButton>
          {output ? <pre className="whitespace-pre-wrap rounded-md bg-surface p-4 text-sm text-primary">{output}</pre> : null}
        </section>
      </AppPageLayout>
    </div>
  );
}

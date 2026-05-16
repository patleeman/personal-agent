import { type NativeExtensionClient } from '@personal-agent/extensions';
import { cx, ToolbarButton } from '@personal-agent/extensions/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { bytesToBase64, type ComposerDictationCapture, startComposerDictationCapture } from './capture.js';

const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none';
const CUSTOM_MODEL_VALUE = '__custom__';
const TRANSCRIPTION_MODEL_OPTIONS = [
  { id: 'tiny.en', label: 'Tiny English · fastest' },
  { id: 'base.en', label: 'Base English · default' },
  { id: 'small.en', label: 'Small English · recommended' },
  { id: 'medium.en', label: 'Medium English · most accurate' },
  { id: 'tiny', label: 'Tiny multilingual' },
  { id: 'base', label: 'Base multilingual' },
  { id: 'small', label: 'Small multilingual' },
  { id: 'medium', label: 'Medium multilingual' },
];
const TRANSCRIPTION_MODEL_IDS = new Set(TRANSCRIPTION_MODEL_OPTIONS.map((option) => option.id));

interface DictationSettings {
  enabled: boolean;
  model: string;
}
interface DictationSettingsState {
  settings: DictationSettings;
}
interface DictationModelStatus {
  model: string;
  installed: boolean;
  sizeBytes?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatElapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return '0:00';
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function DictationWaveform({ samples, startedAt }: { samples: number[]; startedAt: number | null }) {
  const [now, setNow] = useState(() => performance.now());
  const visibleSamples = samples.length > 0 ? samples : Array.from({ length: 28 }, () => 0.04);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden text-secondary" aria-label="Recording dictation">
      <div
        className="hidden min-w-0 max-w-[9rem] flex-1 items-center justify-end gap-[2px] overflow-hidden min-[520px]:flex"
        aria-hidden="true"
      >
        {visibleSamples.slice(-32).map((sample, index) => {
          const height = Math.max(2, Math.round(3 + sample * 22));
          const opacity = 0.28 + Math.min(0.72, sample * 1.4);
          return <span key={index} className="w-[2px] shrink-0 rounded-full bg-current" style={{ height: `${height}px`, opacity }} />;
        })}
      </div>
      <span className="shrink-0 font-mono text-[12px] text-secondary">{formatElapsed(startedAt, now)}</span>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
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
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  );
}

export function DictationButton({
  pa,
  buttonContext,
}: {
  pa: NativeExtensionClient;
  buttonContext: { composerDisabled: boolean; insertText: (text: string) => void; renderMode?: 'inline' | 'menu' };
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [enabled, setEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [samples, setSamples] = useState<number[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const captureRef = useRef<ComposerDictationCapture | null>(null);
  const pendingStartRef = useRef<Promise<void> | null>(null);
  const pointerRef = useRef<{ pointerId: number; startedAt: number; startedExistingRecording: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void pa.extension
      .invoke('readSettings')
      .then((value) => {
        if (cancelled) return;
        const next = value as DictationSettingsState;
        setEnabled(next.settings.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pa]);

  const stop = useCallback(async () => {
    if (pendingStartRef.current) {
      await pendingStartRef.current.catch(() => {});
    }
    const capture = captureRef.current;
    if (!capture) return;
    captureRef.current = null;
    setStartedAt(null);
    setState('transcribing');
    try {
      const { audio, durationMs, mimeType, fileName } = await capture.stop();
      if (audio.byteLength === 0 || durationMs < 150) return;
      const result = (await pa.extension.invoke('transcribeFile', { dataBase64: bytesToBase64(audio), mimeType, fileName })) as {
        text?: string;
      };
      const text = result.text?.trim();
      if (!text) {
        pa.ui.toast('Dictation did not detect any speech.');
        return;
      }
      buttonContext.insertText(text);
      pa.ui.toast('Dictation inserted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pa.ui.toast(message.toLowerCase().includes('empty transcript') ? 'Dictation did not detect any speech.' : message);
    } finally {
      setState('idle');
    }
  }, [buttonContext, pa]);

  const start = useCallback(async () => {
    if (!enabled || buttonContext.composerDisabled || captureRef.current || pendingStartRef.current || state === 'transcribing') return;
    const pendingStart = (async () => {
      try {
        setSamples([]);
        setStartedAt(performance.now());
        setState('recording');
        captureRef.current = await startComposerDictationCapture({
          onLevel: (level) => setSamples((current) => [...current.slice(-71), level]),
        });
      } catch (error) {
        setStartedAt(null);
        setState('idle');
        pa.ui.toast(error instanceof Error ? error.message : String(error));
      } finally {
        pendingStartRef.current = null;
      }
    })();
    pendingStartRef.current = pendingStart;
    await pendingStart;
  }, [buttonContext.composerDisabled, enabled, pa, state]);

  if (!settingsLoaded || !enabled) return null;

  return (
    <>
      {state === 'recording' ? <DictationWaveform samples={samples} startedAt={startedAt} /> : null}
      <button
        type="button"
        onPointerDown={(event) => {
          if (event.button !== 0 || buttonContext.composerDisabled || state === 'transcribing') return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const startedExistingRecording = captureRef.current !== null;
          pointerRef.current = { pointerId: event.pointerId, startedAt: performance.now(), startedExistingRecording };
          if (!startedExistingRecording) void start();
        }}
        onPointerUp={(event) => {
          const pointer = pointerRef.current;
          if (!pointer || pointer.pointerId !== event.pointerId) return;
          event.preventDefault();
          pointerRef.current = null;
          if (pointer.startedExistingRecording || performance.now() - pointer.startedAt >= 300) void stop();
        }}
        onPointerCancel={(event) => {
          const pointer = pointerRef.current;
          if (!pointer || pointer.pointerId !== event.pointerId) return;
          pointerRef.current = null;
          if (!pointer.startedExistingRecording) void stop();
        }}
        disabled={buttonContext.composerDisabled || state === 'transcribing'}
        className={cx(
          'flex h-8 w-8 shrink-0 touch-none items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-40',
          state === 'recording'
            ? 'bg-danger/15 text-danger hover:bg-danger/25'
            : state === 'transcribing'
              ? 'bg-elevated text-accent'
              : 'text-secondary hover:bg-elevated/60 hover:text-primary',
        )}
        title={
          state === 'recording'
            ? 'Recording dictation — release after a hold to stop, or click again to toggle off'
            : state === 'transcribing'
              ? 'Transcribing…'
              : 'Dictate. Hold to record while held, or click to toggle.'
        }
        aria-label={state === 'recording' ? 'Stop dictation' : 'Start dictation'}
      >
        {state === 'transcribing' ? (
          <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
        ) : (
          <MicIcon />
        )}
      </button>
    </>
  );
}

export function DictationSettingsPanel({ pa, settingsContext }: { pa: NativeExtensionClient; settingsContext?: { extensionId?: string } }) {
  const [settings, setSettings] = useState<DictationSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('base.en');
  const [customModelUrl, setCustomModelUrl] = useState('');
  const [status, setStatus] = useState<DictationModelStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const state = (await pa.extension.invoke('readSettings')) as DictationSettingsState;
    setSettings(state.settings);
    setEnabled(state.settings.enabled);
    setModel(state.settings.model);
    setCustomModelUrl(TRANSCRIPTION_MODEL_IDS.has(state.settings.model) ? '' : state.settings.model);
  }, [pa]);

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [load]);

  useEffect(() => {
    if (!enabled || !model.trim()) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    void pa.extension
      .invoke('modelStatus', { model: model.trim() })
      .then((value) => {
        if (!cancelled) setStatus(value as DictationModelStatus);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [model, enabled, pa]);

  async function saveFields(nextEnabled = enabled, nextModel = model) {
    setBusy('Saving…');
    setMessage(null);
    try {
      const saved = (await pa.extension.invoke('updateSettings', {
        enabled: nextEnabled,
        model: nextModel.trim(),
      })) as DictationSettingsState;
      setSettings(saved.settings);
      setMessage('Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function install() {
    if (!enabled || !model.trim()) return;
    setBusy('Installing…');
    setMessage(null);
    try {
      const installed = (await pa.extension.invoke('installModel', { model: model.trim() })) as {
        model: string;
        cacheDir: string;
      };
      setMessage(`Installed ${installed.model} in ${installed.cacheDir}.`);
      setStatus((await pa.extension.invoke('modelStatus', { model: model.trim() })) as DictationModelStatus);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const statusLabel =
    enabled && model.trim()
      ? status?.installed
        ? `Installed locally${status.sizeBytes ? ` · ${formatBytes(status.sizeBytes)}` : ''}`
        : 'Not installed yet'
      : 'Enable dictation to check model install status.';

  return (
    <div className="space-y-0">
      <section className="scroll-mt-24 grid gap-5 py-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-2">
          <div className="space-y-1.5">
            <h3 className="text-[15px] font-medium tracking-tight text-primary">Local Dictation</h3>
            <p className="max-w-sm text-[12px] leading-5 text-secondary">
              Record audio from the composer mic button and transcribe it locally via Whisper.cpp.
            </p>
            {settingsContext?.extensionId ? (
              <p className="max-w-sm text-[12px] leading-5 text-secondary">
                Injected by <span className="font-mono text-primary">{settingsContext.extensionId}</span>.
              </p>
            ) : null}
          </div>
        </div>
        <div className="min-w-0 space-y-3.5">
          {!settings ? <p className="ui-card-meta">Loading dictation settings…</p> : null}
          {settings ? (
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  id="settings-dictation-enabled"
                  checked={enabled}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setEnabled(next);
                    void saveFields(next, model);
                  }}
                  className="h-4 w-4 rounded border-border-subtle text-accent focus:ring-accent/30"
                />
                <span className="text-[13px] text-primary select-none">Enable local dictation</span>
              </label>
              {enabled ? (
                <>
                  <label className="ui-card-meta pt-1" htmlFor="settings-dictation-model">
                    Model
                  </label>
                  <select
                    id="settings-dictation-model"
                    value={TRANSCRIPTION_MODEL_IDS.has(model) ? model : CUSTOM_MODEL_VALUE}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === CUSTOM_MODEL_VALUE) {
                        const custom = customModelUrl.trim();
                        setModel(custom);
                        setCustomModelUrl(custom);
                        return;
                      }
                      setModel(next);
                      void saveFields(enabled, next);
                    }}
                    className={INPUT_CLASS}
                  >
                    {TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                    <option value={CUSTOM_MODEL_VALUE}>Custom Hugging Face URL…</option>
                  </select>
                  {!TRANSCRIPTION_MODEL_IDS.has(model) ? (
                    <div className="space-y-1.5">
                      <label className="ui-card-meta" htmlFor="settings-dictation-custom-model">
                        Custom model URL
                      </label>
                      <input
                        id="settings-dictation-custom-model"
                        value={customModelUrl}
                        onChange={(event) => {
                          setCustomModelUrl(event.target.value);
                          setModel(event.target.value);
                        }}
                        onBlur={() => void saveFields(enabled, customModelUrl)}
                        className={`${INPUT_CLASS} font-mono text-[13px]`}
                        placeholder="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <p className="text-[12px] leading-5 text-dim">
                        Use a direct Hugging Face <span className="font-mono">/resolve/</span> URL to a Whisper.cpp-compatible{' '}
                        <span className="font-mono">ggml-*.bin</span> file.
                      </p>
                    </div>
                  ) : null}
                  <p className={cx('text-[12px]', status?.installed ? 'text-success' : 'text-dim')}>{statusLabel}</p>
                  <ToolbarButton
                    type="button"
                    className={ACTION_BUTTON_CLASS}
                    disabled={Boolean(busy) || !model.trim()}
                    onClick={() => void install()}
                  >
                    {busy === 'Installing…' ? 'Installing…' : status?.installed ? 'Reinstall local model' : 'Install local model'}
                  </ToolbarButton>
                </>
              ) : (
                <p className="ui-card-meta">Dictation is disabled.</p>
              )}
              {busy === 'Saving…' ? <p className="ui-card-meta">Saving…</p> : null}
              {message ? <p className="text-[12px] text-secondary">{message}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

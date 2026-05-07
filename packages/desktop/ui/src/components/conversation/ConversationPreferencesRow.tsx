import { useEffect, useMemo, useRef, useState } from 'react';

import { getModelSelectableServiceTierOptions, getModelThinkingLevelOptions, groupModelsByProvider } from '../../model/modelPreferences';
import type { ModelInfo, RunMode } from '../../shared/types';
import { cx, IconButton } from '../ui';

const MODE_LABELS: Record<RunMode, string> = {
  manual: 'Chat',
  nudge: 'Nudge',
  mission: 'Mission',
  loop: 'Loop',
};

const MODE_COLORS: Record<RunMode, string> = {
  manual: '',
  nudge: 'text-warning',
  mission: 'text-accent',
  loop: 'text-teal',
};

const COMPOSER_PREFERENCE_SELECT_CLASS =
  'h-8 min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 pr-6 text-[11px] font-medium text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:border-border-subtle focus-visible:bg-surface/55 focus-visible:text-primary focus-visible:ring-1 focus-visible:ring-accent/20 disabled:cursor-default disabled:opacity-40';

type PreferenceTone = 'accent' | 'warning';
type SavingPreference = 'model' | 'thinking' | 'serviceTier' | null;

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function ConversationThinkingLevelSelect({
  value,
  disabled,
  variant = 'inline',
  model,
  onChange,
}: {
  value: string;
  disabled: boolean;
  variant?: 'inline' | 'menu';
  model: ModelInfo | null;
  onChange: (thinkingLevel: string) => void;
}) {
  const selectClassName =
    variant === 'menu'
      ? 'h-9 w-full min-w-0 appearance-none rounded-lg border border-border-subtle bg-surface/45 px-2.5 pr-7 text-[12px] font-medium text-primary outline-none transition-colors hover:bg-surface/65 focus-visible:border-accent/50 focus-visible:bg-surface/65 disabled:cursor-default disabled:opacity-40'
      : cx(COMPOSER_PREFERENCE_SELECT_CLASS, 'max-w-[6.5rem] min-w-[5.75rem] appearance-none');

  return (
    <label className={variant === 'menu' ? 'relative flex min-w-0 items-center' : 'relative inline-flex min-w-0 items-center'}>
      <span className="sr-only">Conversation thinking level</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        disabled={disabled}
        className={selectClassName}
        aria-label="Conversation thinking level"
      >
        {getModelThinkingLevelOptions(model).map((option) => (
          <option key={option.value || 'unset'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2.5 text-dim/70"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

function ConversationModelSelect({
  groupedModels,
  currentModel,
  disabled,
  variant = 'inline',
  onChange,
}: {
  groupedModels: Array<[string, ModelInfo[]]>;
  currentModel: string;
  disabled: boolean;
  variant?: 'inline' | 'menu';
  onChange: (modelId: string) => void;
}) {
  const selectClassName =
    variant === 'menu'
      ? 'h-9 w-full min-w-0 appearance-none rounded-lg border border-border-subtle bg-surface/45 px-2.5 pr-7 text-[12px] font-medium text-primary outline-none transition-colors hover:bg-surface/65 focus-visible:border-accent/50 focus-visible:bg-surface/65 disabled:cursor-default disabled:opacity-40'
      : cx(COMPOSER_PREFERENCE_SELECT_CLASS, 'max-w-[11.5rem] min-w-[8.25rem] appearance-none');

  return (
    <label className={variant === 'menu' ? 'relative flex min-w-0 items-center' : 'relative inline-flex min-w-0 items-center'}>
      <span className="sr-only">Conversation model</span>
      <select
        value={currentModel}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        disabled={disabled}
        className={selectClassName}
        aria-label="Conversation model"
      >
        {groupedModels.map(([provider, providerModels]) => (
          <optgroup key={provider} label={provider}>
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <svg
        aria-hidden="true"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2.5 text-dim/70"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

function ConversationModeControl({
  currentMode,
  onChange,
  disabled,
}: {
  currentMode: RunMode;
  onChange: (mode: RunMode) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const modes: RunMode[] = ['manual', 'nudge', 'mission', 'loop'];
  const colorClass = MODE_COLORS[currentMode];

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Run mode"
        aria-expanded={open}
        className={cx(
          'flex h-8 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors',
          'border-transparent hover:bg-surface/45 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/25',
          open && 'bg-surface/55',
          colorClass || 'text-secondary',
        )}
      >
        <span>{MODE_LABELS[currentMode]}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-dim/70"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="ui-context-menu-shell absolute bottom-full left-0 z-50 mb-1.5 w-[8rem] p-1.5">
          <div className="flex flex-col gap-0.5">
            {modes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
                className={cx(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition-colors',
                  m === currentMode ? 'bg-accent/10 text-accent' : 'text-secondary hover:bg-surface/45 hover:text-primary',
                  MODE_COLORS[m],
                )}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationPreferenceToggle({
  label,
  enabled,
  busy = false,
  disabled,
  tone,
  title,
  layout,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  busy?: boolean;
  disabled: boolean;
  tone: PreferenceTone;
  title: string;
  layout: 'inline' | 'menu';
  onToggle: () => void;
}) {
  const activeTrackClassName =
    tone === 'warning'
      ? 'border-warning/55 bg-warning/75 shadow-[0_0_8px_rgba(245,158,11,0.16)]'
      : 'border-accent/55 bg-accent/75 shadow-[0_0_8px_rgba(168,85,247,0.16)]';
  const focusRingClassName = tone === 'warning' ? 'focus-visible:ring-warning/25' : 'focus-visible:ring-accent/25';
  const buttonClassName =
    layout === 'menu'
      ? 'group inline-flex w-full items-center justify-between rounded-lg border border-border-subtle bg-surface/45 px-2.5 py-2 text-[11px] font-medium text-secondary transition-colors hover:bg-surface/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40'
      : 'group inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-[11px] font-medium text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={busy}
      aria-label={title}
      title={title}
      onClick={onToggle}
      disabled={disabled || busy}
      className={cx(buttonClassName, focusRingClassName)}
    >
      {layout === 'menu' ? <span className={cx('leading-none', enabled && 'text-primary')}>{label}</span> : null}
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border p-[1px] transition-all',
          enabled ? activeTrackClassName : 'border-border-default bg-surface/40 group-hover:bg-surface/60',
          busy && 'opacity-80',
        )}
      >
        <span
          className={cx(
            'h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[14px]' : 'translate-x-0',
            busy && 'animate-pulse',
          )}
        />
      </span>
      {layout === 'inline' ? <span className={cx('leading-none', enabled && 'text-primary')}>{label}</span> : null}
    </button>
  );
}

export function ConversationPreferencesRow({
  models,
  currentModel,
  currentThinkingLevel,
  currentServiceTier,
  savingPreference,
  showAutoModeToggle,
  autoModeEnabled: _autoModeEnabled,
  autoModeBusy,
  mode,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectServiceTier,
  onToggleAutoMode: _onToggleAutoMode,
  onSelectMode,
  compact,
}: {
  models: ModelInfo[];
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  savingPreference: SavingPreference;
  showAutoModeToggle: boolean;
  autoModeEnabled: boolean;
  autoModeBusy: boolean;
  mode: RunMode;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
  onSelectServiceTier: (enableFastMode: boolean) => void;
  onToggleAutoMode: () => void;
  onSelectMode: (mode: RunMode) => void;
  compact: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedModel = useMemo(() => models.find((model) => model.id === currentModel) ?? null, [currentModel, models]);
  const serviceTierOptions = useMemo(() => getModelSelectableServiceTierOptions(selectedModel), [selectedModel]);
  const supportsFastMode = useMemo(() => serviceTierOptions.some((option) => option.value === 'priority'), [serviceTierOptions]);
  const fastModeEnabled = currentServiceTier === 'priority';

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2">
      {!compact && (
        <ConversationModelSelect
          groupedModels={groupedModels}
          currentModel={currentModel}
          disabled={savingPreference !== null || models.length === 0}
          onChange={onSelectModel}
        />
      )}

      {!compact && (
        <ConversationThinkingLevelSelect
          value={currentThinkingLevel}
          disabled={savingPreference !== null}
          model={selectedModel}
          onChange={onSelectThinkingLevel}
        />
      )}

      {!compact && showAutoModeToggle && <ConversationModeControl currentMode={mode} disabled={autoModeBusy} onChange={onSelectMode} />}

      <div ref={menuRef} className="relative">
        <IconButton
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          className={cx(
            'h-8 w-8 rounded-md border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
            menuOpen && 'bg-surface/55 text-primary',
          )}
          aria-label="More composer settings"
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          title="Model, thinking, and priority settings"
        >
          <MoreHorizontalIcon />
        </IconButton>
        {menuOpen && (
          <div
            className="ui-context-menu-shell absolute bottom-full left-0 z-50 mb-2 w-[15rem] p-2.5"
            role="dialog"
            aria-label="Composer settings"
          >
            <div className="flex flex-col gap-2">
              {compact && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Model</p>
                  <ConversationModelSelect
                    groupedModels={groupedModels}
                    currentModel={currentModel}
                    disabled={savingPreference !== null || models.length === 0}
                    variant="menu"
                    onChange={(modelId) => {
                      onSelectModel(modelId);
                      setMenuOpen(false);
                    }}
                  />
                </div>
              )}
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Thinking</p>
                <ConversationThinkingLevelSelect
                  value={currentThinkingLevel}
                  disabled={savingPreference !== null}
                  variant="menu"
                  model={selectedModel}
                  onChange={(thinkingLevel) => {
                    onSelectThinkingLevel(thinkingLevel);
                    setMenuOpen(false);
                  }}
                />
              </div>
              {supportsFastMode && (
                <ConversationPreferenceToggle
                  label="Fast mode"
                  enabled={fastModeEnabled}
                  disabled={savingPreference !== null}
                  tone="accent"
                  title={fastModeEnabled ? 'Disable fast mode' : 'Enable fast mode'}
                  layout="menu"
                  onToggle={() => {
                    onSelectServiceTier(!fastModeEnabled);
                    setMenuOpen(false);
                  }}
                />
              )}
              {compact && showAutoModeToggle && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Mode</p>
                  <label className="relative flex min-w-0 items-center">
                    <span className="sr-only">Mode</span>
                    <select
                      value={mode}
                      onChange={(event) => {
                        onSelectMode(event.target.value as RunMode);
                        setMenuOpen(false);
                      }}
                      disabled={autoModeBusy}
                      className="h-9 w-full min-w-0 appearance-none rounded-lg border border-border-subtle bg-surface/45 px-2.5 pr-7 text-[12px] font-medium text-primary outline-none transition-colors hover:bg-surface/65 focus-visible:border-accent/50 focus-visible:bg-surface/65 disabled:cursor-default disabled:opacity-40"
                      aria-label="Mode"
                    >
                      <option value="manual">Chat</option>
                      <option value="nudge">Nudge</option>
                      <option value="mission">Mission</option>
                      <option value="loop">Loop</option>
                    </select>
                    <svg
                      aria-hidden="true"
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="pointer-events-none absolute right-2.5 text-dim/70"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';

import { getModelSelectableServiceTierOptions, getModelThinkingLevelOptions, groupModelsByProvider } from '../../model/modelPreferences';
import type { ConversationAutoModeBudget, ConversationAutoModeMode, ConversationAutoModeState, ModelInfo } from '../../shared/types';
import { cx, IconButton } from '../ui';

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

function AutoModePopover({
  state,
  busy,
  suggestedMission,
  onApply,
  onClose,
}: {
  state: ConversationAutoModeState | null;
  busy: boolean;
  suggestedMission: string;
  onApply: (input: {
    enabled: boolean;
    mission: string | null;
    mode: ConversationAutoModeMode;
    budget: ConversationAutoModeBudget | null;
  }) => void;
  onClose: () => void;
}) {
  const [mission, setMission] = useState(state?.mission ?? suggestedMission);
  const [mode, setMode] = useState<ConversationAutoModeMode>(state?.mode ?? 'tenacious');
  const [turnBudget, setTurnBudget] = useState(state?.budget?.maxTurns ? String(state.budget.maxTurns) : '5');
  const enabled = state?.enabled === true;
  const trimmedMission = mission.trim();
  const budget = mode === 'forced' ? { maxTurns: Math.max(1, Math.min(100, Number.parseInt(turnBudget, 10) || 5)) } : null;

  return (
    <div
      className="ui-context-menu-shell absolute bottom-full right-0 z-50 mb-2 w-[22rem] p-3"
      role="dialog"
      aria-label="Auto mode settings"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-primary">Auto mode</p>
          <p className="mt-0.5 text-[11px] leading-4 text-dim">Give the agent a mission and a stopping rule.</p>
        </div>
        {enabled ? <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-warning">On</span> : null}
      </div>

      <label className="mt-3 block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/75">Mission</span>
        <textarea
          value={mission}
          onChange={(event) => setMission(event.target.value)}
          className="mt-1 min-h-[5rem] w-full resize-none rounded-lg border border-border-subtle bg-base/60 px-2.5 py-2 text-[12px] leading-5 text-primary outline-none focus:border-warning/50 focus:ring-1 focus:ring-warning/20"
          placeholder="What should auto mode keep working on?"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/75">Mode</span>
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as ConversationAutoModeMode)}
          className="mt-1 h-9 w-full rounded-lg border border-border-subtle bg-base/60 px-2.5 text-[12px] text-primary outline-none focus:border-warning/50 focus:ring-1 focus:ring-warning/20"
        >
          <option value="normal">Normal — continue while useful work remains</option>
          <option value="tenacious">Tenacious — stop only when complete or blocked</option>
          <option value="forced">Forced — use a turn budget</option>
        </select>
      </label>

      {mode === 'forced' ? (
        <label className="mt-3 block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/75">Turn budget</span>
          <input
            type="number"
            min={1}
            max={100}
            value={turnBudget}
            onChange={(event) => setTurnBudget(event.target.value)}
            className="mt-1 h-9 w-24 rounded-lg border border-border-subtle bg-base/60 px-2.5 text-[12px] text-primary outline-none focus:border-warning/50 focus:ring-1 focus:ring-warning/20"
          />
        </label>
      ) : null}

      {state?.stopReason ? <p className="mt-3 text-[11px] leading-4 text-dim">Last stop: {state.stopReason}</p> : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        {enabled ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onApply({ enabled: false, mission: state?.mission ?? null, mode: state?.mode ?? 'normal', budget: state?.budget ?? null })
            }
            className="h-8 rounded-md px-2.5 text-[11px] font-medium text-secondary hover:bg-surface/60 hover:text-primary disabled:opacity-50"
          >
            Turn off
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-md px-2.5 text-[11px] font-medium text-secondary hover:bg-surface/60 hover:text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !trimmedMission}
          onClick={() => onApply({ enabled: true, mission: trimmedMission, mode, budget })}
          className="h-8 rounded-md bg-warning/80 px-3 text-[11px] font-semibold text-black shadow-sm hover:bg-warning disabled:opacity-50"
        >
          {enabled ? 'Update' : 'Start'}
        </button>
      </div>
    </div>
  );
}

export function ConversationPreferencesRow({
  models,
  currentModel,
  currentThinkingLevel,
  currentServiceTier,
  savingPreference,
  showAutoModeToggle,
  autoModeEnabled,
  autoModeBusy,
  autoModeState,
  suggestedAutoModeMission,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectServiceTier,
  onConfigureAutoMode,
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
  autoModeState: ConversationAutoModeState | null;
  suggestedAutoModeMission: string;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
  onSelectServiceTier: (enableFastMode: boolean) => void;
  onConfigureAutoMode: (input: {
    enabled: boolean;
    mission: string | null;
    mode: ConversationAutoModeMode;
    budget: ConversationAutoModeBudget | null;
  }) => void;
  compact: boolean;
}) {
  const [compactMenuOpen, setCompactMenuOpen] = useState(false);
  const [autoModePopoverOpen, setAutoModePopoverOpen] = useState(false);
  const autoModeRef = useRef<HTMLDivElement | null>(null);
  const compactMenuRef = useRef<HTMLDivElement | null>(null);
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedModel = useMemo(() => models.find((model) => model.id === currentModel) ?? null, [currentModel, models]);
  const serviceTierOptions = useMemo(() => getModelSelectableServiceTierOptions(selectedModel), [selectedModel]);
  const supportsFastMode = useMemo(() => serviceTierOptions.some((option) => option.value === 'priority'), [serviceTierOptions]);
  const fastModeEnabled = currentServiceTier === 'priority';

  useEffect(() => {
    if (!compactMenuOpen && !autoModePopoverOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (compactMenuRef.current?.contains(target) || autoModeRef.current?.contains(target)) {
        return;
      }

      setCompactMenuOpen(false);
      setAutoModePopoverOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setCompactMenuOpen(false);
        setAutoModePopoverOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [autoModePopoverOpen, compactMenuOpen]);

  return (
    <div ref={autoModeRef} className="relative flex min-w-0 flex-nowrap items-center gap-2">
      {!compact ? (
        <>
          <ConversationModelSelect
            groupedModels={groupedModels}
            currentModel={currentModel}
            disabled={savingPreference !== null || models.length === 0}
            onChange={onSelectModel}
          />
          <ConversationThinkingLevelSelect
            value={currentThinkingLevel}
            disabled={savingPreference !== null}
            model={selectedModel}
            onChange={onSelectThinkingLevel}
          />
          {supportsFastMode ? (
            <ConversationPreferenceToggle
              label="Fast"
              enabled={fastModeEnabled}
              disabled={savingPreference !== null}
              tone="accent"
              title={fastModeEnabled ? 'Disable fast mode' : 'Enable fast mode'}
              layout="inline"
              onToggle={() => {
                onSelectServiceTier(!fastModeEnabled);
              }}
            />
          ) : null}
          {showAutoModeToggle ? (
            <div className="relative">
              <ConversationPreferenceToggle
                label="Auto"
                enabled={autoModeEnabled}
                busy={autoModeBusy}
                disabled={false}
                tone="warning"
                title={autoModeBusy ? 'Updating auto mode…' : 'Configure conversation auto mode'}
                layout="inline"
                onToggle={() => {
                  setAutoModePopoverOpen((current) => !current);
                }}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {autoModePopoverOpen ? (
        <AutoModePopover
          state={autoModeState}
          busy={autoModeBusy}
          suggestedMission={suggestedAutoModeMission}
          onApply={(next) => {
            onConfigureAutoMode(next);
            setAutoModePopoverOpen(false);
          }}
          onClose={() => setAutoModePopoverOpen(false)}
        />
      ) : null}

      {compact ? (
        <div ref={compactMenuRef} className="relative">
          <IconButton
            type="button"
            onClick={() => setCompactMenuOpen((current) => !current)}
            className={cx(
              'h-8 w-8 rounded-md border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
              compactMenuOpen && 'bg-surface/55 text-primary',
            )}
            aria-label="More composer settings"
            aria-expanded={compactMenuOpen}
            aria-haspopup="dialog"
            title="More composer settings"
          >
            <MoreHorizontalIcon />
          </IconButton>
          {compactMenuOpen && (
            <div
              className="ui-context-menu-shell absolute bottom-full left-0 z-50 mb-2 w-[15rem] p-2.5"
              role="dialog"
              aria-label="Composer settings"
            >
              <div className="flex flex-col gap-2">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Model</p>
                  <ConversationModelSelect
                    groupedModels={groupedModels}
                    currentModel={currentModel}
                    disabled={savingPreference !== null || models.length === 0}
                    variant="menu"
                    onChange={(modelId) => {
                      onSelectModel(modelId);
                      setCompactMenuOpen(false);
                    }}
                  />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Thinking</p>
                  <ConversationThinkingLevelSelect
                    value={currentThinkingLevel}
                    disabled={savingPreference !== null}
                    variant="menu"
                    model={selectedModel}
                    onChange={(thinkingLevel) => {
                      onSelectThinkingLevel(thinkingLevel);
                      setCompactMenuOpen(false);
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
                      setCompactMenuOpen(false);
                    }}
                  />
                )}
                {showAutoModeToggle && (
                  <ConversationPreferenceToggle
                    label="Auto mode"
                    enabled={autoModeEnabled}
                    busy={autoModeBusy}
                    disabled={false}
                    tone="warning"
                    title={autoModeBusy ? 'Updating auto mode…' : 'Configure conversation auto mode'}
                    layout="menu"
                    onToggle={() => {
                      setAutoModePopoverOpen(true);
                      setCompactMenuOpen(false);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

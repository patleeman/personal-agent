import { useEffect, useMemo, useRef, useState } from 'react';

import { type ComposerButtonContext, ComposerButtonHost } from '../../extensions/ComposerButtonHost';
import type { ExtensionComposerButtonRegistration } from '../../extensions/useExtensionRegistry';
import { getModelSelectableServiceTierOptions, getModelThinkingLevelOptions, groupModelsByProvider } from '../../model/modelPreferences';
import type { ModelInfo } from '../../shared/types';
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

export function ConversationPreferencesRow({
  models,
  currentModel,
  currentThinkingLevel,
  currentServiceTier,
  savingPreference,
  composerButtons = [],
  composerButtonContext,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectServiceTier,
  inlineLimit,
}: {
  models: ModelInfo[];
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  savingPreference: SavingPreference;
  composerButtons: ExtensionComposerButtonRegistration[];
  composerButtonContext: Omit<ComposerButtonContext, 'renderMode'>;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
  onSelectServiceTier: (enableFastMode: boolean) => void;
  inlineLimit: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedModel = useMemo(() => models.find((model) => model.id === currentModel) ?? null, [currentModel, models]);
  const serviceTierOptions = useMemo(() => getModelSelectableServiceTierOptions(selectedModel), [selectedModel]);
  const supportsFastMode = useMemo(() => serviceTierOptions.some((option) => option.value === 'priority'), [serviceTierOptions]);
  const fastModeEnabled = currentServiceTier === 'priority';
  const preferenceItems = useMemo(
    () => [
      { id: 'model' as const },
      ...composerButtons.map((button, index) => ({ id: `composer:${index}` as const, button })),
      { id: 'thinking' as const },
      ...(supportsFastMode ? [{ id: 'fastMode' as const }] : []),
    ],
    [composerButtons, supportsFastMode],
  );
  const inlineItemIds = new Set(preferenceItems.slice(0, inlineLimit).map((item) => item.id));
  const menuItems = preferenceItems.filter((item) => !inlineItemIds.has(item.id));
  const hasMenuItems = menuItems.length > 0;

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

  function renderInlineItem(item: (typeof preferenceItems)[number]) {
    if (item.id === 'model') {
      return (
        <ConversationModelSelect
          key="model"
          groupedModels={groupedModels}
          currentModel={currentModel}
          disabled={savingPreference !== null || models.length === 0}
          onChange={onSelectModel}
        />
      );
    }
    if (item.id === 'thinking') {
      return (
        <ConversationThinkingLevelSelect
          key="thinking"
          value={currentThinkingLevel}
          disabled={savingPreference !== null}
          model={selectedModel}
          onChange={onSelectThinkingLevel}
        />
      );
    }
    if (item.id === 'fastMode') {
      return (
        <ConversationPreferenceToggle
          key="fastMode"
          label="Fast mode"
          enabled={fastModeEnabled}
          disabled={savingPreference !== null}
          tone="accent"
          title={fastModeEnabled ? 'Disable fast mode' : 'Enable fast mode'}
          layout="inline"
          onToggle={() => onSelectServiceTier(!fastModeEnabled)}
        />
      );
    }
    if ('button' in item) {
      return (
        <ComposerButtonHost
          key={`${item.button.extensionId}:${item.button.id}`}
          registration={item.button}
          buttonContext={{ ...composerButtonContext, renderMode: 'inline' }}
        />
      );
    }
    return null;
  }

  function renderMenuItem(item: (typeof preferenceItems)[number]) {
    if (item.id === 'model') {
      return (
        <div key="model">
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
      );
    }
    if (item.id === 'thinking') {
      return (
        <div key="thinking">
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
      );
    }
    if (item.id === 'fastMode') {
      return (
        <ConversationPreferenceToggle
          key="fastMode"
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
      );
    }
    if ('button' in item) {
      return (
        <ComposerButtonHost
          key={`${item.button.extensionId}:${item.button.id}`}
          registration={item.button}
          buttonContext={{ ...composerButtonContext, renderMode: 'menu' }}
        />
      );
    }
    return null;
  }

  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2">
      {preferenceItems.filter((item) => inlineItemIds.has(item.id)).map(renderInlineItem)}

      {hasMenuItems && (
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
            title="More composer settings"
          >
            <MoreHorizontalIcon />
          </IconButton>
          {menuOpen && (
            <div
              className="ui-context-menu-shell absolute bottom-full left-0 z-50 mb-2 w-[15rem] p-2.5"
              role="dialog"
              aria-label="Composer settings"
            >
              <div className="flex flex-col gap-2">{menuItems.map(renderMenuItem)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

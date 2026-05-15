import type { ComposerControlContext } from '@personal-agent/extensions/composer';
import { cx } from '@personal-agent/extensions/ui';

const SELECT_CLASS =
  'h-8 min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 pr-6 text-[11px] font-medium text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:border-border-subtle focus-visible:bg-surface/55 focus-visible:text-primary focus-visible:ring-1 focus-visible:ring-accent/20 disabled:cursor-default disabled:opacity-40';

type Model = ComposerControlContext['models'][number];

function groupModels(models: Model[]): Array<[string, Model[]]> {
  const groups = new Map<string, Model[]>();
  for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  return [...groups.entries()];
}

function thinkingOptions(model: Model | null): Array<{ value: string; label: string }> {
  const all = [
    { value: '', label: 'Unset' },
    { value: 'off', label: 'Off' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
  ];
  return model?.reasoning ? all : all.filter((option) => option.value === '' || option.value === 'off');
}

function ModelSelect({ context, variant }: { context: ComposerControlContext; variant: 'inline' | 'menu' }) {
  const className =
    variant === 'menu'
      ? 'h-9 w-full min-w-0 appearance-none rounded-lg border border-border-subtle bg-surface/45 px-2.5 pr-7 text-[12px] font-medium text-primary outline-none transition-colors hover:bg-surface/65 focus-visible:border-accent/50 focus-visible:bg-surface/65 disabled:cursor-default disabled:opacity-40'
      : cx(SELECT_CLASS, 'max-w-[11.5rem] min-w-[8.25rem] appearance-none');
  return (
    <label className={variant === 'menu' ? 'relative flex min-w-0 items-center' : 'relative inline-flex min-w-0 items-center'}>
      <span className="sr-only">Conversation model</span>
      <select
        value={context.currentModel}
        onChange={(event) => context.selectModel(event.target.value)}
        disabled={context.savingPreference !== null || context.models.length === 0}
        className={className}
        aria-label="Conversation model"
      >
        {groupModels(context.models).map(([provider, providerModels]) => (
          <optgroup key={provider} label={provider}>
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Chevron />
    </label>
  );
}

function ThinkingSelect({ context, variant }: { context: ComposerControlContext; variant: 'inline' | 'menu' }) {
  const model = context.models.find((candidate) => candidate.id === context.currentModel) ?? null;
  const className =
    variant === 'menu'
      ? 'h-9 w-full min-w-0 appearance-none rounded-lg border border-border-subtle bg-surface/45 px-2.5 pr-7 text-[12px] font-medium text-primary outline-none transition-colors hover:bg-surface/65 focus-visible:border-accent/50 focus-visible:bg-surface/65 disabled:cursor-default disabled:opacity-40'
      : cx(SELECT_CLASS, 'max-w-[6.5rem] min-w-[5.75rem] appearance-none');
  return (
    <label className={variant === 'menu' ? 'relative flex min-w-0 items-center' : 'relative inline-flex min-w-0 items-center'}>
      <span className="sr-only">Conversation thinking level</span>
      <select
        value={context.currentThinkingLevel}
        onChange={(event) => context.selectThinkingLevel(event.target.value)}
        disabled={context.savingPreference !== null}
        className={className}
        aria-label="Conversation thinking level"
      >
        {thinkingOptions(model).map((option) => (
          <option key={option.value || 'unset'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Chevron />
    </label>
  );
}

function Chevron() {
  return (
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
  );
}

function FastToggle({ context, variant }: { context: ComposerControlContext; variant: 'inline' | 'menu' }) {
  const model = context.models.find((candidate) => candidate.id === context.currentModel) ?? null;
  const supportsFast = Array.isArray(model?.supportedServiceTiers) && model.supportedServiceTiers.includes('priority');
  const enabled = context.currentServiceTier === 'priority';
  if (!supportsFast) return null;
  const className =
    variant === 'menu'
      ? 'group inline-flex w-full items-center justify-between rounded-lg border border-border-subtle bg-surface/45 px-2.5 py-2 text-[11px] font-medium text-secondary transition-colors hover:bg-surface/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40'
      : 'group inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-[11px] font-medium text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? 'Disable fast mode' : 'Enable fast mode'}
      title={enabled ? 'Disable fast mode' : 'Enable fast mode'}
      onClick={() => context.selectServiceTier(!enabled)}
      disabled={context.savingPreference !== null}
      className={className}
    >
      {variant === 'menu' ? <span className={cx('leading-none', enabled && 'text-primary')}>Fast</span> : null}
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border p-[1px] transition-all',
          enabled
            ? 'border-accent/55 bg-accent/75 shadow-[0_0_8px_rgba(168,85,247,0.16)]'
            : 'border-border-default bg-surface/40 group-hover:bg-surface/60',
        )}
      >
        <span
          className={cx(
            'h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[14px]' : 'translate-x-0',
          )}
        />
      </span>
      {variant === 'inline' ? <span className={cx('leading-none', enabled && 'text-primary')}>Fast</span> : null}
    </button>
  );
}

export function ModelPreferencesComposerControl({
  controlContext,
  buttonContext,
}: {
  controlContext?: ComposerControlContext;
  buttonContext: ComposerControlContext;
}) {
  const context = controlContext ?? buttonContext;
  const variant = context.renderMode;
  if (variant === 'menu') {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Model</p>
          <ModelSelect context={context} variant="menu" />
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Thinking</p>
          <ThinkingSelect context={context} variant="menu" />
        </div>
        <FastToggle context={context} variant="menu" />
      </div>
    );
  }
  return (
    <>
      <ModelSelect context={context} variant="inline" />
      <ThinkingSelect context={context} variant="inline" />
      <FastToggle context={context} variant="inline" />
    </>
  );
}

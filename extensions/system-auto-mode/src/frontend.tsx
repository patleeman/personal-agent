import type { ComposerButtonContext } from '@personal-agent/extensions/composer';
import { cx } from '@personal-agent/extensions/ui';

export function GoalModeComposerButton({ buttonContext }: { buttonContext: ComposerButtonContext }) {
  const enabled = buttonContext.goalEnabled;
  const layout = buttonContext.renderMode;
  const title = enabled ? 'Disable goal mode' : 'Enable goal mode';
  const buttonClassName =
    layout === 'menu'
      ? 'group inline-flex w-full items-center justify-between rounded-lg border border-border-subtle bg-surface/45 px-2.5 py-2 text-[11px] font-medium text-secondary transition-colors hover:bg-surface/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40'
      : 'group inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-[11px] font-medium text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={title}
      title={title}
      onClick={buttonContext.toggleGoal}
      disabled={buttonContext.composerDisabled}
      className={buttonClassName}
    >
      {layout === 'menu' ? <span className={cx('leading-none', enabled && 'text-primary')}>Goal mode</span> : null}
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
      {layout === 'inline' ? <span className={cx('leading-none', enabled && 'text-primary')}>Goal</span> : null}
    </button>
  );
}

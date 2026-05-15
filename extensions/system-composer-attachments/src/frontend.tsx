import type { ComposerControlContext } from '@personal-agent/extensions/composer';

export function AttachFilesComposerControl({
  controlContext,
  buttonContext,
}: {
  controlContext?: ComposerControlContext;
  buttonContext: ComposerControlContext;
}) {
  const context = controlContext ?? buttonContext;
  return (
    <button
      type="button"
      onClick={context.openFilePicker}
      disabled={context.composerDisabled}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
      title="Attach image or file"
      aria-label="Attach image or file"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    </button>
  );
}

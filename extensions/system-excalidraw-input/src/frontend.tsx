import { type NativeExtensionClient } from '@personal-agent/extensions';
import { lazy, Suspense } from 'react';

import type { ExcalidrawEditorSavePayload } from './editorModal';

const LazyExcalidrawEditorModal = lazy(async () => {
  const module = await import('./editorModal');
  return { default: module.ExcalidrawEditorModal };
});

function PencilIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function ExcalidrawInputTool({
  pa,
  toolContext,
}: {
  pa: NativeExtensionClient;
  toolContext: {
    composerDisabled: boolean;
    streamIsStreaming: boolean;
    upsertDrawingAttachment: (payload: ExcalidrawEditorSavePayload) => void;
  };
}) {
  return (
    <button
      type="button"
      onClick={async () => {
        const result = await pa.ui.openModal({
          component: 'ExcalidrawEditorModal',
          props: { saveLabel: 'Save drawing' },
          size: 'fullscreen',
        });
        if (result && typeof result === 'object') {
          toolContext.upsertDrawingAttachment(result as ExcalidrawEditorSavePayload);
          pa.ui.toast('Drawing saved to composer.');
        }
      }}
      disabled={toolContext.composerDisabled}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
      title="Create drawing"
      aria-label="Create drawing"
    >
      <PencilIcon />
    </button>
  );
}

export function ExcalidrawEditorModal(props: Parameters<typeof LazyExcalidrawEditorModal>[0]) {
  return (
    <Suspense
      fallback={<div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-dim">Loading Excalidraw…</div>}
    >
      <LazyExcalidrawEditorModal {...props} />
    </Suspense>
  );
}

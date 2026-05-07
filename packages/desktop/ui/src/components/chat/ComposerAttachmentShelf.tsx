import { useCallback, useEffect, useState } from 'react';

interface ComposerAttachmentShelfDrawingAttachment {
  localId: string;
  title: string;
  attachmentId?: string;
  revision?: number;
  dirty: boolean;
  previewUrl: string;
}

interface ComposerPreviewImage {
  alt: string;
  src: string;
  label: string;
  dispose?: () => void;
}

interface ComposerAttachmentShelfProps {
  attachments: File[];
  drawingAttachments: ComposerAttachmentShelfDrawingAttachment[];
  drawingsBusy?: boolean;
  drawingsError?: string | null;
  onRemoveAttachment: (index: number) => void;
  onEditDrawing: (localId: string) => void;
  onRemoveDrawingAttachment: (localId: string) => void;
}

const FILE_ICONS: Record<string, string> = {
  'image/': '🖼',
  'text/': '📄',
  'application/json': '{ }',
  'application/pdf': '📕',
  'video/': '🎬',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes}B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fileIcon(type: string) {
  return Object.entries(FILE_ICONS).find(([prefix]) => type.startsWith(prefix))?.[1] ?? '📎';
}

function buildDrawingPreviewTitle(attachment: ComposerAttachmentShelfDrawingAttachment): string {
  const revisionText = attachment.revision ? ` (rev ${attachment.revision})` : '';
  return `${attachment.title}${revisionText}`;
}

function ComposerImagePreviewModal({ image, onClose }: { image: ComposerPreviewImage; onClose: () => void }) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.72)', backdropFilter: 'blur(2px)', paddingTop: '1rem' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={image.label}
        className="ui-dialog-shell relative"
        style={{
          width: 'min(96vw, 1440px)',
          height: 'min(94vh, 1040px)',
          maxHeight: 'calc(100vh - 2rem)',
          background: 'rgb(10 13 20 / 0.96)',
        }}
      >
        <div className="relative min-h-0 flex-1 bg-black/30 px-4 py-4 sm:px-6 sm:py-6">
          <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-3 sm:inset-x-6 sm:top-6">
            <div className="pointer-events-auto min-w-0 rounded-lg bg-black/45 px-3 py-1.5 backdrop-blur-sm" title={image.label}>
              <p className="truncate text-[12px] font-medium text-white/95">{image.label}</p>
              {dimensions ? (
                <p className="mt-0.5 text-[10px] text-white/60">
                  {dimensions.width}×{dimensions.height}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close image preview"
              className="pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/45 text-[16px] leading-none text-white/80 transition-colors hover:bg-black/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              ×
            </button>
          </div>
          <img
            src={image.src}
            alt={image.alt}
            className="h-full w-full object-contain"
            onLoad={(event) => {
              const nextDimensions = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              };
              setDimensions((current) =>
                current?.width === nextDimensions.width && current?.height === nextDimensions.height ? current : nextDimensions,
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function ComposerAttachmentShelf({
  attachments,
  drawingAttachments,
  drawingsBusy = false,
  drawingsError = null,
  onRemoveAttachment,
  onEditDrawing,
  onRemoveDrawingAttachment,
}: ComposerAttachmentShelfProps) {
  const [previewImage, setPreviewImage] = useState<ComposerPreviewImage | null>(null);

  useEffect(
    () => () => {
      previewImage?.dispose?.();
    },
    [previewImage],
  );

  const closePreview = useCallback(() => {
    setPreviewImage(null);
  }, []);

  const openAttachmentPreview = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      return;
    }

    const src = URL.createObjectURL(file);
    setPreviewImage({
      alt: file.name,
      src,
      label: file.name,
      dispose: () => {
        URL.revokeObjectURL(src);
      },
    });
  }, []);

  const openDrawingPreview = useCallback((attachment: ComposerAttachmentShelfDrawingAttachment) => {
    const label = buildDrawingPreviewTitle(attachment);
    setPreviewImage({
      alt: label,
      src: attachment.previewUrl,
      label,
    });
  }, []);

  return (
    <>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 py-2">
          {attachments.map((file, index) => {
            const canPreview = file.type.startsWith('image/');
            const summary = (
              <>
                <span className="shrink-0">{fileIcon(file.type)}</span>
                <span className="truncate text-secondary">{file.name}</span>
                <span className="shrink-0 text-dim">{formatBytes(file.size)}</span>
              </>
            );

            return (
              <div
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className="flex max-w-[220px] items-center gap-1 rounded-lg border border-border-subtle bg-elevated text-[11px]"
              >
                {canPreview ? (
                  <button
                    type="button"
                    onClick={() => openAttachmentPreview(file)}
                    className="flex min-w-0 flex-1 cursor-zoom-in items-center gap-1.5 rounded-l-[inherit] px-2 py-1 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
                    title={`Preview ${file.name}`}
                    aria-label={`Preview ${file.name}`}
                  >
                    {summary}
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1">{summary}</div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(index)}
                  className="ui-icon-button ui-icon-button-compact mr-1 shrink-0 leading-none"
                  title={`Remove ${file.name}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {drawingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-2">
          {drawingAttachments.map((attachment) => {
            const label = buildDrawingPreviewTitle(attachment);
            return (
              <div
                key={attachment.localId}
                className="flex max-w-[270px] items-center gap-1.5 rounded-lg border border-border-subtle bg-elevated px-1 py-1 text-[11px]"
              >
                <button
                  type="button"
                  onClick={() => openDrawingPreview(attachment)}
                  className="flex min-w-0 flex-1 cursor-zoom-in items-center gap-1.5 rounded-md px-1 text-left transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
                  title={`Preview ${label}`}
                  aria-label={`Preview ${label}`}
                >
                  <img src={attachment.previewUrl} alt={label} className="h-7 w-9 rounded object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-secondary">{label}</p>
                    <p className="text-[10px] text-dim">
                      {attachment.attachmentId ? `#${attachment.attachmentId}` : 'new drawing'}
                      {attachment.dirty ? ' · unsaved' : ''}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onEditDrawing(attachment.localId)}
                  className="text-[11px] text-accent transition-colors hover:text-accent/80"
                  title={`Edit ${attachment.title}`}
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveDrawingAttachment(attachment.localId)}
                  className="ui-icon-button ui-icon-button-compact ml-0.5 shrink-0 leading-none"
                  title={`Remove ${attachment.title}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {drawingsBusy && <div className="px-1 pt-2 text-[11px] text-dim">Syncing drawings…</div>}

      {drawingsError && <div className="px-1 pt-2 text-[11px] text-danger">{drawingsError}</div>}

      {previewImage ? <ComposerImagePreviewModal image={previewImage} onClose={closePreview} /> : null}
    </>
  );
}

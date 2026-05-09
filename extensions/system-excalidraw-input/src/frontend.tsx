import '@excalidraw/excalidraw/index.css';

import { type NativeExtensionClient } from '@personal-agent/extensions';
import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';

const EXCALIDRAW_SOURCE_MIME_TYPE = 'application/vnd.excalidraw+json';
const EXCALIDRAW_PREVIEW_MIME_TYPE = 'image/png';
const DEFAULT_PREVIEW_BACKGROUND = '#ffffff';
const DEFAULT_PREVIEW_EXPORT_PADDING = 16;
const MIN_PREVIEW_LONG_SIDE = 900;
const MAX_PREVIEW_LONG_SIDE = 1600;
const MAX_PERSISTED_CANVAS_DIMENSION = 16_000;
const PREVIEW_FRAME_INSET_RATIO = 0.08;
const MIN_PREVIEW_FRAME_INSET = 40;

type ExcalidrawElements = Parameters<typeof import('@excalidraw/excalidraw').serializeAsJSON>[0];
type ExcalidrawAppState = Parameters<typeof import('@excalidraw/excalidraw').serializeAsJSON>[1];
type ExcalidrawFiles = Parameters<typeof import('@excalidraw/excalidraw').serializeAsJSON>[2];
type ExcalidrawComponent = typeof import('@excalidraw/excalidraw').Excalidraw;

interface ExcalidrawSceneData {
  elements: ExcalidrawElements;
  appState: ExcalidrawAppState;
  files: ExcalidrawFiles;
}

interface ExcalidrawEditorSavePayload {
  title: string;
  scene: ExcalidrawSceneData;
  sourceData: string;
  sourceMimeType: string;
  sourceName: string;
  previewData: string;
  previewMimeType: string;
  previewName: string;
  previewUrl: string;
}

type ExcalidrawModule = Pick<typeof import('@excalidraw/excalidraw'), 'Excalidraw' | 'serializeAsJSON' | 'exportToBlob'>;

let excalidrawModulePromise: Promise<ExcalidrawModule> | null = null;

async function loadExcalidrawModule(): Promise<ExcalidrawModule> {
  const modulePromise =
    excalidrawModulePromise ??
    import('@excalidraw/excalidraw').then((module) => ({
      Excalidraw: module.Excalidraw,
      serializeAsJSON: module.serializeAsJSON,
      exportToBlob: module.exportToBlob,
    }));

  excalidrawModulePromise = modulePromise;
  return modulePromise;
}

function encodeUtf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_PERSISTED_CANVAS_DIMENSION ? value : null;
}

function resolvePreviewBackgroundColor(appState: ExcalidrawAppState): string {
  const value = (appState as { viewBackgroundColor?: unknown }).viewBackgroundColor;
  return typeof value === 'string' && value.trim().length > 0 ? value : DEFAULT_PREVIEW_BACKGROUND;
}

function resolvePreviewFrameSize(appState: ExcalidrawAppState | null | undefined): { width: number; height: number } | null {
  if (!appState || typeof appState !== 'object') return null;

  const width = positiveFiniteNumber((appState as { width?: unknown }).width);
  const height = positiveFiniteNumber((appState as { height?: unknown }).height);
  if (!width || !height) return null;

  const longSide = Math.max(width, height);
  const scale =
    longSide > MAX_PREVIEW_LONG_SIDE
      ? MAX_PREVIEW_LONG_SIDE / longSide
      : longSide < MIN_PREVIEW_LONG_SIDE
        ? MIN_PREVIEW_LONG_SIDE / longSide
        : 1;

  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob.'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read blob as data URL.'));
    };
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to convert canvas to blob.'));
    }, mimeType);
  });
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load preview image.'));
    };
    image.src = objectUrl;
  });
}

async function framePreviewBlob(blob: Blob, scene: ExcalidrawSceneData): Promise<Blob> {
  const frameSize = resolvePreviewFrameSize(scene.appState);
  if (!frameSize) return blob;

  const image = await loadImageFromBlob(blob);
  const imageWidth = positiveFiniteNumber(image.naturalWidth);
  const imageHeight = positiveFiniteNumber(image.naturalHeight);
  if (!imageWidth || !imageHeight) return blob;

  const canvas = document.createElement('canvas');
  canvas.width = frameSize.width;
  canvas.height = frameSize.height;

  const context = canvas.getContext('2d');
  if (!context) return blob;

  context.fillStyle = resolvePreviewBackgroundColor(scene.appState);
  context.fillRect(0, 0, canvas.width, canvas.height);

  const inset = Math.max(MIN_PREVIEW_FRAME_INSET, Math.round(Math.min(canvas.width, canvas.height) * PREVIEW_FRAME_INSET_RATIO));
  const availableWidth = Math.max(1, canvas.width - inset * 2);
  const availableHeight = Math.max(1, canvas.height - inset * 2);
  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  const drawWidth = Math.max(1, Math.round(imageWidth * scale));
  const drawHeight = Math.max(1, Math.round(imageHeight * scale));
  const drawX = Math.round((canvas.width - drawWidth) / 2);
  const drawY = Math.round((canvas.height - drawHeight) / 2);

  context.imageSmoothingEnabled = true;
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  return canvasToBlob(canvas, EXCALIDRAW_PREVIEW_MIME_TYPE);
}

function buildDrawingFileNames(title: string): { sourceName: string; previewName: string } {
  const normalized = title
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = normalized.length > 0 ? normalized : 'drawing';
  return { sourceName: `${base}.excalidraw`, previewName: `${base}.png` };
}

async function serializeExcalidrawScene(scene: ExcalidrawSceneData): Promise<{
  sourceData: string;
  sourceMimeType: string;
  previewData: string;
  previewMimeType: string;
  previewUrl: string;
}> {
  const excalidraw = await loadExcalidrawModule();
  const serialized = excalidraw.serializeAsJSON(scene.elements, scene.appState, scene.files, 'local');
  const exportedBlob = await excalidraw.exportToBlob({
    elements: scene.elements,
    appState: { ...scene.appState, exportBackground: true },
    files: scene.files,
    mimeType: EXCALIDRAW_PREVIEW_MIME_TYPE,
    exportPadding: DEFAULT_PREVIEW_EXPORT_PADDING,
  });
  const previewBlob = await framePreviewBlob(exportedBlob, scene);
  const previewUrl = await blobToDataUrl(previewBlob);

  return {
    sourceData: encodeUtf8ToBase64(serialized),
    sourceMimeType: EXCALIDRAW_SOURCE_MIME_TYPE,
    previewData: dataUrlToBase64(previewUrl),
    previewMimeType: EXCALIDRAW_PREVIEW_MIME_TYPE,
    previewUrl,
  };
}

const EMPTY_SCENE: ExcalidrawSceneData = { elements: [], appState: {}, files: {} } as ExcalidrawSceneData;
const EMBEDDED_UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    saveAsImage: false,
    toggleTheme: false,
  },
} as const;

interface ExcalidrawErrorBoundaryState {
  error: Error | null;
}

class ExcalidrawErrorBoundary extends Component<{ children: ReactNode }, ExcalidrawErrorBoundaryState> {
  state: ExcalidrawErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ExcalidrawErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Excalidraw failed to render:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-danger">
          Failed to load Excalidraw: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function getExcalidrawTheme(): 'dark' | 'light' {
  if (document.documentElement.classList.contains('dark')) return 'dark';
  if (document.documentElement.dataset.theme === 'dark') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

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
      disabled={toolContext.composerDisabled || toolContext.streamIsStreaming}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
      title="Create drawing"
      aria-label="Create drawing"
    >
      <PencilIcon />
    </button>
  );
}

export function ExcalidrawEditorModal({
  props,
  close,
}: {
  pa: NativeExtensionClient;
  props: { initialTitle?: string; initialScene?: ExcalidrawSceneData | null; saveLabel?: string };
  close: (result?: unknown) => void;
}) {
  const [title, setTitle] = useState(props.initialTitle ?? 'Drawing');
  const [saving, setSaving] = useState(false);
  const [LoadedExcalidraw, setLoadedExcalidraw] = useState<ExcalidrawComponent | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const sceneRef = useRef<ExcalidrawSceneData>(props.initialScene ?? EMPTY_SCENE);
  const excalidrawTheme = getExcalidrawTheme();

  useEffect(() => {
    let cancelled = false;
    void loadExcalidrawModule()
      .then((module) => {
        if (cancelled) return;
        setLoadedExcalidraw(() => module.Excalidraw);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error : new Error('Failed to load Excalidraw.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (!LoadedExcalidraw || loadError) return;
    const normalizedTitle = title.trim() || 'Drawing';
    setSaving(true);
    try {
      const scene = sceneRef.current;
      const serialized = await serializeExcalidrawScene(scene);
      const fileNames = buildDrawingFileNames(normalizedTitle);
      close({
        title: normalizedTitle,
        scene,
        sourceData: serialized.sourceData,
        sourceMimeType: serialized.sourceMimeType,
        sourceName: fileNames.sourceName,
        previewData: serialized.previewData,
        previewMimeType: serialized.previewMimeType,
        previewName: fileNames.previewName,
        previewUrl: serialized.previewUrl,
      } satisfies ExcalidrawEditorSavePayload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <input
          aria-label="Drawing title"
          name="drawingTitle"
          autoComplete="off"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-[13px] text-primary outline-none transition-colors focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/20"
          placeholder="Drawing title"
          disabled={saving}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => close()} className="ui-toolbar-button px-2 py-1 text-[10px]" disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            className="ui-pill ui-pill-solid-accent whitespace-nowrap px-2.5 py-1 text-[11px]"
            disabled={saving || !LoadedExcalidraw || loadError !== null}
          >
            {saving ? 'Saving…' : (props.saveLabel ?? 'Save drawing')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loadError ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-danger">
            Failed to load Excalidraw: {loadError.message}
          </div>
        ) : LoadedExcalidraw ? (
          <ExcalidrawErrorBoundary>
            <div className="excalidraw-embed-lite h-full w-full">
              <LoadedExcalidraw
                theme={excalidrawTheme}
                UIOptions={EMBEDDED_UI_OPTIONS}
                renderTopRightUI={() => null}
                initialData={
                  props.initialScene
                    ? {
                        elements: [...props.initialScene.elements],
                        appState: { ...props.initialScene.appState, theme: excalidrawTheme, openMenu: null, openSidebar: null },
                        files: props.initialScene.files,
                      }
                    : { appState: { theme: excalidrawTheme, openMenu: null, openSidebar: null } }
                }
                onChange={(elements, appState, files) => {
                  sceneRef.current = { elements: [...elements], appState: { ...appState }, files: { ...files } };
                }}
              />
            </div>
          </ExcalidrawErrorBoundary>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-dim">Loading Excalidraw…</div>
        )}
      </div>
    </div>
  );
}

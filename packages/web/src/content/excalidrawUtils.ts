export const EXCALIDRAW_SOURCE_MIME_TYPE = 'application/vnd.excalidraw+json';
export const EXCALIDRAW_PREVIEW_MIME_TYPE = 'image/png';

const DEFAULT_PREVIEW_BACKGROUND = '#ffffff';
const DEFAULT_PREVIEW_EXPORT_PADDING = 16;
const MIN_PREVIEW_LONG_SIDE = 900;
const MAX_PREVIEW_LONG_SIDE = 1600;
const PREVIEW_FRAME_INSET_RATIO = 0.08;
const MIN_PREVIEW_FRAME_INSET = 40;

type ExcalidrawElements = Parameters<typeof import('@excalidraw/excalidraw').serializeAsJSON>[0];
type ExcalidrawAppState = Parameters<typeof import('@excalidraw/excalidraw').serializeAsJSON>[1];
type ExcalidrawFiles = Parameters<typeof import('@excalidraw/excalidraw').serializeAsJSON>[2];

export interface ExcalidrawSceneData {
  elements: ExcalidrawElements;
  appState: ExcalidrawAppState;
  files: ExcalidrawFiles;
}

export interface SerializedExcalidrawScene {
  sourceData: string;
  sourceMimeType: string;
  previewData: string;
  previewMimeType: string;
  previewUrl: string;
}

export interface ExcalidrawPreviewFrameSize {
  width: number;
  height: number;
}

type ExcalidrawModule = Pick<typeof import('@excalidraw/excalidraw'), 'loadFromBlob' | 'serializeAsJSON' | 'exportToBlob'>;

let excalidrawModulePromise: Promise<ExcalidrawModule> | null = null;

async function loadExcalidrawModule(): Promise<ExcalidrawModule> {
  const modulePromise = excalidrawModulePromise ?? import('@excalidraw/excalidraw').then((module) => ({
    loadFromBlob: module.loadFromBlob,
    serializeAsJSON: module.serializeAsJSON,
    exportToBlob: module.exportToBlob,
  }));

  excalidrawModulePromise = modulePromise;
  return modulePromise;
}

function normalizeSceneData(value: unknown): ExcalidrawSceneData {
  if (!value || typeof value !== 'object') {
    return {
      elements: [],
      appState: {},
      files: {},
    } as ExcalidrawSceneData;
  }

  const parsed = value as Partial<ExcalidrawSceneData>;

  return {
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState: parsed.appState && typeof parsed.appState === 'object' && !Array.isArray(parsed.appState)
      ? parsed.appState
      : {},
    files: parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)
      ? parsed.files
      : {},
  } as ExcalidrawSceneData;
}

function encodeUtf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary);
}

function decodeBase64ToUtf8(value: string): string {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read blob as data URL.'));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function resolvePreviewBackgroundColor(appState: ExcalidrawAppState): string {
  const value = (appState as { viewBackgroundColor?: unknown }).viewBackgroundColor;
  return typeof value === 'string' && value.trim().length > 0 ? value : DEFAULT_PREVIEW_BACKGROUND;
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to convert canvas to blob.'));
        return;
      }

      resolve(blob);
    }, mimeType);
  });
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
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

export function resolveExcalidrawPreviewFrameSize(appState: ExcalidrawAppState | null | undefined): ExcalidrawPreviewFrameSize | null {
  if (!appState || typeof appState !== 'object') {
    return null;
  }

  const width = positiveFiniteNumber((appState as { width?: unknown }).width);
  const height = positiveFiniteNumber((appState as { height?: unknown }).height);

  if (!width || !height) {
    return null;
  }

  const longSide = Math.max(width, height);
  const scale = longSide > MAX_PREVIEW_LONG_SIDE
    ? MAX_PREVIEW_LONG_SIDE / longSide
    : longSide < MIN_PREVIEW_LONG_SIDE
      ? MIN_PREVIEW_LONG_SIDE / longSide
      : 1;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function framePreviewBlob(blob: Blob, scene: ExcalidrawSceneData): Promise<Blob> {
  const frameSize = resolveExcalidrawPreviewFrameSize(scene.appState);
  if (!frameSize) {
    return blob;
  }

  const image = await loadImageFromBlob(blob);
  const imageWidth = positiveFiniteNumber(image.naturalWidth);
  const imageHeight = positiveFiniteNumber(image.naturalHeight);

  if (!imageWidth || !imageHeight) {
    return blob;
  }

  const canvas = document.createElement('canvas');
  canvas.width = frameSize.width;
  canvas.height = frameSize.height;

  const context = canvas.getContext('2d');
  if (!context) {
    return blob;
  }

  context.fillStyle = resolvePreviewBackgroundColor(scene.appState);
  context.fillRect(0, 0, canvas.width, canvas.height);

  const inset = Math.max(
    MIN_PREVIEW_FRAME_INSET,
    Math.round(Math.min(canvas.width, canvas.height) * PREVIEW_FRAME_INSET_RATIO),
  );
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

export function buildDrawingFileNames(title: string): { sourceName: string; previewName: string } {
  const normalized = title.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const base = normalized.length > 0 ? normalized : 'drawing';

  return {
    sourceName: `${base}.excalidraw`,
    previewName: `${base}.png`,
  };
}

export function inferDrawingTitleFromFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Drawing';
  }

  const extensionIndex = trimmed.lastIndexOf('.');
  if (extensionIndex <= 0) {
    return trimmed;
  }

  return trimmed.slice(0, extensionIndex);
}

export async function loadExcalidrawSceneFromBlob(blob: Blob): Promise<ExcalidrawSceneData> {
  const excalidraw = await loadExcalidrawModule();
  const restored = await excalidraw.loadFromBlob(blob, null, null);
  return normalizeSceneData(restored);
}

function parseExcalidrawSourcePayload(sourceData: string): unknown {
  const normalized = sourceData.trim();
  if (!normalized) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64ToUtf8(normalized)) as unknown;
  } catch {
    return JSON.parse(normalized) as unknown;
  }
}

export function parseExcalidrawSceneFromSourceData(sourceData: string): ExcalidrawSceneData {
  const parsed = parseExcalidrawSourcePayload(sourceData);
  return normalizeSceneData(parsed);
}

export async function serializeExcalidrawScene(scene: ExcalidrawSceneData): Promise<SerializedExcalidrawScene> {
  const excalidraw = await loadExcalidrawModule();

  const sourceJson = excalidraw.serializeAsJSON(
    scene.elements,
    scene.appState,
    scene.files,
    'local',
  );

  const croppedPreviewBlob = await excalidraw.exportToBlob({
    elements: scene.elements,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportWithDarkMode: false,
      exportEmbedScene: false,
    },
    files: scene.files,
    mimeType: EXCALIDRAW_PREVIEW_MIME_TYPE,
    exportPadding: DEFAULT_PREVIEW_EXPORT_PADDING,
  });

  const previewBlob = await framePreviewBlob(croppedPreviewBlob, scene).catch(() => croppedPreviewBlob);
  const previewUrl = await blobToDataUrl(previewBlob);
  const previewCommaIndex = previewUrl.indexOf(',');

  return {
    sourceData: encodeUtf8ToBase64(sourceJson),
    sourceMimeType: EXCALIDRAW_SOURCE_MIME_TYPE,
    previewData: previewCommaIndex >= 0 ? previewUrl.slice(previewCommaIndex + 1) : previewUrl,
    previewMimeType: EXCALIDRAW_PREVIEW_MIME_TYPE,
    previewUrl,
  };
}

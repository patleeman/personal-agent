export const EXCALIDRAW_SOURCE_MIME_TYPE = 'application/vnd.excalidraw+json';
export const EXCALIDRAW_PREVIEW_MIME_TYPE = 'image/png';

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

  const previewBlob = await excalidraw.exportToBlob({
    elements: scene.elements,
    appState: {
      ...scene.appState,
      exportBackground: true,
      exportWithDarkMode: false,
      exportEmbedScene: false,
    },
    files: scene.files,
    mimeType: EXCALIDRAW_PREVIEW_MIME_TYPE,
    exportPadding: 16,
  });

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

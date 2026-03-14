export const EXCALIDRAW_SOURCE_MIME_TYPE = 'application/vnd.excalidraw+json';
export const EXCALIDRAW_PREVIEW_MIME_TYPE = 'image/png';

export interface ExcalidrawSceneData {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface SerializedExcalidrawScene {
  sourceData: string;
  sourceMimeType: string;
  previewData: string;
  previewMimeType: string;
  previewUrl: string;
}

interface ExcalidrawModule {
  loadFromBlob: (
    blob: Blob,
    localAppState: Record<string, unknown> | null,
    localElements: readonly unknown[] | null,
  ) => Promise<unknown>;
  serializeAsJSON: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
    type: 'local' | 'database',
  ) => string;
  exportToBlob: (input: {
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
    mimeType?: string;
    exportPadding?: number;
  }) => Promise<Blob>;
}

let excalidrawModulePromise: Promise<ExcalidrawModule> | null = null;

async function loadExcalidrawModule(): Promise<ExcalidrawModule> {
  if (!excalidrawModulePromise) {
    excalidrawModulePromise = import('@excalidraw/excalidraw').then((module) => ({
      loadFromBlob: module.loadFromBlob,
      serializeAsJSON: module.serializeAsJSON,
      exportToBlob: module.exportToBlob,
    }));
  }

  return excalidrawModulePromise;
}

function normalizeSceneData(value: unknown): ExcalidrawSceneData {
  if (!value || typeof value !== 'object') {
    return {
      elements: [],
      appState: {},
      files: {},
    };
  }

  const parsed = value as {
    elements?: unknown;
    appState?: unknown;
    files?: unknown;
  };

  return {
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState: parsed.appState && typeof parsed.appState === 'object' && !Array.isArray(parsed.appState)
      ? parsed.appState as Record<string, unknown>
      : {},
    files: parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)
      ? parsed.files as Record<string, unknown>
      : {},
  };
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

import excalidrawCss from '@excalidraw/excalidraw/index.css?raw';
import { type NativeExtensionClient } from '@personal-agent/extensions';
import {
  buildDrawingFileNames,
  type ExcalidrawComponent,
  type ExcalidrawSceneData,
  loadExcalidrawComponent,
  serializeExcalidrawScene,
} from '@personal-agent/extensions/excalidraw';
import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';

export interface ExcalidrawEditorSavePayload {
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

const EMPTY_SCENE: ExcalidrawSceneData = { elements: [], appState: {}, files: {} } as ExcalidrawSceneData;
const EXCALIDRAW_STYLE_ID = 'pa-system-excalidraw-input-styles';
const EXCALIDRAW_CSS_WITHOUT_FONT_URLS = excalidrawCss.replace(/@font-face\{font-family:Assistant;[^}]*\}/g, '');
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
    window.dispatchEvent(
      new CustomEvent('pa-notification', {
        detail: {
          type: 'error',
          message: 'Drawing editor crashed',
          details: error instanceof Error ? error.message : String(error),
          source: 'system-excalidraw-input',
        },
      }),
    );
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

function ensureExcalidrawStyles() {
  if (document.getElementById(EXCALIDRAW_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EXCALIDRAW_STYLE_ID;
  style.textContent = EXCALIDRAW_CSS_WITHOUT_FONT_URLS;
  document.head.appendChild(style);
}

function getExcalidrawTheme(): 'dark' | 'light' {
  if (document.documentElement.classList.contains('dark')) return 'dark';
  if (document.documentElement.dataset.theme === 'dark') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
    ensureExcalidrawStyles();
    void loadExcalidrawComponent()
      .then((component) => {
        if (cancelled) return;
        setLoadedExcalidraw(() => component);
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

import '@excalidraw/excalidraw/index.css';

import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';

import type { ExcalidrawSceneData } from '../content/excalidrawUtils';
import { buildDrawingFileNames, serializeExcalidrawScene } from '../content/excalidrawUtils';
import { useTheme } from '../ui-state/theme';

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

interface Props {
  initialTitle?: string;
  initialScene?: ExcalidrawSceneData | null;
  saveLabel?: string;
  onClose: () => void;
  onSave: (payload: ExcalidrawEditorSavePayload) => Promise<void> | void;
}

type ExcalidrawComponent = typeof import('@excalidraw/excalidraw').Excalidraw;

let excalidrawComponentPromise: Promise<ExcalidrawComponent> | null = null;

async function loadExcalidrawComponent(): Promise<ExcalidrawComponent> {
  if (!excalidrawComponentPromise) {
    excalidrawComponentPromise = import('@excalidraw/excalidraw').then((module) => module.Excalidraw);
  }

  return excalidrawComponentPromise;
}

const EMPTY_SCENE: ExcalidrawSceneData = {
  elements: [],
  appState: {},
  files: {},
};

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

export function ExcalidrawEditorModal({
  initialTitle = 'Drawing',
  initialScene = null,
  saveLabel = 'Save drawing',
  onClose,
  onSave,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [LoadedExcalidraw, setLoadedExcalidraw] = useState<ExcalidrawComponent | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const sceneRef = useRef<ExcalidrawSceneData>(initialScene ?? EMPTY_SCENE);
  const { theme } = useTheme();
  const excalidrawTheme = theme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    let cancelled = false;

    void loadExcalidrawComponent()
      .then((component) => {
        if (cancelled) {
          return;
        }

        setLoadedExcalidraw(() => component);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setLoadError(error instanceof Error ? error : new Error('Failed to load Excalidraw.'));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (!LoadedExcalidraw || loadError) {
      return;
    }

    const normalizedTitle = title.trim() || 'Drawing';
    setSaving(true);

    try {
      const scene = sceneRef.current;
      const serialized = await serializeExcalidrawScene(scene);
      const fileNames = buildDrawingFileNames(normalizedTitle);

      await onSave({
        title: normalizedTitle,
        scene,
        sourceData: serialized.sourceData,
        sourceMimeType: serialized.sourceMimeType,
        sourceName: fileNames.sourceName,
        previewData: serialized.previewData,
        previewMimeType: serialized.previewMimeType,
        previewName: fileNames.previewName,
        previewUrl: serialized.previewUrl,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Excalidraw editor"
        className="ui-dialog-shell"
        style={{ width: 'min(85vw, 1600px)', height: '85vh', maxHeight: '85vh' }}
      >
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
            <button type="button" onClick={onClose} className="ui-toolbar-button px-2 py-1 text-[10px]" disabled={saving}>
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
              {saving ? 'Saving…' : saveLabel}
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
                    initialScene
                      ? {
                          elements: [...initialScene.elements],
                          appState: {
                            ...initialScene.appState,
                            theme: excalidrawTheme,
                            openMenu: null,
                            openSidebar: null,
                          },
                          files: initialScene.files,
                        }
                      : {
                          appState: {
                            theme: excalidrawTheme,
                            openMenu: null,
                            openSidebar: null,
                          },
                        }
                  }
                  onChange={(elements, appState, files) => {
                    sceneRef.current = {
                      elements: [...elements],
                      appState: { ...appState },
                      files: { ...files },
                    };
                  }}
                />
              </div>
            </ExcalidrawErrorBoundary>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-dim">Loading Excalidraw…</div>
          )}
        </div>
      </div>
    </div>
  );
}

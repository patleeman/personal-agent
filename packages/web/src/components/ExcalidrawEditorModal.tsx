import { Component, type ErrorInfo, type ReactNode, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawSceneData } from '../excalidrawUtils';
import { buildDrawingFileNames, serializeExcalidrawScene } from '../excalidrawUtils';
import { useTheme } from '../theme';

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
  tools: {
    image: false,
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
  const sceneRef = useRef<ExcalidrawSceneData>(initialScene ?? EMPTY_SCENE);
  const { theme } = useTheme();
  const excalidrawTheme = theme === 'dark' ? 'dark' : 'light';

  async function handleSave() {
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
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Excalidraw editor"
        className="ui-dialog-shell"
        style={{ width: 'min(85vw, 1600px)', height: '85vh', maxHeight: '85vh' }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="ui-section-label">Excalidraw drawing</p>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-[13px] text-primary outline-none focus:border-accent/50"
              placeholder="Drawing title"
              disabled={saving}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-toolbar-button"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              className="ui-pill ui-pill-solid-accent"
              disabled={saving}
            >
              {saving ? 'Saving…' : saveLabel}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ExcalidrawErrorBoundary>
            <div className="excalidraw-embed-lite h-full w-full">
              <Excalidraw
                theme={excalidrawTheme}
                UIOptions={EMBEDDED_UI_OPTIONS}
                renderTopRightUI={() => null}
                initialData={initialScene ? {
                  elements: [...initialScene.elements],
                  appState: {
                    ...initialScene.appState,
                    theme: excalidrawTheme,
                    openMenu: null,
                    openSidebar: null,
                  },
                  files: initialScene.files,
                } : {
                  appState: {
                    theme: excalidrawTheme,
                    openMenu: null,
                    openSidebar: null,
                  },
                }}
                onChange={(elements, appState, files) => {
                  sceneRef.current = {
                    elements: [...elements],
                    appState: appState as unknown as Record<string, unknown>,
                    files: files as unknown as Record<string, unknown>,
                  };
                }}
              />
            </div>
          </ExcalidrawErrorBoundary>
        </div>
      </div>
    </div>
  );
}

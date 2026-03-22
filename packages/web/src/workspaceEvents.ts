const WORKSPACE_CHANGED_EVENT = 'pa:workspace-changed';
const WORKSPACE_EDITOR_DIRTY_EVENT = 'pa:workspace-editor-dirty';

let workspaceEditorDirty = false;

export function emitWorkspaceChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT));
}

export function subscribeWorkspaceChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(WORKSPACE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, listener);
}

export function setWorkspaceEditorDirty(value: boolean): void {
  if (workspaceEditorDirty === value) {
    return;
  }

  workspaceEditorDirty = value;
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(WORKSPACE_EDITOR_DIRTY_EVENT, {
    detail: { dirty: value },
  }));
}

export function isWorkspaceEditorDirty(): boolean {
  return workspaceEditorDirty;
}

export function subscribeWorkspaceEditorDirty(listener: (dirty: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const dirty = Boolean((event as CustomEvent<{ dirty?: boolean }>).detail?.dirty);
    listener(dirty);
  };

  window.addEventListener(WORKSPACE_EDITOR_DIRTY_EVENT, handler);
  return () => window.removeEventListener(WORKSPACE_EDITOR_DIRTY_EVENT, handler);
}

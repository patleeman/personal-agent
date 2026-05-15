export type ExtensionSelectionKind = 'text' | 'messages' | 'files' | 'transcriptRange';

export interface ExtensionSelectionState {
  kind: ExtensionSelectionKind;
  text?: string;
  messageBlockIds?: string[];
  files?: Array<{ cwd: string; path: string }>;
  transcriptRange?: { conversationId: string; startBlockId: string; endBlockId: string };
  conversationId?: string | null;
  cwd?: string | null;
  updatedAt: string;
}

let currentSelection: ExtensionSelectionState | null = null;
const listeners = new Set<(selection: ExtensionSelectionState | null) => void>();

export function readExtensionSelection(): ExtensionSelectionState | null {
  return currentSelection;
}

export function setExtensionSelection(selection: Omit<ExtensionSelectionState, 'updatedAt'> | null): void {
  currentSelection = selection ? { ...selection, updatedAt: new Date().toISOString() } : null;
  for (const listener of listeners) listener(currentSelection);
  window.dispatchEvent(new CustomEvent('pa-extension-selection-change', { detail: currentSelection }));
  window.dispatchEvent(new CustomEvent('pa-ext-event', { detail: { event: 'host:selection', payload: currentSelection } }));
}

export function subscribeExtensionSelection(listener: (selection: ExtensionSelectionState | null) => void): { unsubscribe: () => void } {
  listeners.add(listener);
  listener(currentSelection);
  return { unsubscribe: () => listeners.delete(listener) };
}

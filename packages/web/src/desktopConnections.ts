import type { DesktopConnectionsState, DesktopHostRecord } from './types';

export type DesktopHostEditorMode = 'new' | 'existing';

export function resolveDesktopHostEditorSelection(
  connections: DesktopConnectionsState | null,
  selectedHostId: string,
  editorMode: DesktopHostEditorMode,
): {
  editorMode: DesktopHostEditorMode;
  selectedHostId: string;
  selectedHost: Extract<DesktopHostRecord, { kind: 'web' | 'ssh' }> | null;
} | null {
  if (!connections) {
    return null;
  }

  if (editorMode === 'new') {
    return {
      editorMode: 'new',
      selectedHostId: '',
      selectedHost: null,
    };
  }

  const selectedHost = connections.hosts.find((host) => host.id === selectedHostId && host.kind !== 'local');
  if (selectedHost && selectedHost.kind !== 'local') {
    return {
      editorMode: 'existing',
      selectedHostId: selectedHost.id,
      selectedHost,
    };
  }

  const firstRemote = connections.hosts.find((host) => host.kind !== 'local');
  if (firstRemote && firstRemote.kind !== 'local') {
    return {
      editorMode: 'existing',
      selectedHostId: firstRemote.id,
      selectedHost: firstRemote,
    };
  }

  return {
    editorMode: 'new',
    selectedHostId: '',
    selectedHost: null,
  };
}

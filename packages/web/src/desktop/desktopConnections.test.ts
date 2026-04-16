import { describe, expect, it } from 'vitest';
import { resolveDesktopHostEditorSelection } from './desktopConnections.js';
import type { DesktopConnectionsState } from '../types';

function createConnectionsState(): DesktopConnectionsState {
  return {
    activeHostId: 'local',
    defaultHostId: 'local',
    hosts: [
      { id: 'local', label: 'Local', kind: 'local' },
      { id: 'web-1', label: 'Web', kind: 'web', websocketUrl: 'wss://example.ts.net/codex', workspaceRoot: '/workspace/example' },
      { id: 'ssh-1', label: 'SSH', kind: 'ssh', sshTarget: 'patrick@example' },
    ],
  };
}

describe('resolveDesktopHostEditorSelection', () => {
  it('keeps the editor in new-host mode even when saved remotes exist', () => {
    expect(resolveDesktopHostEditorSelection(createConnectionsState(), '', 'new')).toEqual({
      editorMode: 'new',
      selectedHostId: '',
      selectedHost: null,
    });
  });

  it('keeps the selected saved host when editing an existing remote', () => {
    expect(resolveDesktopHostEditorSelection(createConnectionsState(), 'ssh-1', 'existing')).toEqual({
      editorMode: 'existing',
      selectedHostId: 'ssh-1',
      selectedHost: {
        id: 'ssh-1',
        label: 'SSH',
        kind: 'ssh',
        sshTarget: 'patrick@example',
      },
    });
  });

  it('falls back to the first saved remote when the current selection disappears', () => {
    expect(resolveDesktopHostEditorSelection(createConnectionsState(), 'missing', 'existing')).toEqual({
      editorMode: 'existing',
      selectedHostId: 'web-1',
      selectedHost: {
        id: 'web-1',
        label: 'Web',
        kind: 'web',
        websocketUrl: 'wss://example.ts.net/codex',
        workspaceRoot: '/workspace/example',
      },
    });
  });

  it('switches to new-host mode when no saved remotes remain', () => {
    const onlyLocal: DesktopConnectionsState = {
      activeHostId: 'local',
      defaultHostId: 'local',
      hosts: [{ id: 'local', label: 'Local', kind: 'local' }],
    };

    expect(resolveDesktopHostEditorSelection(onlyLocal, 'missing', 'existing')).toEqual({
      editorMode: 'new',
      selectedHostId: '',
      selectedHost: null,
    });
  });
});

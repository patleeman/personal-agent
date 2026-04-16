import { describe, expect, it } from 'vitest';
import {
  describeDesktopWorkspaceServerTailnetPublish,
  formatDesktopWorkspaceServerStatus,
  labelDesktopWorkspaceServerTailnetUrl,
} from './desktopWorkspaceServer';
import type { DesktopWorkspaceServerState } from '../shared/types';

function createState(overrides: Partial<DesktopWorkspaceServerState> = {}): DesktopWorkspaceServerState {
  return {
    enabled: true,
    port: 8390,
    useTailscaleServe: true,
    running: true,
    websocketPath: '/codex',
    localWebsocketUrl: 'ws://127.0.0.1:8390/codex',
    tailnetWebsocketUrl: 'wss://desktop.tailnet.ts.net/codex',
    tailscalePublishState: {
      status: 'published',
      path: '/codex',
      expectedProxyTarget: 'http://localhost:8390',
      actualProxyTarget: 'http://localhost:8390',
      message: 'Tailscale Serve exposes /codex -> localhost:8390.',
    },
    logFile: '/logs/codex-app-server.log',
    ...overrides,
  };
}

describe('formatDesktopWorkspaceServerStatus', () => {
  it('shows tailnet publish failures explicitly when the server is otherwise running', () => {
    expect(formatDesktopWorkspaceServerStatus(createState({
      tailscalePublishState: {
        status: 'missing',
        path: '/codex',
        expectedProxyTarget: 'http://localhost:8390',
        message: 'missing',
      },
    }), {
      enabled: true,
      useTailscaleServe: true,
      port: '8390',
    })).toEqual({
      label: 'Tailnet missing',
      className: 'text-danger',
    });
  });

  it('falls back to running when tailnet publishing is not requested', () => {
    expect(formatDesktopWorkspaceServerStatus(createState({
      useTailscaleServe: false,
      tailscalePublishState: {
        status: 'disabled',
        path: '/codex',
        expectedProxyTarget: 'http://localhost:8390',
        message: 'disabled',
      },
    }), {
      enabled: true,
      useTailscaleServe: false,
      port: '8390',
    })).toEqual({
      label: 'Running',
      className: 'text-steel',
    });
  });
});

describe('describeDesktopWorkspaceServerTailnetPublish', () => {
  it('reports the live proxy target when tailnet publishing is healthy', () => {
    expect(describeDesktopWorkspaceServerTailnetPublish(createState(), {
      enabled: true,
      useTailscaleServe: true,
      port: '8390',
    })).toEqual({
      label: 'Live',
      value: '/codex → http://localhost:8390',
      className: 'text-steel',
      detail: 'Tailscale Serve exposes /codex -> localhost:8390.',
    });
  });

  it('reports the wrong target when tailscale serve drifts', () => {
    expect(describeDesktopWorkspaceServerTailnetPublish(createState({
      tailscalePublishState: {
        status: 'mismatch',
        path: '/codex',
        expectedProxyTarget: 'http://localhost:8390',
        actualProxyTarget: 'http://localhost:3741',
        message: 'wrong target',
      },
    }), {
      enabled: true,
      useTailscaleServe: true,
      port: '8390',
    })).toEqual({
      label: 'Wrong target',
      value: '/codex → http://localhost:3741',
      className: 'text-danger',
      detail: 'Expected http://localhost:8390.',
    });
  });
});

describe('labelDesktopWorkspaceServerTailnetUrl', () => {
  it('labels unpublished tailnet urls as expected values instead of live ones', () => {
    expect(labelDesktopWorkspaceServerTailnetUrl(createState({
      tailscalePublishState: {
        status: 'missing',
        path: '/codex',
        expectedProxyTarget: 'http://localhost:8390',
        message: 'missing',
      },
    }))).toBe('Expected Tailnet URL');
  });
});

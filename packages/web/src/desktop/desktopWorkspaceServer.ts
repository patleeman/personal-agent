import type { DesktopWorkspaceServerState } from '../shared/types';

interface DesktopWorkspaceServerDraftState {
  enabled: boolean;
  useTailscaleServe: boolean;
  port: string;
}

export function formatDesktopWorkspaceServerStatus(
  state: DesktopWorkspaceServerState | null,
  draft: DesktopWorkspaceServerDraftState,
): { label: string; className: string } {
  if (state?.running) {
    if (state.useTailscaleServe) {
      switch (state.tailscalePublishState.status) {
        case 'published':
          return {
            label: 'Running',
            className: 'text-steel',
          };
        case 'missing':
          return {
            label: 'Tailnet missing',
            className: 'text-danger',
          };
        case 'mismatch':
          return {
            label: 'Tailnet mismatch',
            className: 'text-danger',
          };
        case 'unavailable':
          return {
            label: 'Tailnet unknown',
            className: 'text-warning',
          };
        default:
          break;
      }
    }

    return {
      label: 'Running',
      className: 'text-steel',
    };
  }

  if (state?.error) {
    return {
      label: 'Error',
      className: 'text-danger',
    };
  }

  if (draft.enabled) {
    return {
      label: 'Starting…',
      className: 'text-warning',
    };
  }

  return {
    label: 'Off',
    className: 'text-secondary',
  };
}

export function describeDesktopWorkspaceServerTailnetPublish(
  state: DesktopWorkspaceServerState | null,
  draft: DesktopWorkspaceServerDraftState,
): { label: string; value: string; className: string; detail?: string } {
  const expectedPort = draft.port.trim() || String(state?.port ?? 8390);
  const path = state?.tailscalePublishState.path ?? '/codex';
  const expectedProxyTarget = state?.tailscalePublishState.expectedProxyTarget ?? `http://localhost:${expectedPort}`;

  if (!draft.enabled) {
    return {
      label: 'Off',
      value: `Remote server is disabled. ${path} is not published.`,
      className: 'text-secondary',
    };
  }

  if (!draft.useTailscaleServe) {
    return {
      label: 'Off',
      value: `${path} is not published on Tailnet.`,
      className: 'text-secondary',
    };
  }

  if (!state) {
    return {
      label: 'Checking…',
      value: `Inspecting ${path} in Tailscale Serve…`,
      className: 'text-warning',
    };
  }

  switch (state.tailscalePublishState.status) {
    case 'published':
      return {
        label: 'Live',
        value: `${path} → ${state.tailscalePublishState.actualProxyTarget ?? expectedProxyTarget}`,
        className: 'text-steel',
        detail: state.tailscalePublishState.message,
      };
    case 'missing':
      return {
        label: 'Missing',
        value: `${path} is not in Tailscale Serve right now.`,
        className: 'text-danger',
        detail: state.tailscalePublishState.message,
      };
    case 'mismatch':
      return {
        label: 'Wrong target',
        value: `${path} → ${state.tailscalePublishState.actualProxyTarget ?? 'unknown target'}`,
        className: 'text-danger',
        detail: `Expected ${expectedProxyTarget}.`,
      };
    case 'unavailable':
      return {
        label: 'Unknown',
        value: `Could not inspect ${path} in Tailscale Serve.`,
        className: 'text-warning',
        detail: state.tailscalePublishState.message,
      };
    case 'disabled':
    default:
      return {
        label: 'Off',
        value: `${path} is not published on Tailnet.`,
        className: 'text-secondary',
      };
  }
}

export function labelDesktopWorkspaceServerTailnetUrl(state: DesktopWorkspaceServerState): string {
  return state.tailscalePublishState.status === 'published'
    ? 'Tailnet URL'
    : 'Expected Tailnet URL';
}

import { ipcMain, type WebContents } from 'electron';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopWindowController } from './window.js';

const CHANNEL_PREFIX = 'personal-agent-desktop';
const API_STREAM_CHANNEL = `${CHANNEL_PREFIX}:api-stream`;
const APP_EVENTS_CHANNEL = `${CHANNEL_PREFIX}:app-events`;
const PROVIDER_OAUTH_CHANNEL = `${CHANNEL_PREFIX}:provider-oauth-login`;

export function registerDesktopIpc(options: {
  hostManager: HostManager;
  windowController: DesktopWindowController;
  onHostStateChanged?: () => void;
  onCheckForUpdates?: () => Promise<void> | void;
}): void {
  const streamSubscriptions = new Map<string, () => void>();
  const appEventSubscriptions = new Map<string, () => void>();
  const providerOAuthSubscriptions = new Map<string, () => void>();

  const sendBufferedSubscriptionEvent = <T>(input: {
    sender: WebContents;
    channel: string;
    subscriptionId: string;
    subscribe: (emit: (event: T) => void) => Promise<() => void>;
    store: Map<string, () => void>;
  }): Promise<void> => (async () => {
    const pendingEvents: T[] = [];
    let deliveryEnabled = false;
    let active = true;

    const deliver = (nextEvent: T) => {
      if (!active || input.sender.isDestroyed()) {
        return;
      }

      if (!deliveryEnabled) {
        pendingEvents.push(nextEvent);
        return;
      }

      input.sender.send(input.channel, {
        subscriptionId: input.subscriptionId,
        event: nextEvent,
      });
    };

    const unsubscribe = await input.subscribe(deliver);
    const cleanup = () => {
      if (!active) {
        return;
      }

      active = false;
      unsubscribe();
      input.store.delete(input.subscriptionId);
      pendingEvents.length = 0;
    };

    input.store.set(input.subscriptionId, cleanup);
    input.sender.once('destroyed', cleanup);
    deliveryEnabled = true;
    setImmediate(() => {
      if (!active || input.sender.isDestroyed()) {
        return;
      }

      for (const pendingEvent of pendingEvents) {
        input.sender.send(input.channel, {
          subscriptionId: input.subscriptionId,
          event: pendingEvent,
        });
      }
      pendingEvents.length = 0;
    });
  })();

  ipcMain.handle(`${CHANNEL_PREFIX}:get-environment`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    return options.hostManager.getDesktopEnvironmentForHost(hostId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:get-connections`, async () => {
    return options.hostManager.getConnectionsState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:get-navigation-state`, async (event) => {
    return options.windowController.getNavigationStateForWebContents(event.sender.id);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:switch-host`, async (_event, hostId: string) => {
    await options.hostManager.switchHost(hostId);
    options.onHostStateChanged?.();
    await options.windowController.openMainWindow('/');
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:save-host`, async (_event, host) => {
    await options.hostManager.saveHost(host);
    options.onHostStateChanged?.();
    return options.hostManager.getConnectionsState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:delete-host`, async (_event, hostId: string) => {
    await options.hostManager.deleteHost(hostId);
    options.onHostStateChanged?.();
    await options.windowController.openMainWindow('/settings');
    return options.hostManager.getConnectionsState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:open-new-conversation`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const url = await options.hostManager.openNewConversationForHost(hostId);
    await options.windowController.openAbsoluteUrlInWindow(event.sender.id, url);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-app-status`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readAppStatus) {
      throw new Error('Dedicated desktop app status reads are only available for the local host.');
    }

    return controller.readAppStatus();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-daemon-state`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readDaemonState) {
      throw new Error('Dedicated desktop daemon-state reads are only available for the local host.');
    }

    return controller.readDaemonState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-web-ui-state`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readWebUiState) {
      throw new Error('Dedicated desktop web-ui-state reads are only available for the local host.');
    }

    return controller.readWebUiState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-web-ui-config`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateWebUiConfig) {
      throw new Error('Dedicated desktop web-ui config writes are only available for the local host.');
    }

    return controller.updateWebUiConfig(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-remote-access-state`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readRemoteAccessState) {
      throw new Error('Dedicated desktop remote-access reads are only available for the local host.');
    }

    return controller.readRemoteAccessState();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:create-remote-access-pairing-code`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.createRemoteAccessPairingCode) {
      throw new Error('Dedicated desktop remote-access writes are only available for the local host.');
    }

    return controller.createRemoteAccessPairingCode();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:revoke-remote-access-session`, async (event, sessionId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.revokeRemoteAccessSession) {
      throw new Error('Dedicated desktop remote-access session revokes are only available for the local host.');
    }

    return controller.revokeRemoteAccessSession(sessionId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-sessions`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readSessions) {
      throw new Error('Dedicated desktop session-list reads are only available for the local host.');
    }

    return controller.readSessions();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-session-meta`, async (event, sessionId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readSessionMeta) {
      throw new Error('Dedicated desktop session-meta reads are only available for the local host.');
    }

    return controller.readSessionMeta(sessionId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-session-search-index`, async (event, sessionIds: string[]) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readSessionSearchIndex) {
      throw new Error('Dedicated desktop session-search-index reads are only available for the local host.');
    }

    return controller.readSessionSearchIndex(sessionIds);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-profiles`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readProfiles) {
      throw new Error('Dedicated desktop profile reads are only available for the local host.');
    }

    return controller.readProfiles();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:set-current-profile`, async (event, profile: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.setCurrentProfile) {
      throw new Error('Dedicated desktop profile writes are only available for the local host.');
    }

    return controller.setCurrentProfile(profile);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-models`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readModels) {
      throw new Error('Dedicated desktop model reads are only available for the local host.');
    }

    return controller.readModels();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-model-preferences`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateModelPreferences) {
      throw new Error('Dedicated desktop model preference writes are only available for the local host.');
    }

    return controller.updateModelPreferences(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-default-cwd`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readDefaultCwd) {
      throw new Error('Dedicated desktop default cwd reads are only available for the local host.');
    }

    return controller.readDefaultCwd();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-default-cwd`, async (event, cwd: string | null) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateDefaultCwd) {
      throw new Error('Dedicated desktop default cwd writes are only available for the local host.');
    }

    return controller.updateDefaultCwd(cwd);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-vault-root`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readVaultRoot) {
      throw new Error('Dedicated desktop vault-root reads are only available for the local host.');
    }

    return controller.readVaultRoot();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-vault-files`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readVaultFiles) {
      throw new Error('Dedicated desktop vault-file reads are only available for the local host.');
    }

    return controller.readVaultFiles();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-vault-root`, async (event, root: string | null) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateVaultRoot) {
      throw new Error('Dedicated desktop vault-root writes are only available for the local host.');
    }

    return controller.updateVaultRoot(root);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:pick-folder`, async (event, input?: { cwd?: string | null }) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.pickFolder) {
      throw new Error('Dedicated desktop folder picking is only available for the local host.');
    }

    return controller.pickFolder(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:run-shell-command`, async (event, input: { command: string; cwd?: string | null }) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.runShellCommand) {
      throw new Error('Dedicated desktop shell commands are only available for the local host.');
    }

    return controller.runShellCommand(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-title-settings`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationTitleSettings) {
      throw new Error('Dedicated desktop conversation-title reads are only available for the local host.');
    }

    return controller.readConversationTitleSettings();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-conversation-title-settings`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateConversationTitleSettings) {
      throw new Error('Dedicated desktop conversation-title writes are only available for the local host.');
    }

    return controller.updateConversationTitleSettings(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-plan-defaults`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationPlanDefaults) {
      throw new Error('Dedicated desktop conversation-plan default reads are only available for the local host.');
    }

    return controller.readConversationPlanDefaults();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-conversation-plan-defaults`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateConversationPlanDefaults) {
      throw new Error('Dedicated desktop conversation-plan default writes are only available for the local host.');
    }

    return controller.updateConversationPlanDefaults(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-plan-library`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationPlanLibrary) {
      throw new Error('Dedicated desktop conversation-plan library reads are only available for the local host.');
    }

    return controller.readConversationPlanLibrary();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-conversation-plan-library`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateConversationPlanLibrary) {
      throw new Error('Dedicated desktop conversation-plan library writes are only available for the local host.');
    }

    return controller.updateConversationPlanLibrary(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-plans-workspace`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationPlansWorkspace) {
      throw new Error('Dedicated desktop conversation-plan workspace reads are only available for the local host.');
    }

    return controller.readConversationPlansWorkspace();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-open-conversation-tabs`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readOpenConversationTabs) {
      throw new Error('Dedicated desktop open-conversation reads are only available for the local host.');
    }

    return controller.readOpenConversationTabs();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-open-conversation-tabs`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateOpenConversationTabs) {
      throw new Error('Dedicated desktop open-conversation writes are only available for the local host.');
    }

    return controller.updateOpenConversationTabs(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-model-providers`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readModelProviders) {
      throw new Error('Dedicated desktop model provider reads are only available for the local host.');
    }

    return controller.readModelProviders();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:save-model-provider`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.saveModelProvider) {
      throw new Error('Dedicated desktop model provider writes are only available for the local host.');
    }

    return controller.saveModelProvider(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:delete-model-provider`, async (event, provider: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.deleteModelProvider) {
      throw new Error('Dedicated desktop model provider deletes are only available for the local host.');
    }

    return controller.deleteModelProvider(provider);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:save-model-provider-model`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.saveModelProviderModel) {
      throw new Error('Dedicated desktop model variant writes are only available for the local host.');
    }

    return controller.saveModelProviderModel(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:delete-model-provider-model`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.deleteModelProviderModel) {
      throw new Error('Dedicated desktop model variant deletes are only available for the local host.');
    }

    return controller.deleteModelProviderModel(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-provider-auth`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readProviderAuth) {
      throw new Error('Dedicated desktop provider auth reads are only available for the local host.');
    }

    return controller.readProviderAuth();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-codex-plan-usage`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readCodexPlanUsage) {
      throw new Error('Dedicated desktop Codex usage reads are only available for the local host.');
    }

    return controller.readCodexPlanUsage();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:set-provider-api-key`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.setProviderApiKey) {
      throw new Error('Dedicated desktop provider auth writes are only available for the local host.');
    }

    return controller.setProviderApiKey(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:remove-provider-credential`, async (event, provider: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.removeProviderCredential) {
      throw new Error('Dedicated desktop provider credential removal is only available for the local host.');
    }

    return controller.removeProviderCredential(provider);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:start-provider-oauth-login`, async (event, provider: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.startProviderOAuthLogin) {
      throw new Error('Dedicated desktop provider OAuth start is only available for the local host.');
    }

    return controller.startProviderOAuthLogin(provider);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-provider-oauth-login`, async (_event, loginId: string) => {
    const controller = options.hostManager.getHostController(options.hostManager.getActiveHostId());
    if (!controller.readProviderOAuthLogin) {
      throw new Error('Dedicated desktop provider OAuth reads are only available for the local host.');
    }

    return controller.readProviderOAuthLogin(loginId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:submit-provider-oauth-login-input`, async (_event, input) => {
    const controller = options.hostManager.getHostController(options.hostManager.getActiveHostId());
    if (!controller.submitProviderOAuthLoginInput) {
      throw new Error('Dedicated desktop provider OAuth input is only available for the local host.');
    }

    return controller.submitProviderOAuthLoginInput(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:cancel-provider-oauth-login`, async (_event, loginId: string) => {
    const controller = options.hostManager.getHostController(options.hostManager.getActiveHostId());
    if (!controller.cancelProviderOAuthLogin) {
      throw new Error('Dedicated desktop provider OAuth cancel is only available for the local host.');
    }

    return controller.cancelProviderOAuthLogin(loginId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-activity`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readActivity) {
      throw new Error('Dedicated desktop activity reads are only available for the local host.');
    }

    return controller.readActivity();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-activity-by-id`, async (event, activityId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readActivityById) {
      throw new Error('Dedicated desktop activity detail is only available for the local host.');
    }

    return controller.readActivityById(activityId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:mark-activity-read`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.markActivityRead) {
      throw new Error('Dedicated desktop activity mutations are only available for the local host.');
    }

    return controller.markActivityRead(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:clear-inbox`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.clearInbox) {
      throw new Error('Dedicated desktop inbox clearing is only available for the local host.');
    }

    return controller.clearInbox();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:start-activity-conversation`, async (event, activityId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.startActivityConversation) {
      throw new Error('Dedicated desktop activity conversation start is only available for the local host.');
    }

    return controller.startActivityConversation(activityId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:mark-conversation-attention`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.markConversationAttention) {
      throw new Error('Dedicated desktop conversation attention mutations are only available for the local host.');
    }

    return controller.markConversationAttention(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-alerts`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readAlerts) {
      throw new Error('Dedicated desktop alert reads are only available for the local host.');
    }

    return controller.readAlerts();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:acknowledge-alert`, async (event, alertId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.acknowledgeAlert) {
      throw new Error('Dedicated desktop alert acknowledgement is only available for the local host.');
    }

    return controller.acknowledgeAlert(alertId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:dismiss-alert`, async (event, alertId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.dismissAlert) {
      throw new Error('Dedicated desktop alert dismissal is only available for the local host.');
    }

    return controller.dismissAlert(alertId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:snooze-alert`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.snoozeAlert) {
      throw new Error('Dedicated desktop alert snoozing is only available for the local host.');
    }

    return controller.snoozeAlert(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-scheduled-tasks`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readScheduledTasks) {
      throw new Error('Dedicated desktop task reads are only available for the local host.');
    }

    return controller.readScheduledTasks();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-scheduled-task-detail`, async (event, taskId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readScheduledTaskDetail) {
      throw new Error('Dedicated desktop task detail is only available for the local host.');
    }

    return controller.readScheduledTaskDetail(taskId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-scheduled-task-log`, async (event, taskId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readScheduledTaskLog) {
      throw new Error('Dedicated desktop task logs are only available for the local host.');
    }

    return controller.readScheduledTaskLog(taskId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:create-scheduled-task`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.createScheduledTask) {
      throw new Error('Dedicated desktop task creation is only available for the local host.');
    }

    return controller.createScheduledTask(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-scheduled-task`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateScheduledTask) {
      throw new Error('Dedicated desktop task updates are only available for the local host.');
    }

    return controller.updateScheduledTask(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:run-scheduled-task`, async (event, taskId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.runScheduledTask) {
      throw new Error('Dedicated desktop task execution is only available for the local host.');
    }

    return controller.runScheduledTask(taskId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-durable-runs`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readDurableRuns) {
      throw new Error('Dedicated desktop durable run reads are only available for the local host.');
    }

    return controller.readDurableRuns();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-durable-run`, async (event, runId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readDurableRun) {
      throw new Error('Dedicated desktop durable run detail is only available for the local host.');
    }

    return controller.readDurableRun(runId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-durable-run-log`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readDurableRunLog) {
      throw new Error('Dedicated desktop durable run logs are only available for the local host.');
    }

    return controller.readDurableRunLog(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:cancel-durable-run`, async (event, runId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.cancelDurableRun) {
      throw new Error('Dedicated desktop durable run cancellation is only available for the local host.');
    }

    return controller.cancelDurableRun(runId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:mark-durable-run-attention`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.markDurableRunAttention) {
      throw new Error('Dedicated desktop durable run attention updates are only available for the local host.');
    }

    return controller.markDurableRunAttention(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-bootstrap`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationBootstrap) {
      throw new Error('Dedicated desktop conversation bootstrap is only available for the local host.');
    }

    return controller.readConversationBootstrap(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:rename-conversation`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.renameConversation) {
      throw new Error('Dedicated desktop conversation rename is only available for the local host.');
    }

    return controller.renameConversation(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:change-conversation-cwd`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.changeConversationCwd) {
      throw new Error('Dedicated desktop conversation cwd changes are only available for the local host.');
    }

    return controller.changeConversationCwd(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-deferred-resumes`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationDeferredResumes) {
      throw new Error('Dedicated desktop conversation deferred-resume reads are only available for the local host.');
    }

    return controller.readConversationDeferredResumes(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:schedule-conversation-deferred-resume`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.scheduleConversationDeferredResume) {
      throw new Error('Dedicated desktop conversation deferred-resume scheduling is only available for the local host.');
    }

    return controller.scheduleConversationDeferredResume(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:cancel-conversation-deferred-resume`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.cancelConversationDeferredResume) {
      throw new Error('Dedicated desktop conversation deferred-resume cancellation is only available for the local host.');
    }

    return controller.cancelConversationDeferredResume(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:fire-conversation-deferred-resume`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.fireConversationDeferredResume) {
      throw new Error('Dedicated desktop conversation deferred-resume firing is only available for the local host.');
    }

    return controller.fireConversationDeferredResume(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:recover-conversation`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.recoverConversation) {
      throw new Error('Dedicated desktop conversation recovery is only available for the local host.');
    }

    return controller.recoverConversation(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-model-preferences`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationModelPreferences) {
      throw new Error('Dedicated desktop conversation model preference reads are only available for the local host.');
    }

    return controller.readConversationModelPreferences(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-conversation-model-preferences`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateConversationModelPreferences) {
      throw new Error('Dedicated desktop conversation model preference updates are only available for the local host.');
    }

    return controller.updateConversationModelPreferences(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-artifacts`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationArtifacts) {
      throw new Error('Dedicated desktop conversation artifact list reads are only available for the local host.');
    }

    return controller.readConversationArtifacts(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-artifact`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationArtifact) {
      throw new Error('Dedicated desktop conversation artifact reads are only available for the local host.');
    }

    return controller.readConversationArtifact(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:delete-conversation-artifact`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.deleteConversationArtifact) {
      throw new Error('Dedicated desktop conversation artifact deletes are only available for the local host.');
    }

    return controller.deleteConversationArtifact(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-attachments`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationAttachments) {
      throw new Error('Dedicated desktop conversation attachment list reads are only available for the local host.');
    }

    return controller.readConversationAttachments(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-attachment`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationAttachment) {
      throw new Error('Dedicated desktop conversation attachment reads are only available for the local host.');
    }

    return controller.readConversationAttachment(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:create-conversation-attachment`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.createConversationAttachment) {
      throw new Error('Dedicated desktop conversation attachment creates are only available for the local host.');
    }

    return controller.createConversationAttachment(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:update-conversation-attachment`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.updateConversationAttachment) {
      throw new Error('Dedicated desktop conversation attachment updates are only available for the local host.');
    }

    return controller.updateConversationAttachment(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:delete-conversation-attachment`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.deleteConversationAttachment) {
      throw new Error('Dedicated desktop conversation attachment deletes are only available for the local host.');
    }

    return controller.deleteConversationAttachment(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-conversation-attachment-asset`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readConversationAttachmentAsset) {
      throw new Error('Dedicated desktop conversation attachment asset reads are only available for the local host.');
    }

    return controller.readConversationAttachmentAsset(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-live-sessions`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readLiveSessions) {
      throw new Error('Dedicated desktop live-session list reads are only available for the local host.');
    }

    return controller.readLiveSessions();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-live-session`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readLiveSession) {
      throw new Error('Dedicated desktop live-session reads are only available for the local host.');
    }

    return controller.readLiveSession(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-live-session-fork-entries`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readLiveSessionForkEntries) {
      throw new Error('Dedicated desktop live-session fork entry reads are only available for the local host.');
    }

    return controller.readLiveSessionForkEntries(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-live-session-context`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readLiveSessionContext) {
      throw new Error('Dedicated desktop live-session context reads are only available for the local host.');
    }

    return controller.readLiveSessionContext(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-session-detail`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readSessionDetail) {
      throw new Error('Dedicated desktop session detail reads are only available for the local host.');
    }

    return controller.readSessionDetail(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:read-session-block`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.readSessionBlock) {
      throw new Error('Dedicated desktop session block reads are only available for the local host.');
    }

    return controller.readSessionBlock(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:create-live-session`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.createLiveSession) {
      throw new Error('Dedicated desktop live-session creation is only available for the local host.');
    }

    return controller.createLiveSession(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:resume-live-session`, async (event, sessionFile: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.resumeLiveSession) {
      throw new Error('Dedicated desktop live-session resume is only available for the local host.');
    }

    return controller.resumeLiveSession(sessionFile);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:take-over-live-session`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.takeOverLiveSession) {
      throw new Error('Dedicated desktop live-session takeover is only available for the local host.');
    }

    return controller.takeOverLiveSession(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:restore-queued-live-session-message`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.restoreQueuedLiveSessionMessage) {
      throw new Error('Dedicated desktop queued prompt restore is only available for the local host.');
    }

    return controller.restoreQueuedLiveSessionMessage(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:compact-live-session`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.compactLiveSession) {
      throw new Error('Dedicated desktop live-session compaction is only available for the local host.');
    }

    return controller.compactLiveSession(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:export-live-session`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.exportLiveSession) {
      throw new Error('Dedicated desktop live-session export is only available for the local host.');
    }

    return controller.exportLiveSession(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:reload-live-session`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.reloadLiveSession) {
      throw new Error('Dedicated desktop live-session reload is only available for the local host.');
    }

    return controller.reloadLiveSession(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:destroy-live-session`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.destroyLiveSession) {
      throw new Error('Dedicated desktop live-session destroy is only available for the local host.');
    }

    return controller.destroyLiveSession(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:branch-live-session`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.branchLiveSession) {
      throw new Error('Dedicated desktop live-session branching is only available for the local host.');
    }

    return controller.branchLiveSession(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:fork-live-session`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.forkLiveSession) {
      throw new Error('Dedicated desktop live-session forking is only available for the local host.');
    }

    return controller.forkLiveSession(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:summarize-and-fork-live-session`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.summarizeAndForkLiveSession) {
      throw new Error('Dedicated desktop live-session summary fork is only available for the local host.');
    }

    return controller.summarizeAndForkLiveSession(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:submit-live-session-prompt`, async (event, input) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.submitLiveSessionPrompt) {
      throw new Error('Dedicated desktop live-session prompt delivery is only available for the local host.');
    }

    return controller.submitLiveSessionPrompt(input);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:abort-live-session`, async (event, conversationId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.abortLiveSession) {
      throw new Error('Dedicated desktop live-session abort is only available for the local host.');
    }

    return controller.abortLiveSession(conversationId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:subscribe-api-stream`, async (event, path: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const subscriptionId = `${event.sender.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    await sendBufferedSubscriptionEvent({
      sender: event.sender,
      channel: API_STREAM_CHANNEL,
      subscriptionId,
      store: streamSubscriptions,
      subscribe: (emit) => options.hostManager.getHostController(hostId).subscribeApiStream(path, emit),
    });
    return { subscriptionId };
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:unsubscribe-api-stream`, async (_event, subscriptionId: string) => {
    streamSubscriptions.get(subscriptionId)?.();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:subscribe-app-events`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.subscribeDesktopAppEvents) {
      throw new Error('Desktop app events are only available for the local host.');
    }

    const subscriptionId = `${event.sender.id}:app:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    await sendBufferedSubscriptionEvent({
      sender: event.sender,
      channel: APP_EVENTS_CHANNEL,
      subscriptionId,
      store: appEventSubscriptions,
      subscribe: (emit) => controller.subscribeDesktopAppEvents!(emit),
    });
    return { subscriptionId };
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:unsubscribe-app-events`, async (_event, subscriptionId: string) => {
    appEventSubscriptions.get(subscriptionId)?.();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:subscribe-provider-oauth-login`, async (event, loginId: string) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    const controller = options.hostManager.getHostController(hostId);
    if (!controller.subscribeProviderOAuthLogin) {
      throw new Error('Dedicated desktop provider OAuth subscriptions are only available for the local host.');
    }

    const subscriptionId = `${event.sender.id}:provider-oauth:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    await sendBufferedSubscriptionEvent({
      sender: event.sender,
      channel: PROVIDER_OAUTH_CHANNEL,
      subscriptionId,
      store: providerOAuthSubscriptions,
      subscribe: (emit) => controller.subscribeProviderOAuthLogin!(loginId, emit),
    });
    return { subscriptionId };
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:unsubscribe-provider-oauth-login`, async (_event, subscriptionId: string) => {
    providerOAuthSubscriptions.get(subscriptionId)?.();
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:show-connections`, async () => {
    await options.windowController.openMainWindow('/settings#desktop-connections');
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:open-host-window`, async (_event, hostId: string) => {
    await options.windowController.openHostWindow(hostId);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:go-back`, async (event) => {
    return options.windowController.goBackForWebContents(event.sender.id);
  });

  ipcMain.handle(`${CHANNEL_PREFIX}:go-forward`, async (event) => {
    return options.windowController.goForwardForWebContents(event.sender.id);
  });
}

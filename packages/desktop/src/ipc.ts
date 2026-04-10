import { ipcMain, type WebContents } from 'electron';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopWindowController } from './window.js';

const CHANNEL_PREFIX = 'personal-agent-desktop';
const API_STREAM_CHANNEL = `${CHANNEL_PREFIX}:api-stream`;
const APP_EVENTS_CHANNEL = `${CHANNEL_PREFIX}:app-events`;

export function registerDesktopIpc(options: {
  hostManager: HostManager;
  windowController: DesktopWindowController;
  onHostStateChanged?: () => void;
}): void {
  const streamSubscriptions = new Map<string, () => void>();
  const appEventSubscriptions = new Map<string, () => void>();

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

  ipcMain.handle(`${CHANNEL_PREFIX}:invoke-local-api`, async (event, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    return options.hostManager.getHostController(hostId).invokeLocalApi(method, path, body);
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

  ipcMain.handle(`${CHANNEL_PREFIX}:restart-active-host`, async (event) => {
    const hostId = options.windowController.getHostIdForWebContentsId(event.sender.id)
      ?? options.hostManager.getActiveHostId();
    await options.hostManager.restartHost(hostId);
    options.onHostStateChanged?.();
  });
}

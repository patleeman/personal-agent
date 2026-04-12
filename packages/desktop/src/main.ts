import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getStateRoot } from '@personal-agent/core';
import { app, dialog, shell } from 'electron';
import { applyDesktopShellAppMode } from './app-mode.js';
import { registerDesktopAppProtocol } from './app-protocol.js';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import { HostManager } from './hosts/host-manager.js';
import { DesktopWindowController } from './window.js';
import { DesktopTrayController } from './tray.js';
import { registerDesktopIpc } from './ipc.js';
import { installDesktopApplicationMenu } from './menu.js';
import { DesktopUpdateManager } from './updates/update-manager.js';
import { confirmDesktopQuit } from './quit.js';

let hostManager: HostManager | undefined;
let windowController: DesktopWindowController | undefined;
let trayController: DesktopTrayController | undefined;
let updateManager: DesktopUpdateManager | undefined;
let backendStartupPromise: Promise<boolean> | undefined;
let quitRequestPromise: Promise<void> | null = null;
let quitting = false;

app.setName('Personal Agent');

function renderDesktopErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function logBootstrapError(error: unknown): void {
  const rendered = error instanceof Error
    ? error.stack ?? error.message
    : String(error);

  try {
    const mainLogPath = resolve(getStateRoot(), 'desktop', 'logs', 'main.log');
    appendFileSync(mainLogPath, `[${new Date().toISOString()}] [error] ${rendered}\n`, 'utf-8');
  } catch {
    // Fall back to stderr only when the desktop log path is unavailable.
  }

  console.error(rendered);
}

function reportDesktopError(error: unknown): void {
  logBootstrapError(error);

  const message = renderDesktopErrorMessage(error);
  trayController?.setStartupState({ kind: 'error', message });

  try {
    const { desktopLogsDir } = resolveDesktopRuntimePaths();
    void windowController?.openStartupErrorWindow({
      message,
      logsDir: desktopLogsDir,
    }).catch((windowError) => {
      logBootstrapError(windowError);
    });
    dialog.showErrorBox('Personal Agent error', `${message}\n\nSee desktop logs in:\n${desktopLogsDir}`);
  } catch {
    dialog.showErrorBox('Personal Agent error', message);
  }
}

async function openDesktopLogs(): Promise<void> {
  const { desktopLogsDir } = resolveDesktopRuntimePaths();
  const errorMessage = await shell.openPath(desktopLogsDir);
  if (errorMessage.trim().length > 0) {
    dialog.showErrorBox('Could not open desktop logs', errorMessage);
  }
}

function configureDesktopRuntimeEnvironment(): void {
  const runtime = resolveDesktopRuntimePaths();
  process.env.PERSONAL_AGENT_DESKTOP_RUNTIME = '1';
  process.env.PERSONAL_AGENT_REPO_ROOT = runtime.repoRoot;
  process.env.PERSONAL_AGENT_DESKTOP_DAEMON_LOG_FILE = `${runtime.desktopLogsDir}/daemon.log`;
}

async function ensureDesktopBackendAvailable(): Promise<boolean> {
  if (!hostManager) {
    return false;
  }

  if (backendStartupPromise) {
    return backendStartupPromise;
  }

  backendStartupPromise = (async () => {
    try {
      const status = await hostManager.getActiveHostController().getStatus();
      if (status.reachable) {
        trayController?.setStartupState({ kind: 'ready' });
        return true;
      }

      trayController?.setStartupState({ kind: 'starting' });
      await hostManager.ensureActiveHostRunning();
      trayController?.setStartupState({ kind: 'ready' });
      trayController?.refresh();
      return true;
    } catch (error) {
      reportDesktopError(error);
      return false;
    } finally {
      backendStartupPromise = undefined;
    }
  })();

  return backendStartupPromise;
}

async function withDesktopBackend(action: () => Promise<void>): Promise<void> {
  if (!windowController || !hostManager) {
    return;
  }

  if (!(await ensureDesktopBackendAvailable())) {
    return;
  }

  try {
    await action();
    trayController?.setStartupState({ kind: 'ready' });
  } catch (error) {
    reportDesktopError(error);
  }
}

async function openMainRoute(pathname = '/'): Promise<void> {
  await withDesktopBackend(async () => {
    await windowController!.openMainWindow(pathname);
  });
}

async function openNewWindow(): Promise<void> {
  await withDesktopBackend(async () => {
    await windowController!.openNewWindow();
  });
}

async function openNewConversation(): Promise<void> {
  await withDesktopBackend(async () => {
    const url = await hostManager!.openNewConversation();
    await windowController!.openAbsoluteUrl(url);
  });
}

async function openConversation(conversationId: string): Promise<void> {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return;
  }

  await openMainRoute(`/conversations/${encodeURIComponent(normalizedConversationId)}`);
}

async function switchRelativeHost(delta: 1 | -1): Promise<void> {
  if (!hostManager || !windowController) {
    return;
  }

  const route = windowController.getMainWindowRoute() || '/';
  trayController?.setStartupState({ kind: 'starting' });

  try {
    await hostManager.switchRelativeHost(delta);
    trayController?.setStartupState({ kind: 'ready' });
    trayController?.refresh();
    await windowController.openMainWindow(route);
  } catch (error) {
    reportDesktopError(error);
  }
}

async function restartActiveHost(): Promise<void> {
  if (!hostManager || !windowController) {
    return;
  }

  trayController?.setStartupState({ kind: 'starting' });

  try {
    backendStartupPromise = undefined;
    await hostManager.restartActiveHost();
    trayController?.setStartupState({ kind: 'ready' });
    trayController?.refresh();
    await windowController.openMainWindow('/');
  } catch (error) {
    reportDesktopError(error);
  }
}

async function checkForDesktopUpdates(): Promise<void> {
  try {
    await updateManager?.checkForUpdates({ userInitiated: true });
  } catch (error) {
    reportDesktopError(error);
  }
}

async function bootstrapDesktopApp(): Promise<void> {
  configureDesktopRuntimeEnvironment();
  hostManager = new HostManager();
  registerDesktopAppProtocol(hostManager);
  windowController = new DesktopWindowController(hostManager);
  updateManager = new DesktopUpdateManager();

  const shellActions = {
    onOpen: () => {
      void openMainRoute('/');
    },
    onNewWindow: () => {
      void openNewWindow();
    },
    onNewConversation: () => {
      void openNewConversation();
    },
    onCloseConversation: () => {
      windowController?.sendShortcutToFocusedWindow('close-conversation');
    },
    onReopenClosedConversation: () => {
      windowController?.sendShortcutToFocusedWindow('reopen-closed-conversation');
    },
    onPreviousConversation: () => {
      windowController?.sendShortcutToFocusedWindow('previous-conversation');
    },
    onNextConversation: () => {
      windowController?.sendShortcutToFocusedWindow('next-conversation');
    },
    onPreviousHost: () => {
      void switchRelativeHost(-1);
    },
    onNextHost: () => {
      void switchRelativeHost(1);
    },
    onToggleConversationPin: () => {
      windowController?.sendShortcutToFocusedWindow('toggle-conversation-pin');
    },
    onToggleConversationArchive: () => {
      windowController?.sendShortcutToFocusedWindow('toggle-conversation-archive');
    },
    onRenameConversation: () => {
      windowController?.sendShortcutToFocusedWindow('rename-conversation');
    },
    onFocusComposer: () => {
      windowController?.sendShortcutToFocusedWindow('focus-composer');
    },
    onEditWorkingDirectory: () => {
      windowController?.sendShortcutToFocusedWindow('edit-working-directory');
    },
    onToggleSidebar: () => {
      windowController?.sendShortcutToFocusedWindow('toggle-sidebar');
    },
    onToggleRightRail: () => {
      windowController?.sendShortcutToFocusedWindow('toggle-right-rail');
    },
    onHideWindow: () => {
      windowController?.hideFocusedWindow();
    },
    onSettings: () => {
      void openMainRoute('/settings');
    },
    onCheckForUpdates: () => {
      void updateManager?.checkForUpdates({ userInitiated: true });
    },
    onRestartRuntime: () => {
      void restartActiveHost();
    },
    onOpenLogs: () => {
      void openDesktopLogs();
    },
    onQuit: () => {
      void requestAppQuit();
    },
  };

  trayController = new DesktopTrayController({
    hostManager,
    onOpen: shellActions.onOpen,
    onOpenConversation: (conversationId) => {
      void openConversation(conversationId);
    },
    onNewConversation: shellActions.onNewConversation,
    onSettings: shellActions.onSettings,
    onCheckForUpdates: shellActions.onCheckForUpdates,
    onRestartRuntime: shellActions.onRestartRuntime,
    onOpenLogs: shellActions.onOpenLogs,
    onQuit: shellActions.onQuit,
  });
  installDesktopApplicationMenu(shellActions);

  registerDesktopIpc({
    hostManager,
    windowController,
    onHostStateChanged: () => {
      trayController?.refresh();
    },
    onCheckForUpdates: () => checkForDesktopUpdates(),
  });

  updateManager.start();

  const ready = await ensureDesktopBackendAvailable();
  if (ready && hostManager.getConfig().openWindowOnLaunch) {
    await openMainRoute('/');
  }
}

async function prepareForQuit(): Promise<void> {
  if (quitting) {
    return;
  }

  quitting = true;
  windowController?.setQuitting(true);
  updateManager?.dispose();
  trayController?.destroy();
  await hostManager?.dispose();
}

async function shutdownAndQuit(): Promise<void> {
  await prepareForQuit();
  app.quit();
}

async function requestAppQuit(): Promise<void> {
  if (quitting) {
    if (quitRequestPromise) {
      await quitRequestPromise;
    }
    return;
  }

  if (quitRequestPromise) {
    await quitRequestPromise;
    return;
  }

  quitRequestPromise = (async () => {
    try {
      const confirmed = await confirmDesktopQuit(dialog, app.name);
      if (!confirmed) {
        return;
      }

      await shutdownAndQuit();
    } finally {
      if (!quitting) {
        quitRequestPromise = null;
      }
    }
  })();

  await quitRequestPromise;
}

app.on('before-quit', (event) => {
  if (quitting) {
    return;
  }

  event.preventDefault();
  void requestAppQuit();
});

app.on('window-all-closed', () => {
  // Keep the tray app alive when the main window is closed.
});

app.on('activate', () => {
  void openMainRoute('/');
});

app.whenReady()
  .then(async () => {
    applyDesktopShellAppMode(process.platform, app);
    await bootstrapDesktopApp();
  })
  .catch((error) => {
    logBootstrapError(error);
    app.exit(1);
  });

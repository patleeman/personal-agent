import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getStateRoot } from '@personal-agent/core';
import { app, nativeImage } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import { HostManager } from './hosts/host-manager.js';
import { DesktopWindowController } from './window.js';
import { DesktopTrayController } from './tray.js';
import { registerDesktopIpc } from './ipc.js';
import { installDesktopApplicationMenu } from './menu.js';
import { DesktopUpdateManager } from './updates/update-manager.js';

let hostManager: HostManager | undefined;
let windowController: DesktopWindowController | undefined;
let trayController: DesktopTrayController | undefined;
let updateManager: DesktopUpdateManager | undefined;
let quitting = false;

app.setName('Personal Agent');

function createSvgImage(filePath: string) {
  const source = readFileSync(filePath, 'utf-8');
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
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

async function bootstrapDesktopApp(): Promise<void> {
  hostManager = new HostManager();
  windowController = new DesktopWindowController(hostManager);

  await hostManager.ensureActiveHostRunning();

  updateManager = new DesktopUpdateManager();

  const shellActions = {
    onOpen: () => {
      void windowController?.openMainWindow('/');
    },
    onNewConversation: () => {
      void hostManager?.openNewConversation().then((url) => windowController?.openAbsoluteUrl(url));
    },
    onCloseConversation: () => {
      windowController?.sendShortcutToFocusedWindow('close-conversation');
    },
    onPreviousConversation: () => {
      windowController?.sendShortcutToFocusedWindow('previous-conversation');
    },
    onNextConversation: () => {
      windowController?.sendShortcutToFocusedWindow('next-conversation');
    },
    onPreviousHost: () => {
      const route = windowController?.getMainWindowRoute() ?? '/';
      void hostManager?.switchRelativeHost(-1).then(() => {
        trayController?.refresh();
        return windowController?.openMainWindow(route);
      });
    },
    onNextHost: () => {
      const route = windowController?.getMainWindowRoute() ?? '/';
      void hostManager?.switchRelativeHost(1).then(() => {
        trayController?.refresh();
        return windowController?.openMainWindow(route);
      });
    },
    onToggleConversationPin: () => {
      windowController?.sendShortcutToFocusedWindow('toggle-conversation-pin');
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
    onConnections: () => {
      void windowController?.openMainWindow('/settings#desktop-connections');
    },
    onCheckForUpdates: () => {
      void updateManager?.checkForUpdates({ userInitiated: true });
    },
    onRestartBackend: () => {
      void hostManager?.restartActiveHost().then(() => windowController?.openMainWindow('/'));
    },
    onQuit: () => {
      void shutdownAndQuit();
    },
  };

  trayController = new DesktopTrayController({
    hostManager,
    ...shellActions,
  });
  installDesktopApplicationMenu(shellActions);

  registerDesktopIpc({
    hostManager,
    windowController,
    onHostStateChanged: () => {
      trayController?.refresh();
    },
  });

  if (hostManager.getConfig().openWindowOnLaunch) {
    await windowController.openMainWindow('/');
  }

  updateManager.start();
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

app.on('before-quit', (event) => {
  if (quitting) {
    return;
  }

  event.preventDefault();
  void shutdownAndQuit();
});

app.on('window-all-closed', () => {
  // Keep the tray app alive when the main window is closed.
});

app.on('activate', () => {
  void windowController?.openMainWindow('/');
});

app.whenReady()
  .then(async () => {
    const { colorIconFile } = resolveDesktopRuntimePaths();
    const colorIcon = createSvgImage(colorIconFile);
    if (process.platform === 'darwin') {
      app.dock?.setIcon(colorIcon);
    }
    await bootstrapDesktopApp();
  })
  .catch((error) => {
    logBootstrapError(error);
    app.exit(1);
  });

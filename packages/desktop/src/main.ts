import { app } from 'electron';
import { HostManager } from './hosts/host-manager.js';
import { DesktopWindowController } from './window.js';
import { DesktopTrayController } from './tray.js';
import { registerDesktopIpc } from './ipc.js';

let hostManager: HostManager | undefined;
let windowController: DesktopWindowController | undefined;
let trayController: DesktopTrayController | undefined;
let quitting = false;

async function bootstrapDesktopApp(): Promise<void> {
  hostManager = new HostManager();
  windowController = new DesktopWindowController(hostManager);

  await hostManager.ensureActiveHostRunning();

  trayController = new DesktopTrayController({
    hostManager,
    onOpen: () => {
      void windowController?.openMainWindow('/');
    },
    onNewConversation: () => {
      void hostManager?.openNewConversation().then((url) => windowController?.openAbsoluteUrl(url));
    },
    onConnections: () => {
      void windowController?.openMainWindow('/settings');
    },
    onRestartBackend: () => {
      void hostManager?.restartActiveHost().then(() => windowController?.openMainWindow('/'));
    },
    onQuit: () => {
      void shutdownAndQuit();
    },
  });

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
}

async function shutdownAndQuit(): Promise<void> {
  if (quitting) {
    return;
  }

  quitting = true;
  windowController?.setQuitting(true);
  trayController?.destroy();
  await hostManager?.dispose();
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
    await bootstrapDesktopApp();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  });

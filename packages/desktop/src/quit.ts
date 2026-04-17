import type { MessageBoxOptions } from 'electron';

export interface DesktopQuitDialogLike {
  showMessageBox(options: MessageBoxOptions): Promise<{ response: number }>;
}

export interface DesktopQuitConfirmationBehavior {
  keepsExternalDaemonRunning?: boolean;
}

function buildDesktopQuitDetail(behavior: DesktopQuitConfirmationBehavior): string {
  if (behavior.keepsExternalDaemonRunning) {
    return 'Closing the window only hides it. Quitting closes the menu bar app, but an external daemon will keep running for automations until you stop it separately.';
  }

  return 'Closing the window only hides it. Quitting closes the menu bar app and stops the local runtime until you reopen it.';
}

export function buildDesktopQuitConfirmationOptions(
  appName = 'Personal Agent',
  icon?: string,
  behavior: DesktopQuitConfirmationBehavior = {},
): MessageBoxOptions {
  return {
    type: 'question',
    buttons: ['Cancel', `Quit ${appName}`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: `Quit ${appName}?`,
    detail: buildDesktopQuitDetail(behavior),
    ...(icon ? { icon } : {}),
  };
}

export async function confirmDesktopQuit(
  dialogLike: DesktopQuitDialogLike,
  appName = 'Personal Agent',
  icon?: string,
  behavior: DesktopQuitConfirmationBehavior = {},
): Promise<boolean> {
  const response = await dialogLike.showMessageBox(buildDesktopQuitConfirmationOptions(appName, icon, behavior));
  return response.response === 1;
}

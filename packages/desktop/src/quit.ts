import type { MessageBoxOptions } from 'electron';

export interface DesktopQuitDialogLike {
  showMessageBox(options: MessageBoxOptions): Promise<{ response: number }>;
}

export function buildDesktopQuitConfirmationOptions(appName = 'Personal Agent'): MessageBoxOptions {
  return {
    type: 'question',
    buttons: ['Cancel', `Quit ${appName}`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: `Quit ${appName}?`,
    detail: 'Closing the window only hides it. Quitting closes the menu bar app and stops the local runtime until you reopen it.',
  };
}

export async function confirmDesktopQuit(dialogLike: DesktopQuitDialogLike, appName = 'Personal Agent'): Promise<boolean> {
  const response = await dialogLike.showMessageBox(buildDesktopQuitConfirmationOptions(appName));
  return response.response === 1;
}

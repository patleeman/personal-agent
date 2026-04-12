import { describe, expect, it, vi } from 'vitest';
import { buildDesktopQuitConfirmationOptions, confirmDesktopQuit } from './quit.js';

describe('buildDesktopQuitConfirmationOptions', () => {
  it('builds a conservative quit confirmation for the menu bar app', () => {
    expect(buildDesktopQuitConfirmationOptions('Personal Agent')).toEqual({
      type: 'question',
      buttons: ['Cancel', 'Quit Personal Agent'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: 'Quit Personal Agent?',
      detail: 'Closing the window only hides it. Quitting closes the menu bar app and stops the local runtime until you reopen it.',
    });
  });
});

describe('confirmDesktopQuit', () => {
  it('returns true when the user confirms the quit action', async () => {
    const dialogLike = {
      showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
    };

    await expect(confirmDesktopQuit(dialogLike, 'Personal Agent')).resolves.toBe(true);
    expect(dialogLike.showMessageBox).toHaveBeenCalledWith(buildDesktopQuitConfirmationOptions('Personal Agent'));
  });

  it('returns false when the user cancels the quit action', async () => {
    const dialogLike = {
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    };

    await expect(confirmDesktopQuit(dialogLike, 'Personal Agent')).resolves.toBe(false);
  });
});

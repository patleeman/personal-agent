import { describe, expect, it, vi } from 'vitest';
import { buildDesktopQuitConfirmationOptions, confirmDesktopQuit, hasDesktopQuitConfirmationBypassArg, shouldSkipDesktopQuitConfirmation } from './quit.js';

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

  it('mentions an external daemon when the desktop app is attached to one', () => {
    expect(buildDesktopQuitConfirmationOptions('Personal Agent', undefined, {
      keepsExternalDaemonRunning: true,
    })).toEqual({
      type: 'question',
      buttons: ['Cancel', 'Quit Personal Agent'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: 'Quit Personal Agent?',
      detail: 'Closing the window only hides it. Quitting closes the menu bar app, but an external daemon will keep running for automations until you stop it separately.',
    });
  });

  it('includes the app icon when one is provided', () => {
    expect(buildDesktopQuitConfirmationOptions('Personal Agent', '/tmp/personal-agent-icon.png')).toEqual({
      type: 'question',
      buttons: ['Cancel', 'Quit Personal Agent'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: 'Quit Personal Agent?',
      detail: 'Closing the window only hides it. Quitting closes the menu bar app and stops the local runtime until you reopen it.',
      icon: '/tmp/personal-agent-icon.png',
    });
  });
});

describe('hasDesktopQuitConfirmationBypassArg', () => {
  it('recognizes explicit launch flags', () => {
    expect(hasDesktopQuitConfirmationBypassArg(['node', 'main.js', '--no-quit-confirmation'])).toBe(true);
    expect(hasDesktopQuitConfirmationBypassArg(['node', 'main.js', '--skip-quit-confirmation'])).toBe(true);
    expect(hasDesktopQuitConfirmationBypassArg(['node', 'main.js'])).toBe(false);
  });
});

describe('shouldSkipDesktopQuitConfirmation', () => {
  it('recognizes explicit opt-out environment flags', () => {
    expect(shouldSkipDesktopQuitConfirmation({ PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION: '1' })).toBe(true);
    expect(shouldSkipDesktopQuitConfirmation({ PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION: ' true ' })).toBe(true);
    expect(shouldSkipDesktopQuitConfirmation({ PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION: 'yes' })).toBe(true);
    expect(shouldSkipDesktopQuitConfirmation({ PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION: '0' })).toBe(false);
  });

  it('recognizes launch arguments too', () => {
    expect(shouldSkipDesktopQuitConfirmation({}, ['node', 'main.js', '--no-quit-confirmation'])).toBe(true);
    expect(shouldSkipDesktopQuitConfirmation({}, ['node', 'main.js', '--skip-quit-confirmation'])).toBe(true);
  });
});

describe('confirmDesktopQuit', () => {
  it('returns true when the user confirms the quit action', async () => {
    const dialogLike = {
      showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
    };

    await expect(confirmDesktopQuit(dialogLike, 'Personal Agent', '/tmp/personal-agent-icon.png')).resolves.toBe(true);
    expect(dialogLike.showMessageBox).toHaveBeenCalledWith(buildDesktopQuitConfirmationOptions('Personal Agent', '/tmp/personal-agent-icon.png'));
  });

  it('returns false when the user cancels the quit action', async () => {
    const dialogLike = {
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    };

    await expect(confirmDesktopQuit(dialogLike, 'Personal Agent')).resolves.toBe(false);
  });

  it('passes external-daemon context through to the dialog options', async () => {
    const dialogLike = {
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    };

    await expect(confirmDesktopQuit(dialogLike, 'Personal Agent', undefined, {
      keepsExternalDaemonRunning: true,
    })).resolves.toBe(false);
    expect(dialogLike.showMessageBox).toHaveBeenCalledWith(buildDesktopQuitConfirmationOptions('Personal Agent', undefined, {
      keepsExternalDaemonRunning: true,
    }));
  });

  it('skips the dialog entirely when the launch disables quit confirmation', async () => {
    const previous = process.env.PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION;
    process.env.PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION = '1';

    try {
      const dialogLike = {
        showMessageBox: vi.fn(),
      };

      await expect(confirmDesktopQuit(dialogLike, 'Personal Agent')).resolves.toBe(true);
      expect(dialogLike.showMessageBox).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION;
      } else {
        process.env.PERSONAL_AGENT_DESKTOP_SKIP_QUIT_CONFIRMATION = previous;
      }
    }
  });
});

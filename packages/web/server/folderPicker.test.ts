import { describe, expect, it } from 'vitest';
import {
  buildFolderPickerInvocation,
  interpretFolderPickerProcessResult,
} from './folderPicker.js';

describe('buildFolderPickerInvocation', () => {
  it('builds an AppleScript folder picker on macOS', () => {
    const invocation = buildFolderPickerInvocation({
      platform: 'darwin',
      initialDirectory: '/Users/patrick/project',
      prompt: 'Choose working directory',
      directoryExists: () => true,
    });

    expect(invocation.command).toBe('osascript');
    expect(invocation.args.join(' ')).toContain('choose folder');
    expect(invocation.args.join(' ')).toContain('/Users/patrick/project/');
  });

  it('builds a zenity folder picker on linux when available', () => {
    const invocation = buildFolderPickerInvocation({
      platform: 'linux',
      initialDirectory: '/tmp/project',
      hasCommand: (command) => command === 'zenity',
      directoryExists: () => true,
    });

    expect(invocation.command).toBe('zenity');
    expect(invocation.args).toContain('--directory');
    expect(invocation.args).toContain('--filename=/tmp/project/');
  });

  it('falls back to kdialog on linux when zenity is unavailable', () => {
    const invocation = buildFolderPickerInvocation({
      platform: 'linux',
      initialDirectory: '/tmp/project',
      hasCommand: (command) => command === 'kdialog',
      directoryExists: () => true,
    });

    expect(invocation.command).toBe('kdialog');
    expect(invocation.args[0]).toBe('--getexistingdirectory');
    expect(invocation.args[1]).toBe('/tmp/project');
  });

  it('throws when no linux folder picker is available', () => {
    expect(() => buildFolderPickerInvocation({
      platform: 'linux',
      hasCommand: () => false,
    })).toThrow('No supported folder picker found');
  });

  it('builds a PowerShell folder picker on windows', () => {
    const invocation = buildFolderPickerInvocation({
      platform: 'win32',
      initialDirectory: 'C:/Users/patrick/project',
      directoryExists: () => true,
    });

    expect(invocation.command).toBe('powershell');
    expect(invocation.args.join(' ')).toContain('FolderBrowserDialog');
    expect(invocation.args.join(' ')).toContain('C:/Users/patrick/project');
  });
});

describe('interpretFolderPickerProcessResult', () => {
  it('returns the selected path', () => {
    expect(interpretFolderPickerProcessResult({
      status: 0,
      stdout: '/tmp/project\n',
      stderr: '',
    })).toEqual({ path: '/tmp/project', cancelled: false });
  });

  it('treats an empty successful result as a cancellation', () => {
    expect(interpretFolderPickerProcessResult({
      status: 0,
      stdout: '',
      stderr: '',
    })).toEqual({ path: null, cancelled: true });
  });

  it('treats cancel-like failures as cancellations', () => {
    expect(interpretFolderPickerProcessResult({
      status: 1,
      stdout: '',
      stderr: 'User canceled.',
    })).toEqual({ path: null, cancelled: true });
  });

  it('throws on real picker failures', () => {
    expect(() => interpretFolderPickerProcessResult({
      status: 2,
      stdout: '',
      stderr: 'dialog backend exploded',
    })).toThrow('dialog backend exploded');
  });
});

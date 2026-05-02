import { describe, expect, it, vi } from 'vitest';
import {
  buildFilePickerInvocation,
  interpretFilePickerProcessResult,
} from './filePicker.js';

describe('buildFilePickerInvocation', () => {
  describe('macOS (darwin)', () => {
    it('builds osascript invocation with initial directory', () => {
      const result = buildFilePickerInvocation({
        platform: 'darwin',
        initialDirectory: '/Users/test',
        prompt: 'Pick files',
        directoryExists: () => true,
      });
      expect(result.command).toBe('osascript');
      const joined = result.args.join(' ');
      expect(joined).toContain('POSIX file "/Users/test/"');
    });

    it('builds osascript invocation without initial directory', () => {
      const result = buildFilePickerInvocation({ platform: 'darwin' });
      expect(result.command).toBe('osascript');
      expect(result.args.join(' ')).not.toContain('default location');
    });

    it('escapes special characters in prompt and path', () => {
      const result = buildFilePickerInvocation({
        platform: 'darwin',
        initialDirectory: '/Users/t"es\'t',
        prompt: 'Pick "my" files',
        directoryExists: () => true,
      });
      const joined = result.args.join(' ');
      expect(joined).toContain('Pick \\"my\\" files');
    });
  });

  describe('Linux', () => {
    it('builds zenity invocation when zenity is available', () => {
      const result = buildFilePickerInvocation({
        platform: 'linux',
        hasCommand: (cmd: string) => cmd === 'zenity',
        prompt: 'Select files',
      });
      expect(result.command).toBe('zenity');
      expect(result.args).toContain('--file-selection');
      expect(result.args).toContain('--multiple');
    });

    it('builds kdialog invocation when only kdialog is available', () => {
      const result = buildFilePickerInvocation({
        platform: 'linux',
        hasCommand: (cmd: string) => cmd === 'kdialog',
        prompt: 'Choose files',
        initialDirectory: '/home/user',
        directoryExists: () => true,
      });
      expect(result.command).toBe('kdialog');
    });

    it('throws when no file picker is available', () => {
      expect(() => buildFilePickerInvocation({
        platform: 'linux',
        hasCommand: () => false,
      })).toThrow('No supported file picker found');
    });
  });

  describe('Windows', () => {
    it('builds PowerShell invocation', () => {
      const result = buildFilePickerInvocation({
        platform: 'win32',
        prompt: 'Open files',
      });
      expect(result.command).toBe('powershell');
      const script = result.args[result.args.length - 1];
      expect(script).toContain('OpenFileDialog');
      expect(script).toContain('$dialog.Multiselect = $true');
    });

    it('escapes single quotes in PowerShell script', () => {
      const result = buildFilePickerInvocation({
        platform: 'win32',
        prompt: "User's files",
      });
      const script = result.args[result.args.length - 1];
      expect(script).toContain("User''s files");
    });
  });

  describe('unsupported platforms', () => {
    it('throws for unsupported platforms', () => {
      expect(() => buildFilePickerInvocation({
        platform: 'sunos' as NodeJS.Platform,
      })).toThrow('File picker is not supported on platform sunos');
    });
  });

  describe('initial directory handling', () => {
    it('skips initial directory when it does not exist', () => {
      const result = buildFilePickerInvocation({
        platform: 'darwin',
        initialDirectory: '/nonexistent',
        directoryExists: () => false,
      });
      expect(result.args.join(' ')).not.toContain('default location');
    });

    it('skips initial directory when empty', () => {
      const result = buildFilePickerInvocation({
        platform: 'darwin',
        initialDirectory: '   ',
      });
      expect(result.args.join(' ')).not.toContain('default location');
    });
  });
});

describe('interpretFilePickerProcessResult', () => {
  it('returns selected paths from non-empty stdout', () => {
    const result = interpretFilePickerProcessResult({
      status: 0,
      stdout: '/path/a\n/path/b\n',
      stderr: '',
    });
    expect(result).toEqual({ paths: ['/path/a', '/path/b'], cancelled: false });
  });

  it('returns cancelled when stdout is empty and status is 0', () => {
    const result = interpretFilePickerProcessResult({ status: 0, stdout: '', stderr: '' });
    expect(result).toEqual({ paths: [], cancelled: true });
  });

  it('returns cancelled when stderr mentions cancel', () => {
    const result = interpretFilePickerProcessResult({
      status: 1, stdout: '', stderr: 'user cancelled',
    });
    expect(result).toEqual({ paths: [], cancelled: true });
  });

  it('returns cancelled when status is 1 and stderr is empty', () => {
    const result = interpretFilePickerProcessResult({
      status: 1, stdout: '', stderr: '',
    });
    expect(result).toEqual({ paths: [], cancelled: true });
  });

  it('throws on process error', () => {
    expect(() => interpretFilePickerProcessResult({
      status: null, stdout: '', stderr: '', error: new Error('ENOENT'),
    })).toThrow('ENOENT');
  });

  it('throws on unknown error with non-empty stderr', () => {
    expect(() => interpretFilePickerProcessResult({
      status: 2, stdout: '', stderr: 'permission denied',
    })).toThrow('permission denied');
  });
});

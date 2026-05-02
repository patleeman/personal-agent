import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface FilePickerInvocation {
  command: string;
  args: string[];
}

export interface FilePickerResult {
  paths: string[];
  cancelled: boolean;
}

export interface FilePickerProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function normalizeInitialDirectory(initialDirectory?: string): string | undefined {
  const trimmed = initialDirectory?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

export function buildFilePickerInvocation(input: {
  platform?: NodeJS.Platform;
  initialDirectory?: string;
  prompt?: string;
  hasCommand?: (command: string) => boolean;
  directoryExists?: (path: string) => boolean;
}): FilePickerInvocation {
  const platform = input.platform ?? process.platform;
  const prompt = input.prompt ?? 'Choose instruction files';
  const directoryExists = input.directoryExists ?? existsSync;
  const normalizedInitialDirectory = normalizeInitialDirectory(input.initialDirectory);
  const initialDirectory = normalizedInitialDirectory && directoryExists(normalizedInitialDirectory)
    ? normalizedInitialDirectory
    : undefined;
  const hasCommand = input.hasCommand ?? ((command: string) => spawnSync('which', [command], { stdio: 'ignore' }).status === 0);

  if (platform === 'darwin') {
    const promptLiteral = escapeAppleScriptString(prompt);
    const args = initialDirectory
      ? [
          '-e',
          `set chosenFiles to choose file with prompt "${promptLiteral}" default location POSIX file "${escapeAppleScriptString(ensureTrailingSlash(initialDirectory))}" with multiple selections allowed`,
          '-e',
          'set outputLines to {}',
          '-e',
          'repeat with chosenFile in chosenFiles',
          '-e',
          'set end of outputLines to POSIX path of chosenFile',
          '-e',
          'end repeat',
          '-e',
          'set AppleScript\'s text item delimiters to linefeed',
          '-e',
          'outputLines as text',
        ]
      : [
          '-e',
          `set chosenFiles to choose file with prompt "${promptLiteral}" with multiple selections allowed`,
          '-e',
          'set outputLines to {}',
          '-e',
          'repeat with chosenFile in chosenFiles',
          '-e',
          'set end of outputLines to POSIX path of chosenFile',
          '-e',
          'end repeat',
          '-e',
          'set AppleScript\'s text item delimiters to linefeed',
          '-e',
          'outputLines as text',
        ];

    return { command: 'osascript', args };
  }

  if (platform === 'linux') {
    if (hasCommand('zenity')) {
      return {
        command: 'zenity',
        args: [
          '--file-selection',
          '--multiple',
          '--separator=\n',
          `--title=${prompt}`,
          ...(initialDirectory ? [`--filename=${ensureTrailingSlash(initialDirectory)}`] : []),
        ],
      };
    }

    if (hasCommand('kdialog')) {
      return {
        command: 'kdialog',
        args: [
          '--getopenfilename',
          initialDirectory ?? '',
          '--multiple',
          '--separate-output',
          '--title',
          prompt,
        ],
      };
    }

    throw new Error('No supported file picker found. Install zenity or kdialog, or enter the paths manually.');
  }

  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
      `$dialog.Title = '${escapePowerShellString(prompt)}'`,
      '$dialog.Multiselect = $true',
      ...(initialDirectory ? [`$dialog.InitialDirectory = '${escapePowerShellString(initialDirectory)}'`] : []),
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::Out.Write(($dialog.FileNames -join "`n"))',
      '}',
    ].join('; ');

    return {
      command: 'powershell',
      args: ['-NoProfile', '-STA', '-Command', script],
    };
  }

  throw new Error(`File picker is not supported on platform ${platform}. Enter the paths manually.`);
}

export function interpretFilePickerProcessResult(result: FilePickerProcessResult): FilePickerResult {
  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const paths = stdout
    ? stdout.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : [];

  if (paths.length > 0) {
    return { paths, cancelled: false };
  }

  if (result.status === 0) {
    return { paths: [], cancelled: true };
  }

  const combined = `${stdout}\n${stderr}`.toLowerCase();
  if (combined.includes('cancel')) {
    return { paths: [], cancelled: true };
  }

  if (result.status === 1 && stderr.length === 0) {
    return { paths: [], cancelled: true };
  }

  throw new Error(stderr || `File picker exited with status ${result.status ?? 'unknown'}.`);
}

export function pickFiles(input: {
  initialDirectory?: string;
  prompt?: string;
} = {}): FilePickerResult {
  const invocation = buildFilePickerInvocation(input);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf-8',
  });

  return interpretFilePickerProcessResult({
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  });
}

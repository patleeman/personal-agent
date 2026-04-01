import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface FolderPickerInvocation {
  command: string;
  args: string[];
}

export interface FolderPickerResult {
  path: string | null;
  cancelled: boolean;
}

export interface FolderPickerProcessResult {
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

export function buildFolderPickerInvocation(input: {
  platform?: NodeJS.Platform;
  initialDirectory?: string;
  prompt?: string;
  hasCommand?: (command: string) => boolean;
  directoryExists?: (path: string) => boolean;
}): FolderPickerInvocation {
  const platform = input.platform ?? process.platform;
  const prompt = input.prompt ?? 'Choose working directory';
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
          `set chosenFolder to choose folder with prompt "${promptLiteral}" default location POSIX file "${escapeAppleScriptString(ensureTrailingSlash(initialDirectory))}"`,
          '-e',
          'POSIX path of chosenFolder',
        ]
      : [
          '-e',
          `set chosenFolder to choose folder with prompt "${promptLiteral}"`,
          '-e',
          'POSIX path of chosenFolder',
        ];

    return { command: 'osascript', args };
  }

  if (platform === 'linux') {
    if (hasCommand('zenity')) {
      return {
        command: 'zenity',
        args: [
          '--file-selection',
          '--directory',
          `--title=${prompt}`,
          ...(initialDirectory ? [`--filename=${ensureTrailingSlash(initialDirectory)}`] : []),
        ],
      };
    }

    if (hasCommand('kdialog')) {
      return {
        command: 'kdialog',
        args: [
          '--getexistingdirectory',
          initialDirectory ?? '',
          '--title',
          prompt,
        ],
      };
    }

    throw new Error('No supported folder picker found. Install zenity or kdialog, or enter the path manually.');
  }

  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$dialog.Description = '${escapePowerShellString(prompt)}'`,
      '$dialog.ShowNewFolderButton = $false',
      ...(initialDirectory ? [`$dialog.SelectedPath = '${escapePowerShellString(initialDirectory)}'`] : []),
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::Out.Write($dialog.SelectedPath)',
      '}',
    ].join('; ');

    return {
      command: 'powershell',
      args: ['-NoProfile', '-STA', '-Command', script],
    };
  }

  throw new Error(`Folder picker is not supported on platform ${platform}. Enter the path manually.`);
}

export function interpretFolderPickerProcessResult(result: FolderPickerProcessResult): FolderPickerResult {
  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (stdout) {
    return { path: stdout, cancelled: false };
  }

  if (result.status === 0) {
    return { path: null, cancelled: true };
  }

  const combined = `${stdout}\n${stderr}`.toLowerCase();
  if (combined.includes('cancel')) {
    return { path: null, cancelled: true };
  }

  if (result.status === 1 && stderr.length === 0) {
    return { path: null, cancelled: true };
  }

  throw new Error(stderr || `Folder picker exited with status ${result.status ?? 'unknown'}.`);
}

export function pickFolder(input: {
  initialDirectory?: string;
  prompt?: string;
} = {}): FolderPickerResult {
  const invocation = buildFolderPickerInvocation(input);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf-8',
  });

  return interpretFolderPickerProcessResult({
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  });
}

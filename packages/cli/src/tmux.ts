import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const PA_TMUX_MANAGED_OPTION = '@pa_agent_session';
export const PA_TMUX_TASK_OPTION = '@pa_agent_task';
export const PA_TMUX_LOG_OPTION = '@pa_agent_log';
export const PA_TMUX_COMMAND_OPTION = '@pa_agent_cmd';
export const PA_TMUX_NOTIFY_ON_COMPLETE_OPTION = '@pa_agent_notify_on_complete';
export const PA_TMUX_NOTIFY_CONTEXT_OPTION = '@pa_agent_notify_context';
export const PA_TMUX_WORKSPACE_OPTION = '@pa_workspace';
export const PA_TMUX_PROFILE_OPTION = '@pa_profile';
export const PA_TMUX_CWD_OPTION = '@pa_cwd';
export const PERSONAL_AGENT_TMUX_WORKSPACE_ENV = 'PERSONAL_AGENT_TMUX_WORKSPACE';
export const PERSONAL_AGENT_TMUX_SESSION_ENV = 'PERSONAL_AGENT_TMUX_SESSION';
export const PERSONAL_AGENT_TMUX_SOCKET_ENV = 'PERSONAL_AGENT_TMUX_SOCKET';

const DEFAULT_PA_TMUX_SOCKET = 'pa';
const PA_TMUX_CONFIG_FILE = 'workspace.tmux.conf';
const PA_TMUX_WORKSPACE_KEY_TABLE = 'pa-workspace';
const PA_TMUX_REPEAT_TIME_MS = 1000;

const LIST_SESSIONS_FORMAT = [
  '#{session_name}',
  '#{session_id}',
  '#{session_windows}',
  '#{session_attached}',
  '#{session_created}',
  `#{${PA_TMUX_MANAGED_OPTION}}`,
  `#{${PA_TMUX_TASK_OPTION}}`,
  `#{${PA_TMUX_LOG_OPTION}}`,
  `#{${PA_TMUX_COMMAND_OPTION}}`,
  `#{${PA_TMUX_NOTIFY_ON_COMPLETE_OPTION}}`,
  `#{${PA_TMUX_NOTIFY_CONTEXT_OPTION}}`,
].join('\t');

interface TmuxCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type TmuxRunner = (args: string[]) => TmuxCommandResult;

export interface ManagedTmuxSession {
  name: string;
  id: string;
  windows: number;
  attachedClients: number;
  createdEpochSeconds: number | null;
  createdAt: string | null;
  task: string | null;
  logPath: string | null;
  command: string | null;
  notifyOnComplete?: boolean;
  notifyContext?: string | null;
}

export interface StartManagedTmuxSessionOptions {
  sessionName: string;
  cwd: string;
  command: string;
  task?: string;
  logPath?: string;
  sourceCommand?: string;
  notifyOnComplete?: boolean;
  notifyContext?: string;
}

export interface OpenManagedTmuxLogPaneOptions {
  targetPane: string;
  sessionName: string;
  logPath: string;
  title?: string;
}

function resolveStateRoot(): string {
  if (process.env.PERSONAL_AGENT_STATE_ROOT) {
    return process.env.PERSONAL_AGENT_STATE_ROOT;
  }

  if (process.env.XDG_STATE_HOME) {
    return join(process.env.XDG_STATE_HOME, 'personal-agent');
  }

  return join(homedir(), '.local', 'state', 'personal-agent');
}

function resolvePaTmuxConfigPath(): string {
  return join(resolveStateRoot(), 'tmux', PA_TMUX_CONFIG_FILE);
}

export function resolvePaTmuxSocketName(): string {
  const configured = process.env.PERSONAL_AGENT_TMUX_SOCKET_NAME?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_PA_TMUX_SOCKET;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildPressAnyKeyScript(body: string): string {
  return [
    body,
    '',
    "printf '\\nPress any key to close...'",
    'stty -echo -icanon time 0 min 1',
    'dd bs=1 count=1 >/dev/null 2>&1',
  ].join('\n');
}

function buildHelpPopupCommand(): string {
  const helpText = [
    'PA Workspace',
    '============',
    '',
    'Hotkey: Ctrl+Space',
    '',
    'Pane management',
    '  -   split below',
    '  |   split right',
    '  h/j/k/l move focus left/down/up/right',
    '  H/J/K/L resize pane left/down/up/right (repeat for 1s)',
    '  Tab cycle to previous pane',
    '  z   zoom/unzoom pane',
    '  w   close pane (with confirmation)',
    '',
    'Window switching',
    '  [   previous window',
    '  ]   next window',
    '  1-9 switch to window 1-9',
    '',
    'Workspace helpers',
    '  ?   open this shortcut helper',
    '  t   show managed tmux tasks',
    '  n   new tmux window in current directory',
    '  r   reload PA tmux config',
  ].join('\n');

  const script = buildPressAnyKeyScript(`cat <<'EOF'\n${helpText}\nEOF`);
  return `sh -lc ${shellQuote(script)}`;
}

function buildManagedTasksPopupCommand(): string {
  const script = buildPressAnyKeyScript([
    'if command -v pa >/dev/null 2>&1; then',
    '  pa --plain tmux list',
    'else',
    `  printf '%s\\n' ${shellQuote('pa is not available on PATH inside this workspace.')}`,
    'fi',
  ].join('\n'));

  return `sh -lc ${shellQuote(script)}`;
}

function buildWorkspaceHintText(): string {
  return [
    'PA workspace',
    '? help',
    't tasks',
    '- | split',
    'h/j/k/l move',
    'H/J/K/L resize',
    '[ ] windows',
    '1-9 switch',
    'Tab prev',
    'z zoom',
    'w close',
    'n new',
    'r reload',
  ].join(' • ');
}

function buildWorkspaceBindings(
  configPath: string,
  helpPopupCommand: string,
  managedTasksPopupCommand: string,
): string[] {
  const workspaceHintText = buildWorkspaceHintText();
  const windowBindings = Array.from({ length: 9 }, (_, index) => {
    const windowNumber = String(index + 1);
    return `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} ${windowNumber} select-window -t :${windowNumber}`;
  });

  return [
    `bind-key -n C-Space display-message -d ${PA_TMUX_REPEAT_TIME_MS} ${shellQuote(workspaceHintText)} \\; switch-client -T ${PA_TMUX_WORKSPACE_KEY_TABLE}`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} ? display-popup -w 70% -h 70% -E ${shellQuote(helpPopupCommand)}`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} t display-popup -w 80% -h 70% -E ${shellQuote(managedTasksPopupCommand)}`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} '-' split-window -v -c '#{pane_current_path}'`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} '|' split-window -h -c '#{pane_current_path}'`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} h select-pane -L`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} j select-pane -D`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} k select-pane -U`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} l select-pane -R`,
    `bind-key -r -T ${PA_TMUX_WORKSPACE_KEY_TABLE} H resize-pane -L 5`,
    `bind-key -r -T ${PA_TMUX_WORKSPACE_KEY_TABLE} J resize-pane -D 5`,
    `bind-key -r -T ${PA_TMUX_WORKSPACE_KEY_TABLE} K resize-pane -U 5`,
    `bind-key -r -T ${PA_TMUX_WORKSPACE_KEY_TABLE} L resize-pane -R 5`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} Tab last-pane`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} z resize-pane -Z`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} w confirm-before -p "kill-pane #P? (y/n)" kill-pane`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} n new-window -c '#{pane_current_path}'`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} '[' previous-window`,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} ']' next-window`,
    ...windowBindings,
    `bind-key -T ${PA_TMUX_WORKSPACE_KEY_TABLE} r source-file ${shellQuote(configPath)} \\; display-message ${shellQuote('Reloaded PA tmux config')}`,
  ];
}

function buildPaTmuxConfig(): string {
  const configPath = resolvePaTmuxConfigPath();
  const helpPopupCommand = buildHelpPopupCommand();
  const managedTasksPopupCommand = buildManagedTasksPopupCommand();
  const workspaceBindings = buildWorkspaceBindings(
    configPath,
    helpPopupCommand,
    managedTasksPopupCommand,
  );

  return [
    'set -g default-terminal "tmux-256color"',
    'set -g extended-keys on',
    'set -g extended-keys-format csi-u',
    "set -g terminal-features[98] '*:RGB'",
    "set -g terminal-features[99] 'xterm*:extkeys'",
    'set -g focus-events on',
    'set -g mouse on',
    'set -g initial-repeat-time 1000',
    'set -g repeat-time 1000',
    'unbind-key C-b',
    'unbind-key -n C-Space',
    'set -g prefix None',
    'set -g renumber-windows on',
    'set -g base-index 1',
    'setw -g pane-base-index 1',
    'set -g set-titles on',
    'set -g allow-rename off',
    'set -g status on',
    'set -g status-position top',
    'set -g status-interval 2',
    'set -g status-left-length 16',
    'set -g status-right-length 80',
    'set -g status-style fg=colour255,bg=colour236',
    'set -g window-status-separator ""',
    'set -g window-status-style fg=colour250,bg=colour236',
    'set -g window-status-format "#[fg=colour250,bg=colour236] #I:#W#{?window_flags, #{window_flags},} "',
    'set -g window-status-current-style fg=colour231,bg=colour25,bold',
    'set -g window-status-current-format "#[fg=colour231,bg=colour25,bold] #I:#W#{?window_flags, #{window_flags},} "',
    'set -g window-status-activity-style fg=colour223,bg=colour236,bold',
    'set -g message-style fg=colour255,bg=colour24',
    'set -g message-command-style fg=colour255,bg=colour24',
    'set -g pane-border-style fg=colour240',
    'set -g pane-active-border-style fg=colour39',
    'set -g popup-style bg=colour234,fg=colour252',
    'set -g popup-border-style fg=colour39',
    'set -g menu-style bg=colour234,fg=colour252',
    'set -g menu-selected-style bg=colour39,fg=colour231,bold',
    'set -g status-left "#[fg=colour231,bg=colour25,bold] PA #[default]"',
    'set -g status-right "#[fg=colour244]Ctrl+Space #[fg=colour252]shortcuts#{?#{@pa_profile}, #[fg=colour244]│ #[fg=colour252]#{@pa_profile},}"',
    'setw -g pane-border-status top',
    'setw -g pane-border-format "#{?pane_active,#[fg=colour46]●,#[fg=colour240]○} #[default]#P #{?pane_title,#{pane_title},#{pane_current_command}}"',
    ...workspaceBindings,
    '',
  ].join('\n');
}

export function ensurePaTmuxConfig(): string {
  const configPath = resolvePaTmuxConfigPath();
  const nextConfig = buildPaTmuxConfig();
  const directory = join(resolveStateRoot(), 'tmux');

  mkdirSync(directory, { recursive: true });

  const currentConfig = existsSync(configPath)
    ? readFileSync(configPath, 'utf-8')
    : undefined;

  if (currentConfig !== nextConfig) {
    writeFileSync(configPath, nextConfig);
  }

  return configPath;
}

export function withPaTmuxCliArgs(args: string[]): string[] {
  return ['-L', resolvePaTmuxSocketName(), '-f', ensurePaTmuxConfig(), ...args];
}

export function createSpawnSyncTmuxRunner(): TmuxRunner {
  return (args) => {
    const result = spawnSync('tmux', withPaTmuxCliArgs(args), {
      encoding: 'utf-8',
    });

    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error,
    };
  };
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function tmuxMissingError(result: TmuxCommandResult): boolean {
  if (!result.error) {
    return false;
  }

  const code = (result.error as NodeJS.ErrnoException).code;
  return code === 'ENOENT';
}

function noServerRunning(result: TmuxCommandResult): boolean {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();

  return combined.includes('no server running')
    || combined.includes('failed to connect to server')
    || combined.includes('error connecting to');
}

function throwTmuxFailure(args: string[], result: TmuxCommandResult): never {
  if (tmuxMissingError(result)) {
    throw new Error('tmux is not installed or not available on PATH.');
  }

  const detail = normalizeOutput(result.stderr || result.stdout) || `exit code ${String(result.status ?? '?')}`;
  throw new Error(`tmux ${args.join(' ')} failed: ${detail}`);
}

function parseNumeric(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseManagedSessionLine(line: string): ManagedTmuxSession | null {
  if (line.trim().length === 0) {
    return null;
  }

  const parts = line.split('\t');

  const name = parts[0]?.trim() ?? '';
  const id = parts[1]?.trim() ?? '';
  const windowsRaw = parts[2]?.trim() ?? '0';
  const attachedRaw = parts[3]?.trim() ?? '0';
  const createdRaw = parts[4]?.trim() ?? '';
  const managedRaw = parts[5]?.trim() ?? '';
  const taskRaw = parts[6] ?? '';
  const logPathRaw = parts[7] ?? '';
  const commandRaw = parts[8] ?? '';
  const notifyOnCompleteRaw = parts[9]?.trim() ?? '';
  const notifyContextRaw = parts[10] ?? '';

  if (managedRaw !== '1' || name.length === 0) {
    return null;
  }

  const createdEpochSeconds = Number.parseInt(createdRaw, 10);
  const hasCreated = Number.isFinite(createdEpochSeconds);

  return {
    name,
    id,
    windows: parseNumeric(windowsRaw),
    attachedClients: parseNumeric(attachedRaw),
    createdEpochSeconds: hasCreated ? createdEpochSeconds : null,
    createdAt: hasCreated ? new Date(createdEpochSeconds * 1000).toISOString() : null,
    task: toNullableString(taskRaw),
    logPath: toNullableString(logPathRaw),
    command: toNullableString(commandRaw),
    notifyOnComplete: notifyOnCompleteRaw === '1' || notifyOnCompleteRaw.toLowerCase() === 'true',
    notifyContext: toNullableString(notifyContextRaw),
  };
}

export function listManagedTmuxSessions(runner: TmuxRunner = createSpawnSyncTmuxRunner()): ManagedTmuxSession[] {
  const args = ['list-sessions', '-F', LIST_SESSIONS_FORMAT];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    if (noServerRunning(result)) {
      return [];
    }

    throwTmuxFailure(args, result);
  }

  const lines = normalizeOutput(result.stdout)
    .split('\n')
    .filter((line) => line.trim().length > 0);

  const sessions = lines
    .map((line) => parseManagedSessionLine(line))
    .filter((session): session is ManagedTmuxSession => session !== null);

  sessions.sort((left, right) => {
    const leftCreated = left.createdEpochSeconds ?? 0;
    const rightCreated = right.createdEpochSeconds ?? 0;

    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }

    return left.name.localeCompare(right.name);
  });

  return sessions;
}

export function findManagedTmuxSessionByName(
  sessionName: string,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): ManagedTmuxSession | undefined {
  const normalizedName = sessionName.trim();
  if (normalizedName.length === 0) {
    return undefined;
  }

  const sessions = listManagedTmuxSessions(runner);
  return sessions.find((session) => session.name === normalizedName);
}

function ensureManagedSession(
  sessionName: string,
  runner: TmuxRunner,
): ManagedTmuxSession {
  const session = findManagedTmuxSessionByName(sessionName, runner);

  if (!session) {
    throw new Error(`No managed tmux session found: ${sessionName}`);
  }

  return session;
}

export function stopManagedTmuxSession(
  sessionName: string,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  ensureManagedSession(sessionName, runner);

  const args = ['kill-session', '-t', sessionName];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }
}

export function sendManagedTmuxCommand(
  sessionName: string,
  command: string,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) {
    throw new Error('Command cannot be empty.');
  }

  ensureManagedSession(sessionName, runner);

  const args = ['send-keys', '-t', sessionName, trimmedCommand, 'C-m'];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }
}

export function captureManagedTmuxPane(
  sessionName: string,
  lineCount: number,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): string {
  ensureManagedSession(sessionName, runner);

  const safeLineCount = Math.max(1, Math.min(1000, Math.floor(lineCount)));
  const start = `-${safeLineCount}`;
  const args = ['capture-pane', '-pt', sessionName, '-S', start];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }

  return normalizeOutput(result.stdout);
}

function setManagedSessionOption(
  sessionName: string,
  option: string,
  value: string,
  runner: TmuxRunner,
): void {
  const args = ['set-option', '-t', sessionName, option, value];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }
}

export function tagManagedTmuxSession(
  sessionName: string,
  metadata: {
    task?: string;
    logPath?: string;
    command?: string;
    notifyOnComplete?: boolean;
    notifyContext?: string;
  },
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  setManagedSessionOption(sessionName, PA_TMUX_MANAGED_OPTION, '1', runner);

  if (metadata.task) {
    setManagedSessionOption(sessionName, PA_TMUX_TASK_OPTION, metadata.task, runner);
  }

  if (metadata.logPath) {
    setManagedSessionOption(sessionName, PA_TMUX_LOG_OPTION, metadata.logPath, runner);
  }

  if (metadata.command) {
    setManagedSessionOption(sessionName, PA_TMUX_COMMAND_OPTION, metadata.command, runner);
  }

  if (metadata.notifyOnComplete) {
    setManagedSessionOption(sessionName, PA_TMUX_NOTIFY_ON_COMPLETE_OPTION, '1', runner);
  }

  if (metadata.notifyContext) {
    setManagedSessionOption(sessionName, PA_TMUX_NOTIFY_CONTEXT_OPTION, metadata.notifyContext, runner);
  }
}

function isNoSuchTmuxSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes('no such session');
}

export function startManagedTmuxSession(
  options: StartManagedTmuxSessionOptions,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  const args = ['new-session', '-d', '-s', options.sessionName, '-c', options.cwd, options.command];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }

  try {
    tagManagedTmuxSession(
      options.sessionName,
      {
        task: options.task,
        logPath: options.logPath,
        command: options.sourceCommand,
        notifyOnComplete: options.notifyOnComplete,
        notifyContext: options.notifyContext,
      },
      runner,
    );
  } catch (error) {
    if (isNoSuchTmuxSessionError(error)) {
      return;
    }

    throw error;
  }
}

function buildManagedLogViewerCommand(sessionName: string, logPath: string): string {
  const script = [
    `printf '%s\\n' ${shellQuote(`PA task viewer: ${sessionName}`)}`,
    `printf '%s\\n' ${shellQuote(`Log: ${logPath}`)}`,
    "printf '\\n'",
    `exec tail -n +1 -F ${shellQuote(logPath)}`,
  ].join('; ');

  return `sh -lc ${shellQuote(script)}`;
}

export function openManagedTmuxLogPane(
  options: OpenManagedTmuxLogPaneOptions,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): string | undefined {
  const command = buildManagedLogViewerCommand(options.sessionName, options.logPath);
  const args = ['split-window', '-h', '-P', '-F', '#{pane_id}', '-t', options.targetPane, command];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }

  const paneId = normalizeOutput(result.stdout);

  if (paneId.length > 0 && options.title) {
    const titleArgs = ['select-pane', '-t', paneId, '-T', options.title];
    const titleResult = runner(titleArgs);

    if ((titleResult.status ?? 1) !== 0) {
      throwTmuxFailure(titleArgs, titleResult);
    }
  }

  return paneId.length > 0 ? paneId : undefined;
}

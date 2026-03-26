#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { createConnection } from 'net';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { Command, CommanderError } from 'commander';
import {
  bootstrapStateOrThrow,
  clearActivityConversationLinks,
  createProjectActivityEntry,
  ensureConversationAttentionBaselines,
  getActivityConversationLink,
  getConfigRoot,
  getDurableProfilesDir,
  listProfileActivityEntries,
  listStoredSessions,
  loadProfileActivityReadState,
  markConversationAttentionRead,
  markConversationAttentionUnread,
  preparePiAgentDir,
  resolveActivityEntryPath,
  resolveProfileActivityDir,
  resolveStatePaths,
  saveProfileActivityReadState,
  setActivityConversationLinks,
  summarizeConversationAttention,
  validateActivityId,
  validateStatePathsOutsideRepo,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import {
  buildPiResourceArgs,
  getExtensionDependencyDirs,
  getRepoRoot,
  installPackageSource,
  listProfiles,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  resolveResourceProfile,
} from '@personal-agent/resources';
import {
  daemonStatusJson,
  emitDaemonEventNonFatal,
  getDaemonStatus,
  loadDaemonConfig,
  pingDaemon,
  readDaemonPid,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
  scanDurableRunsForRecovery,
  startDaemonDetached,
  stopDaemonGracefully,
  parseTaskDefinition,
  type DaemonStatus,
  type ParsedTaskDefinition,
} from '@personal-agent/daemon';
import {
  activateWebUiSlot,
  findBadWebUiRelease,
  getInactiveWebUiSlot,
  getManagedDaemonServiceStatus,
  getWebUiDeploymentSummary,
  getWebUiServiceStatus,
  getWebUiSlotHealthPort,
  installManagedDaemonService,
  installWebUiService,
  listBadWebUiReleases,
  markWebUiReleaseBad,
  restartManagedDaemonServiceIfInstalled,
  resolveWebUiTailscaleUrl,
  restartWebUiService,
  restartWebUiServiceIfInstalled,
  rollbackWebUiDeployment,
  stageWebUiRelease,
  startWebUiService,
  stopWebUiService,
  syncWebUiTailscaleServe,
  uninstallManagedDaemonService,
  uninstallWebUiService,
  type WebUiReleaseSummary,
  type WebUiServiceOptions,
  type WebUiServiceStatus,
} from '@personal-agent/services';
import { hasOption } from './args.js';
import { readTailLines } from './file-utils.js';
import { memoryCommand } from './memory.js';
import { mcpCommand } from './mcp-command.js';
import { readConfig, setDefaultProfile } from './config.js';
import {
  writeRestartCompletionInboxEntry,
  writeRestartFailureInboxEntry,
  writeUpdateCompletionInboxEntry,
  writeUpdateFailureInboxEntry,
  writeWebUiMarkedBadInboxEntry,
  writeWebUiRollbackInboxEntry,
} from './restartNotifications.js';
import { runsCommand } from './runs-command.js';
import { targetsCommand } from './targets-command.js';
import { syncCommand } from './sync-command.js';
import { waitForWebUiHealthy } from './web-ui-health.js';
import {
  accent,
  bullet,
  configureUi,
  dim,
  error as uiError,
  formatHint,
  formatNextStep,
  isInteractiveOutput,
  keyValue,
  section,
  spinner,
  statusChip,
  success,
  warning,
} from './ui.js';

interface ParsedGlobalFlags {
  argv: string[];
  plain: boolean;
}

function parseGlobalFlags(argv: string[]): ParsedGlobalFlags {
  let plain = process.env.PERSONAL_AGENT_PLAIN_OUTPUT === '1' || process.env.NO_COLOR === '1';
  const normalized: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      normalized.push(...argv.slice(i));
      break;
    }

    if (arg === '--plain' || arg === '--no-color') {
      plain = true;
      continue;
    }

    normalized.push(arg);
  }

  return {
    argv: normalized,
    plain,
  };
}

const PI_PACKAGE_NAME = '@mariozechner/pi-coding-agent';
const DEFAULT_WEB_UI_PORT = 3741;
const DEFAULT_WEB_UI_COMPANION_PORT = 3742;
const INSTALL_COMMAND_USAGE = 'pa install <source> [--profile <name> | -l | --local]';
const INSTALL_COMMAND_HELP_TEXT = `Default target: active mutable profile settings.json.

Options:
  --profile <name>   Install into the selected profile's settings.json
  -l, --local        Install into the machine-local overlay settings.json

Examples:
  pa install https://github.com/davebcn87/pi-autoresearch
  pa install npm:@scope/package@1.2.3
  pa install ./my-package
  pa install --profile assistant https://github.com/user/repo
  pa install --local ./my-package`;

interface WebUiConfig {
  port: number;
  companionPort: number;
  useTailscaleServe: boolean;
}

function isWebUiConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWebUiConfigFilePath(): string {
  const explicit = process.env.PERSONAL_AGENT_WEB_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return resolve(explicit);
  }

  return join(getConfigRoot(), 'web.json');
}

function normalizeWebUiPort(value: unknown, fallback = DEFAULT_WEB_UI_PORT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(value);
  return parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function normalizeWebUiCompanionPort(value: unknown, fallback = DEFAULT_WEB_UI_COMPANION_PORT): number {
  return normalizeWebUiPort(value, fallback);
}

function normalizeWebUiBool(value: unknown, fallback = false): boolean {
  return value === true || value === 'true' ? true : value === false ? false : fallback;
}

function parseWebUiEnvBool(value: string | undefined): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

function readRawWebUiConfig(): Record<string, unknown> {
  const filePath = getWebUiConfigFilePath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    return isWebUiConfigRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function finalizeWebUiConfig(config: WebUiConfig): WebUiConfig {
  if (config.companionPort !== config.port) {
    return config;
  }

  return {
    ...config,
    companionPort: config.port === DEFAULT_WEB_UI_COMPANION_PORT ? DEFAULT_WEB_UI_COMPANION_PORT + 1 : config.port + 1,
  };
}

function readWebUiConfig(): WebUiConfig {
  const envOverride = parseWebUiEnvBool(process.env.PERSONAL_AGENT_WEB_TAILSCALE_SERVE);
  const parsed = readRawWebUiConfig();

  return finalizeWebUiConfig({
    port: normalizeWebUiPort(parsed.port),
    companionPort: normalizeWebUiCompanionPort(parsed.companionPort),
    useTailscaleServe: envOverride ?? normalizeWebUiBool(parsed.useTailscaleServe),
  });
}

function writeWebUiConfig(config: WebUiConfig): void {
  const filePath = getWebUiConfigFilePath();
  const raw = readRawWebUiConfig();
  const current = readWebUiConfig();
  const next = finalizeWebUiConfig({
    port: normalizeWebUiPort(config.port),
    companionPort: normalizeWebUiCompanionPort(config.companionPort),
    useTailscaleServe: normalizeWebUiBool(config.useTailscaleServe),
  });

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(
    {
      ...raw,
      ...current,
      ...next,
    },
    null,
    2,
  )}\n`);
}

function getWebUiServiceOptions(overrides: WebUiServiceOptions = {}): Required<WebUiServiceOptions> {
  const repoRoot = overrides.repoRoot ?? getRepoRoot();
  const port = overrides.port ?? readWebUiConfig().port;
  return { repoRoot, port };
}

function resolveWebUiLogFile(): string {
  return join(resolveStatePaths().root, 'web', 'logs', 'web.log');
}

function resolveApplicationCommandLockFile(): string {
  return join(resolveStatePaths().root, 'web', 'app-restart.lock.json');
}

function clearOwnedApplicationCommandLock(action: 'restart' | 'update' | 'web-ui-service-restart'): void {
  const lockFile = resolveApplicationCommandLockFile();
  if (!existsSync(lockFile)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(lockFile, 'utf-8')) as {
      action?: unknown;
      pid?: unknown;
    };

    if (parsed.action !== action || parsed.pid !== process.pid) {
      return;
    }
  } catch {
    return;
  }

  rmSync(lockFile, { force: true });
}

interface PiCommandInvocation {
  command: string;
  argsPrefix: string[];
  source: 'repo' | 'global';
}

function toUniqueItems(values: Array<string | undefined>): string[] {
  const deduped = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    deduped.add(resolve(value));
  }

  return [...deduped];
}

function resolveRepoPiCommand(repoRoot?: string): PiCommandInvocation | undefined {
  const resolvedRepoRoot = getRepoRoot(repoRoot);
  const localPiCli = join(
    resolvedRepoRoot,
    'node_modules',
    '@mariozechner',
    'pi-coding-agent',
    'dist',
    'cli.js',
  );

  if (!existsSync(localPiCli) || !statSync(localPiCli).isFile()) {
    return undefined;
  }

  return {
    command: process.execPath,
    argsPrefix: [localPiCli],
    source: 'repo',
  };
}

function readPiVersion(invocation: PiCommandInvocation): string | undefined {
  const result = spawnSync(invocation.command, [...invocation.argsPrefix, '--version'], { encoding: 'utf-8' });

  if (result.error || result.status !== 0) {
    return undefined;
  }

  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  const version = stdout && stdout.length > 0 ? stdout : stderr;

  if (!version || version.length === 0) {
    return undefined;
  }

  return version;
}

function runPiVersion(invocation: PiCommandInvocation): boolean {
  return readPiVersion(invocation) !== undefined;
}

function ensurePiInstalled(repoRoot?: string): PiCommandInvocation {
  const repoCandidates = toUniqueItems([
    repoRoot,
    process.env.PERSONAL_AGENT_REPO_ROOT,
    getRepoRoot(),
  ]);

  for (const candidate of repoCandidates) {
    const repoInvocation = resolveRepoPiCommand(candidate);
    if (!repoInvocation) {
      continue;
    }

    if (runPiVersion(repoInvocation)) {
      return repoInvocation;
    }
  }

  const globalInvocation: PiCommandInvocation = {
    command: 'pi',
    argsPrefix: [],
    source: 'global',
  };

  if (runPiVersion(globalInvocation)) {
    return globalInvocation;
  }

  throw new Error(
    `Unable to find a runnable pi binary. Tried repo-local SDK and global pi. `
      + `Run npm install in ${getRepoRoot()} or install globally: npm install -g ${PI_PACKAGE_NAME}`,
  );
}

function promptUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function maybeStartDaemon(): Promise<void> {
  const config = loadDaemonConfig();
  const running = await pingDaemon(config);

  if (running) {
    return;
  }

  console.warn(warning('Daemon is not running.'));
  console.warn(`  ${formatHint('Run pa daemon start')}`);

  const interactive = isInteractiveOutput();
  if (!interactive || process.env.PERSONAL_AGENT_NO_DAEMON_PROMPT === '1') {
    return;
  }

  const answer = await promptUser('Would you like to start it? [Y/n] ');

  if (answer === '' || answer === 'y' || answer === 'yes') {
    const startSpinner = spinner('Starting daemon');
    startSpinner.start();

    try {
      await startDaemonDetached();
      startSpinner.succeed('Daemon started');
    } catch (error) {
      startSpinner.fail('Unable to start daemon');
      throw error;
    }

    // Give daemon a moment to initialize
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function ensureExtensionDependencies(profile: ReturnType<typeof resolveResourceProfile>): void {
  const dependencyDirs = getExtensionDependencyDirs(profile);
  const missingDirs = dependencyDirs.filter((dir) => !existsSync(join(dir, 'node_modules')));

  for (const dir of missingDirs) {
    const installSpinner = spinner(`Installing extension dependencies in ${dir}`);
    installSpinner.start();

    const result = spawnSync('npm', ['install', '--silent', '--no-package-lock'], {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    if (result.error || result.status !== 0) {
      installSpinner.fail(`Extension dependency install failed in ${dir}`);
      const detail = result.stderr?.trim() || result.error?.message || 'unknown error';
      throw new Error(`Failed to install extension dependencies in ${dir}: ${detail}`);
    }

    installSpinner.succeed(`Installed extension dependencies in ${dir}`);
  }
}

function resolveProfileName(): string {
  const config = readConfig();
  return config.defaultProfile;
}

function resolveActivityProfileName(): string {
  const explicit = process.env.PERSONAL_AGENT_ACTIVE_PROFILE?.trim() || process.env.PERSONAL_AGENT_PROFILE?.trim();
  return explicit && explicit.length > 0 ? explicit : resolveProfileName();
}

function applyDefaultModelArgs(args: string[], settings: Record<string, unknown>): string[] {
  const output = [...args];

  const hasModel = output.includes('--model');
  const hasThinking = output.includes('--thinking');

  const defaultProvider = settings.defaultProvider;
  const defaultModel = settings.defaultModel;
  const defaultThinkingLevel = settings.defaultThinkingLevel;

  if (!hasModel && typeof defaultProvider === 'string' && typeof defaultModel === 'string') {
    output.push('--model', `${defaultProvider}/${defaultModel}`);
  }

  if (!hasThinking && typeof defaultThinkingLevel === 'string') {
    output.push('--thinking', defaultThinkingLevel);
  }

  return output;
}

type SystemThemeMode = 'light' | 'dark';
type ThemeMode = SystemThemeMode | 'system';

interface SystemThemeMappingStatus {
  configured: boolean;
  mode?: SystemThemeMode;
  selectedTheme?: string;
}

function parseSystemThemeMode(value: unknown): SystemThemeMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'light' || normalized === 'dark') {
    return normalized;
  }

  return undefined;
}

function parseThemeMode(value: unknown): ThemeMode {
  if (typeof value !== 'string') {
    return 'system';
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'light' || normalized === 'dark' || normalized === 'system') {
    return normalized;
  }

  return 'system';
}

function readMappedTheme(
  settings: Record<string, unknown>,
  key: 'themeDark' | 'themeLight',
): string | undefined {
  const value = settings[key];

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function detectSystemThemeMode(): SystemThemeMode | undefined {
  if (process.platform === 'darwin') {
    const result = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], {
      encoding: 'utf-8',
    });

    if (result.error) {
      return undefined;
    }

    if ((result.status ?? 1) === 0) {
      return parseSystemThemeMode(result.stdout);
    }

    return 'light';
  }

  if (process.platform === 'win32') {
    const result = spawnSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'],
      { encoding: 'utf-8' },
    );

    if (result.error || (result.status ?? 1) !== 0) {
      return undefined;
    }

    const value = result.stdout.toLowerCase();

    if (value.includes('0x0')) {
      return 'dark';
    }

    if (value.includes('0x1')) {
      return 'light';
    }

    return undefined;
  }

  if (process.platform === 'linux') {
    const result = spawnSync('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'], {
      encoding: 'utf-8',
    });

    if (result.error || (result.status ?? 1) !== 0) {
      return undefined;
    }

    const value = result.stdout.toLowerCase();

    if (value.includes('dark')) {
      return 'dark';
    }

    if (value.includes('light') || value.includes('default')) {
      return 'light';
    }
  }

  return undefined;
}

function getSystemThemeMappingStatus(settings: Record<string, unknown>): SystemThemeMappingStatus {
  const darkTheme = readMappedTheme(settings, 'themeDark');
  const lightTheme = readMappedTheme(settings, 'themeLight');

  if (!darkTheme || !lightTheme) {
    return { configured: false };
  }

  const modeSetting = parseThemeMode(settings.themeMode);
  const mode = modeSetting === 'system'
    ? detectSystemThemeMode()
    : modeSetting;

  if (!mode) {
    return { configured: true };
  }

  return {
    configured: true,
    mode,
    selectedTheme: mode === 'dark' ? darkTheme : lightTheme,
  };
}

function readRuntimeSettings(settingsPath: string, fallbackSettings: Record<string, unknown>): Record<string, unknown> {
  if (!existsSync(settingsPath)) {
    return fallbackSettings;
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallbackSettings;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return fallbackSettings;
  }
}

function mergeResolvedProfileSettings(
  resolvedProfile: ReturnType<typeof resolveResourceProfile>,
): Record<string, unknown> {
  return resolvedProfile.settingsFiles.length > 0
    ? mergeJsonFiles(resolvedProfile.settingsFiles)
    : {};
}

function applySystemThemeOverride(settingsPath: string, settings: Record<string, unknown>): Record<string, unknown> {
  const mappingStatus = getSystemThemeMappingStatus(settings);
  const targetTheme = mappingStatus.selectedTheme;

  if (!targetTheme) {
    return settings;
  }

  const currentTheme = typeof settings.theme === 'string' ? settings.theme : undefined;

  if (currentTheme === targetTheme) {
    return settings;
  }

  const nextSettings: Record<string, unknown> = {
    ...settings,
    theme: targetTheme,
  };

  try {
    writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2));
    return nextSettings;
  } catch (error) {
    console.warn(warning(`Unable to write theme override to ${settingsPath}: ${(error as Error).message}`));
    return settings;
  }
}

function extractSessionFile(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session') {
      return args[i + 1];
    }
  }

  return undefined;
}

interface PreparedPiLaunch {
  args: string[];
  env: NodeJS.ProcessEnv;
}

async function preparePiLaunch(
  resolvedProfile: ReturnType<typeof resolveResourceProfile>,
  piArgs: string[],
): Promise<PreparedPiLaunch> {
  const statePaths = resolveStatePaths();

  await bootstrapStateOrThrow(statePaths);

  const runtime = await preparePiAgentDir({
    statePaths,
  });

  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);
  ensureExtensionDependencies(resolvedProfile);

  const fallbackSettings = mergeResolvedProfileSettings(resolvedProfile);
  const settingsPath = join(runtime.agentDir, 'settings.json');
  const runtimeSettings = readRuntimeSettings(settingsPath, fallbackSettings);
  const settings = applySystemThemeOverride(settingsPath, runtimeSettings);

  const resourceArgs = buildPiResourceArgs(resolvedProfile);
  const withDefaults = applyDefaultModelArgs(piArgs, settings);

  return {
    args: [...resourceArgs, ...withDefaults],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: runtime.agentDir,
      PERSONAL_AGENT_ACTIVE_PROFILE: resolvedProfile.name,
      PERSONAL_AGENT_REPO_ROOT: resolvedProfile.repoRoot,
    },
  };
}

async function runPi(profileName: string, piArgs: string[]): Promise<number> {
  const resolvedProfile = resolveResourceProfile(profileName);
  const statePaths = resolveStatePaths();

  validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);

  const piInvocation = ensurePiInstalled(resolvedProfile.repoRoot);
  await maybeStartDaemon();

  return runPiWithResolvedProfile(resolvedProfile, piArgs, piInvocation);
}

async function runPiWithResolvedProfile(
  resolvedProfile: ReturnType<typeof resolveResourceProfile>,
  piArgs: string[],
  piInvocation: PiCommandInvocation,
): Promise<number> {
  const prepared = await preparePiLaunch(resolvedProfile, piArgs);

  const result = spawnSync(piInvocation.command, [...piInvocation.argsPrefix, ...prepared.args], {
    stdio: 'inherit',
    env: prepared.env,
  });

  if (result.error) {
    throw result.error;
  }

  const sessionFile = extractSessionFile(prepared.args);
  const statusCode = result.status ?? 1;

  if (statusCode === 0) {
    await emitDaemonEventNonFatal({
      type: sessionFile ? 'session.closed' : 'pi.run.completed',
      source: 'cli',
      payload: {
        profile: resolvedProfile.name,
        cwd: process.cwd(),
        sessionFile,
      },
    });
  }

  if (statusCode !== 0) {
    await emitDaemonEventNonFatal({
      type: 'pi.run.failed',
      source: 'cli',
      payload: {
        profile: resolvedProfile.name,
        cwd: process.cwd(),
        statusCode,
      },
    });
  }

  return statusCode;
}

function printProfileList(): void {
  const profiles = listProfiles();
  const config = readConfig();

  if (profiles.length === 0) {
    console.log(warning('No profiles found under profiles/.'));
    console.log(`  ${formatHint('Create a profile under profiles/<name>/agent')}`);
    return;
  }

  console.log(section('Profiles:'));

  for (const profile of profiles) {
    const isDefault = profile === config.defaultProfile;
    const marker = isDefault ? accent('*') : dim('·');
    const suffix = isDefault ? ` ${dim('(default)')}` : '';
    console.log(` ${marker} ${profile}${suffix}`);
  }
}

function showProfile(name?: string): void {
  const profileName = name ?? resolveProfileName();
  const resolved = resolveResourceProfile(profileName);

  const payload = {
    name: resolved.name,
    layers: resolved.layers,
    extensionDirs: resolved.extensionDirs,
    skillDirs: resolved.skillDirs,
    promptDirs: resolved.promptDirs,
    themeDirs: resolved.themeDirs,
    agentsFiles: resolved.agentsFiles,
    appendSystemFiles: resolved.appendSystemFiles,
    systemPromptFile: resolved.systemPromptFile,
    settingsFiles: resolved.settingsFiles,
    modelsFiles: resolved.modelsFiles,
  };

  console.log(JSON.stringify(payload, null, 2));
}

function doctorError(label: string, message: string, hint?: string): void {
  console.error(uiError(label, message));

  if (hint) {
    console.error(`  ${formatHint(hint)}`);
  }
}

function doctorOk(label: string, value?: string | number | boolean): void {
  console.log(success(label, value));
}

function countFilesNamed(directories: string[], fileNames: string | string[]): number {
  const allowed = new Set(Array.isArray(fileNames) ? fileNames : [fileNames]);
  const stack = [...directories];
  let count = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && allowed.has(entry.name)) {
        count += 1;
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
      }
    }
  }

  return count;
}

interface DoctorOptions {
  json?: boolean;
}

function printDoctorJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function doctor(options: DoctorOptions = {}): Promise<number> {
  const profileName = resolveProfileName();

  try {
    ensurePiInstalled();
  } catch (error) {
    const message = (error as Error).message;
    const hint = `npm install (in ${getRepoRoot()}) or npm install -g ${PI_PACKAGE_NAME}`;

    if (options.json) {
      printDoctorJson({
        ok: false,
        check: 'pi binary',
        error: message,
        hint,
      });
    } else {
      doctorError('pi binary', message, hint);
    }

    return 1;
  }

  const profiles = listProfiles();
  if (profiles.length === 0) {
    const hint = 'Create profiles/<name>/agent and run pa profile list';

    if (options.json) {
      printDoctorJson({
        ok: false,
        check: 'profiles',
        error: 'none found',
        hint,
      });
    } else {
      doctorError('profiles', 'none found', hint);
    }

    return 1;
  }

  let resolvedProfile: ReturnType<typeof resolveResourceProfile>;
  try {
    resolvedProfile = resolveResourceProfile(profileName);
  } catch (error) {
    const message = (error as Error).message;
    const hint = 'Run pa profile list and pa profile use <name>';

    if (options.json) {
      printDoctorJson({
        ok: false,
        check: 'profile',
        error: message,
        hint,
      });
    } else {
      doctorError('profile', message, hint);
    }

    return 1;
  }

  const statePaths = resolveStatePaths();

  try {
    validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);
  } catch (error) {
    const message = (error as Error).message;
    const hint = 'Use PERSONAL_AGENT_STATE_ROOT outside your repository';

    if (options.json) {
      printDoctorJson({
        ok: false,
        check: 'runtime paths',
        error: message,
        hint,
      });
    } else {
      doctorError('runtime paths', message, hint);
    }

    return 1;
  }

  let runtime: Awaited<ReturnType<typeof preparePiAgentDir>>;
  try {
    await bootstrapStateOrThrow(statePaths);
    runtime = await preparePiAgentDir({ statePaths });
  } catch (error) {
    const message = (error as Error).message;
    const hint = 'Check filesystem permissions for state directories';

    if (options.json) {
      printDoctorJson({
        ok: false,
        check: 'bootstrap',
        error: message,
        hint,
      });
    } else {
      doctorError('bootstrap', message, hint);
    }

    return 1;
  }

  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);

  const runtimeAuth = runtime.authFile;
  const legacyAuth = join(homedir(), '.pi', 'agent', 'auth.json');
  const profileSettings = resolvedProfile.settingsFiles.length > 0
    ? mergeJsonFiles(resolvedProfile.settingsFiles)
    : {};
  const themeMappingStatus = getSystemThemeMappingStatus(profileSettings);

  const report = {
    ok: true,
    profile: resolvedProfile.name,
    layers: resolvedProfile.layers.map((layer) => layer.name),
    runtimeRoot: statePaths.root,
    runtimeAgentDir: runtime.agentDir,
    extensionDirs: resolvedProfile.extensionDirs.length,
    extensionEntries: resolvedProfile.extensionEntries.length,
    skillDirs: resolvedProfile.skillDirs.length,
    skillDefinitions: countFilesNamed(resolvedProfile.skillDirs, ['INDEX.md', 'SKILL.md']),
    promptDirs: resolvedProfile.promptDirs.length,
    promptTemplates: resolvedProfile.promptEntries.length,
    themeDirs: resolvedProfile.themeDirs.length,
    themes: resolvedProfile.themeEntries.length,
    systemThemeMappingConfigured: themeMappingStatus.configured,
    systemThemeMappingMode: themeMappingStatus.mode ?? null,
    systemThemeMappingTheme: themeMappingStatus.selectedTheme ?? null,
    runtimeAuthPresent: existsSync(runtimeAuth),
    legacyAuthPresent: existsSync(legacyAuth),
  };

  if (options.json) {
    printDoctorJson(report);
    return 0;
  }

  console.log(section('Doctor checks'));
  console.log('');

  doctorOk('pi binary');
  doctorOk('profile', report.profile);
  doctorOk('layers', report.layers.join(' -> '));
  doctorOk('runtime root', report.runtimeRoot);
  doctorOk('runtime agent dir', report.runtimeAgentDir);
  doctorOk('extension directories', report.extensionDirs);
  doctorOk('extension entries', report.extensionEntries);
  doctorOk('skill directories', report.skillDirs);
  doctorOk('skills discovered', report.skillDefinitions);
  doctorOk('prompt directories', report.promptDirs);
  doctorOk('prompt templates', report.promptTemplates);
  doctorOk('theme directories', report.themeDirs);
  doctorOk('themes', report.themes);
  const systemThemeMappingLabel = !report.systemThemeMappingConfigured
    ? 'disabled'
    : report.systemThemeMappingMode && report.systemThemeMappingTheme
      ? `${report.systemThemeMappingMode} -> ${report.systemThemeMappingTheme}`
      : 'configured (detection unavailable)';
  doctorOk('system theme mapping', systemThemeMappingLabel);
  doctorOk('runtime auth present', report.runtimeAuthPresent);
  doctorOk('legacy auth present', report.legacyAuthPresent);
  console.log('');
  console.log(formatNextStep('pa tui -p "hello"'));

  return 0;
}

interface ParsedRunCommandArgs {
  profileName: string;
  piArgs: string[];
}

function parseRunCommandArgs(args: string[]): ParsedRunCommandArgs {
  const filteredArgs: string[] = [];
  let profileName = resolveProfileName();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--') {
      filteredArgs.push(...args.slice(i));
      break;
    }

    if (arg === '--profile') {
      const value = args[i + 1];

      if (!value || value.startsWith('-')) {
        throw new Error('tui --profile requires a profile name');
      }

      profileName = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length).trim();

      if (value.length === 0) {
        throw new Error('tui --profile requires a profile name');
      }

      profileName = value;
      continue;
    }

    filteredArgs.push(arg);
  }

  const piArgs = filteredArgs[0] === '--'
    ? filteredArgs.slice(1)
    : filteredArgs;

  return {
    profileName,
    piArgs,
  };
}

async function runCommand(args: string[]): Promise<number> {
  const parsed = parseRunCommandArgs(args);
  return runPi(parsed.profileName, parsed.piArgs);
}

function printProfileHelp(): void {
  console.log(section('Profile commands'));
  console.log('');
  console.log(`Usage: pa profile [list|show|use|help]

Commands:
  list           List available profiles
  show [name]    Show profile details
  use <name>     Set default profile
  help           Show profile help
`);
}

async function profileCommand(args: string[]): Promise<number> {
  const [subcommand, value] = args;

  if (!subcommand) {
    printProfileHelp();
    return 0;
  }

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(args.slice(1), 'pa profile help');
    printProfileHelp();
    return 0;
  }

  if (subcommand === 'list') {
    printProfileList();
    return 0;
  }

  if (subcommand === 'show') {
    showProfile(value);
    return 0;
  }

  if (subcommand === 'use') {
    if (!value) {
      throw new Error('profile use requires a profile name');
    }

    const profiles = listProfiles();
    if (!profiles.includes(value)) {
      throw new Error(`Unknown profile: ${value}`);
    }

    setDefaultProfile(value);
    console.log(success('Default profile set to', value));
    console.log(`  ${formatNextStep('pa tui -p "hello"')}`);
    return 0;
  }

  throw new Error(`Unknown profile subcommand: ${subcommand}`);
}

interface ParsedInstallCommandArgs {
  source: string;
  local: boolean;
  profileName?: string;
}

function printInstallHelp(): void {
  console.log(section('Install packages'));
  console.log('');
  console.log(`Usage: ${INSTALL_COMMAND_USAGE}

Add a Pi package source to the durable settings used by pa.

${INSTALL_COMMAND_HELP_TEXT}
`);
}

function parseInstallCommandArgs(args: string[]): ParsedInstallCommandArgs {
  let source: string | undefined;
  let local = false;
  let profileName: string | undefined;
  let parseOptions = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (parseOptions && arg === '--') {
      parseOptions = false;
      continue;
    }

    if (parseOptions && (arg === '-l' || arg === '--local')) {
      local = true;
      continue;
    }

    if (parseOptions && arg === '--profile') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Usage: ${INSTALL_COMMAND_USAGE}`);
      }

      profileName = value;
      i += 1;
      continue;
    }

    if (parseOptions && arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length).trim();
      if (value.length === 0) {
        throw new Error(`Usage: ${INSTALL_COMMAND_USAGE}`);
      }

      profileName = value;
      continue;
    }

    if (parseOptions && arg.startsWith('-')) {
      throw new Error(`Usage: ${INSTALL_COMMAND_USAGE}`);
    }

    if (!source) {
      source = arg;
      continue;
    }

    throw new Error(`Usage: ${INSTALL_COMMAND_USAGE}`);
  }

  if (!source || (local && profileName)) {
    throw new Error(`Usage: ${INSTALL_COMMAND_USAGE}`);
  }

  return {
    source,
    local,
    profileName,
  };
}

async function installCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(rest, 'pa install help');
    printInstallHelp();
    return 0;
  }

  const parsed = parseInstallCommandArgs(args);
  const target = parsed.local ? 'local' : 'profile';
  const profileName = parsed.local ? undefined : (parsed.profileName ?? resolveProfileName());
  const result = installPackageSource({
    repoRoot: getRepoRoot(),
    profilesRoot: getDurableProfilesDir(),
    source: parsed.source,
    target,
    profileName,
    sourceBaseDir: process.cwd(),
  });
  const targetLabel = target === 'local' ? 'local overlay' : `profile ${profileName}`;

  if (result.alreadyPresent) {
    console.log(warning(`Package source already present in ${result.settingsPath}`));
    console.log(keyValue('Source', result.source));
    console.log(keyValue('Target', targetLabel));
    return 0;
  }

  console.log(success('Installed package source', result.source));
  console.log(keyValue('Target', targetLabel));
  console.log(keyValue('Settings', result.settingsPath));
  console.log(`  ${formatHint('Start a new pa session to load the package')}`);
  return 0;
}

function printMaintenanceModuleStatus(module: DaemonStatus['modules'][0]): void {
  const detail = module.detail as {
    cleanedFiles?: number;
    lastRunAt?: string;
    lastError?: string;
  } | undefined;

  const status = module.lastError || detail?.lastError
    ? statusChip('error')
    : module.enabled
      ? statusChip('active')
      : statusChip('disabled');

  console.log(bullet(`PA housekeeping: ${status}`));
  console.log(keyValue('Policy', 'Removes daemon logs older than 7 days', 4));

  if (typeof detail?.cleanedFiles === 'number') {
    console.log(keyValue('Logs removed (total)', detail.cleanedFiles, 4));
  }

  if (detail?.lastRunAt) {
    console.log(keyValue('Last run', new Date(detail.lastRunAt).toLocaleString(), 4));
  }

  if (module.lastError || detail?.lastError) {
    console.log(`    ${uiError('Housekeeping module', module.lastError || detail?.lastError || 'Unknown error')}`);
  }
}

function printTasksModuleStatus(module: DaemonStatus['modules'][0], configuredTaskDir: string): void {
  const detail = module.detail as {
    taskDir?: string;
    stateFile?: string;
    runsRoot?: string;
    durableRunsRoot?: string;
    knownTasks?: number;
    parseErrors?: number;
    runningTasks?: number;
    totalRuns?: number;
    successfulRuns?: number;
    failedRuns?: number;
    skippedRuns?: number;
    lastTickAt?: string;
    lastRunAt?: string;
    lastError?: string;
  } | undefined;

  const status = module.lastError || detail?.lastError
    ? statusChip('error')
    : module.enabled
      ? statusChip('active')
      : statusChip('disabled');

  console.log(bullet(`Scheduled tasks: ${status}`));
  console.log(keyValue('Task directory', detail?.taskDir ?? configuredTaskDir, 4));

  if (detail?.stateFile) {
    console.log(keyValue('Task state file', detail.stateFile, 4));
  }

  const runsRoot = detail?.durableRunsRoot ?? detail?.runsRoot;
  if (runsRoot) {
    console.log(keyValue('Durable runs directory', runsRoot, 4));
  }

  if (typeof detail?.knownTasks === 'number') {
    console.log(keyValue('Discovered tasks', detail.knownTasks, 4));
  }

  if (typeof detail?.parseErrors === 'number') {
    const label = detail.parseErrors > 0
      ? `${statusChip('error')} (${detail.parseErrors})`
      : `${statusChip('active')} (0)`;
    console.log(keyValue('Parse errors', label, 4));
  }

  if (typeof detail?.runningTasks === 'number') {
    console.log(keyValue('Running tasks', detail.runningTasks, 4));
  }

  if (
    typeof detail?.successfulRuns === 'number'
    || typeof detail?.failedRuns === 'number'
    || typeof detail?.skippedRuns === 'number'
  ) {
    console.log(
      keyValue(
        'Run totals',
        `ok ${detail?.successfulRuns ?? 0} | failed ${detail?.failedRuns ?? 0} | skipped ${detail?.skippedRuns ?? 0}`,
        4,
      ),
    );
  }

  if (detail?.lastTickAt) {
    console.log(keyValue('Last scheduler tick', new Date(detail.lastTickAt).toLocaleString(), 4));
  }

  if (detail?.lastRunAt) {
    console.log(keyValue('Last completed run', new Date(detail.lastRunAt).toLocaleString(), 4));
  }

  if (module.lastError || detail?.lastError) {
    console.log(`    ${uiError('Tasks module', module.lastError || detail?.lastError || 'Unknown error')}`);
  }
}

async function printDaemonModules(
  modules: DaemonStatus['modules'],
  options: { configuredTaskDir: string },
): Promise<void> {
  if (modules.length === 0) {
    console.log(dim('No modules loaded'));
    return;
  }

  for (const module of modules) {
    if (module.name === 'maintenance') {
      printMaintenanceModuleStatus(module);
      continue;
    }

    if (module.name === 'tasks') {
      printTasksModuleStatus(module, options.configuredTaskDir);
      continue;
    }

    const moduleStatus = module.lastError
      ? statusChip('error')
      : module.enabled
        ? statusChip('active')
        : statusChip('disabled');

    console.log(bullet(`${module.name}: ${moduleStatus}`));
  }
}

async function printDaemonStatusHumanReadable(): Promise<void> {
  const config = loadDaemonConfig();
  const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
  const running = await pingDaemon(config);

  if (!running) {
    console.log('');
    console.log(section('Daemon'));
    console.log(keyValue('Status', statusChip('stopped')));
    console.log(keyValue('Socket', daemonPaths.socketPath));
    console.log(keyValue('Task directory', config.modules.tasks.taskDir));
    console.log('');
    console.log(`  ${formatNextStep('pa daemon start')}`);
    return;
  }

  const status = await getDaemonStatus(config);
  const uptime = Date.now() - new Date(status.startedAt).getTime();
  const uptimeMinutes = Math.floor(uptime / 60000);
  const uptimeText = uptimeMinutes < 60
    ? `${uptimeMinutes}m`
    : `${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m`;

  console.log('');
  console.log(section('Daemon'));
  console.log(keyValue('Status', statusChip('running')));
  console.log(keyValue('PID', status.pid));
  console.log(keyValue('Uptime', uptimeText));
  console.log(keyValue('Socket', daemonPaths.socketPath));
  console.log(keyValue('Task directory', config.modules.tasks.taskDir));
  console.log('');
  console.log(section('Modules'));

  await printDaemonModules(status.modules, {
    configuredTaskDir: config.modules.tasks.taskDir,
  });
}

type DaemonServiceAction = 'help' | 'install' | 'status' | 'uninstall';

const DAEMON_HELP_TEXT = `
Daemon subcommands:
  status [--json]                               Show daemon status
  start                                         Start daemon
  stop                                          Stop daemon
  restart                                       Restart daemon
  logs                                          Show daemon log file and PID
  service [install|status|uninstall|help]      Manage daemon as an OS user service
  help                                          Show this daemon help
`;

function printDaemonHelp(): void {
  console.log(section('Daemon'));
  console.log('');
  console.log('Commands:');
  console.log('  pa daemon help                                   Show daemon help');
  console.log('  pa daemon status [--json]                        Show daemon status');
  console.log('  pa daemon start                                  Start daemon');
  console.log('  pa daemon stop                                   Stop daemon');
  console.log('  pa daemon restart                                Restart daemon');
  console.log('  pa daemon logs                                   Show daemon log file and PID');
  console.log('  pa daemon service [install|status|uninstall|help] Manage daemon as OS user service');
  console.log('');
  console.log(`  ${formatNextStep('pa daemon status')}`);
}

function printDaemonServiceHelp(): void {
  console.log(section('Daemon service'));
  console.log('');
  console.log('Commands:');
  console.log('  pa daemon service help         Show daemon service help');
  console.log('  pa daemon service install      Install and start managed daemon service');
  console.log('  pa daemon service status       Show managed daemon service status');
  console.log('  pa daemon service uninstall    Stop and remove managed daemon service');
  console.log('');
  console.log(keyValue('Supported platforms', 'macOS launchd, Linux systemd --user'));
  console.log('');
  console.log(`  ${formatNextStep('pa daemon service install')}`);
}

function printDaemonServiceStatus(): void {
  const status = getManagedDaemonServiceStatus();

  console.log(section('Daemon service'));
  console.log('');
  console.log(keyValue('Service', status.identifier));
  console.log(keyValue('Manifest', status.manifestPath));
  console.log(keyValue('Installed', status.installed ? 'yes' : 'no'));
  console.log(keyValue('Running', status.running ? 'yes' : 'no'));

  if (status.logFile) {
    console.log(keyValue('Log file', status.logFile));
  }

  if (!status.installed) {
    console.log('');
    console.log(`  ${formatNextStep('pa daemon service install')}`);
  }
}

function runDaemonServiceAction(action: DaemonServiceAction): void {
  if (action === 'help') {
    printDaemonServiceHelp();
    return;
  }

  if (action === 'status') {
    printDaemonServiceStatus();
    return;
  }

  if (action === 'install') {
    const service = installManagedDaemonService();

    console.log(success('Installed managed daemon service'));
    console.log(keyValue('Service', service.identifier));
    console.log(keyValue('Manifest', service.manifestPath));

    if (service.logFile) {
      console.log(keyValue('Log file', service.logFile));
    }

    console.log(`  ${formatNextStep('pa daemon service status')}`);
    return;
  }

  const removed = uninstallManagedDaemonService();

  console.log(success('Removed managed daemon service'));
  console.log(keyValue('Service', removed.identifier));
  console.log(keyValue('Manifest', removed.manifestPath));

  if (removed.logFile) {
    console.log(keyValue('Log file', removed.logFile));
  }

  console.log(`  ${formatNextStep('pa daemon service install')}`);
}

async function daemonCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    printDaemonHelp();
    return 0;
  }

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(rest, 'pa daemon help');
    printDaemonHelp();
    return 0;
  }

  if (subcommand === 'service') {
    const [rawAction, ...serviceArgs] = rest;

    if (!rawAction || isCliHelpToken(rawAction)) {
      ensureNoExtraCommandArgs(serviceArgs, 'pa daemon service help');
      printDaemonServiceHelp();
      return 0;
    }

    if (rawAction !== 'install' && rawAction !== 'status' && rawAction !== 'uninstall') {
      throw new Error(`Unknown daemon service subcommand: ${rawAction}`);
    }

    ensureNoExtraCommandArgs(serviceArgs, `pa daemon service ${rawAction}`);
    runDaemonServiceAction(rawAction);
    return 0;
  }

  if (subcommand === '--json') {
    ensureNoExtraCommandArgs(rest, 'pa daemon --json');
    console.log(await daemonStatusJson());
    return 0;
  }

  if (subcommand === 'status') {
    if (hasOption(rest, '--json')) {
      ensureNoExtraCommandArgs(rest.filter((arg) => arg !== '--json'), 'pa daemon status [--json]');
      console.log(await daemonStatusJson());
    } else {
      ensureNoExtraCommandArgs(rest, 'pa daemon status [--json]');
      await printDaemonStatusHumanReadable();
    }

    return 0;
  }

  if (subcommand === 'start') {
    ensureNoExtraCommandArgs(rest, 'pa daemon start');
    const daemonSpinner = spinner('Starting personal-agentd');
    daemonSpinner.start();
    await startDaemonDetached();
    daemonSpinner.succeed('personal-agentd start requested');
    console.log(`  ${formatNextStep('pa daemon status')}`);
    return 0;
  }

  if (subcommand === 'stop') {
    ensureNoExtraCommandArgs(rest, 'pa daemon stop');
    const daemonSpinner = spinner('Stopping personal-agentd');
    daemonSpinner.start();
    await stopDaemonGracefully();
    daemonSpinner.succeed('personal-agentd stop requested');
    return 0;
  }

  if (subcommand === 'restart') {
    ensureNoExtraCommandArgs(rest, 'pa daemon restart');
    await restartDaemonWithManagedServiceFallback();
    console.log(`  ${formatNextStep('pa daemon status')}`);
    return 0;
  }

  if (subcommand === 'logs') {
    ensureNoExtraCommandArgs(rest, 'pa daemon logs');
    const config = loadDaemonConfig();
    const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
    const pid = await readDaemonPid();

    console.log('');
    console.log(section('Daemon logs'));
    console.log(keyValue('Log file', daemonPaths.logFile));
    console.log(keyValue('PID', pid ?? dim('unknown')));
    return 0;
  }

  throw new Error(`Unknown daemon subcommand: ${subcommand}`);
}

function ensureNoExtraCommandArgs(args: string[], usage: string): void {
  if (args.length > 0) {
    throw new Error(`Usage: ${usage}`);
  }
}

function isCliHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

interface RestartOptions {
  rebuild: boolean;
}

function parseRestartOptions(args: string[]): RestartOptions {
  const allowed = new Set(['--rebuild']);
  const invalidArgs = args.filter((arg) => !allowed.has(arg));

  if (invalidArgs.length > 0) {
    throw new Error('Usage: pa restart [--rebuild]');
  }

  return {
    rebuild: hasOption(args, '--rebuild'),
  };
}

interface UpdateOptions {
  repoOnly: boolean;
}

function parseUpdateOptions(args: string[]): UpdateOptions {
  const allowed = new Set(['--repo-only']);
  const invalidArgs = args.filter((arg) => !allowed.has(arg));

  if (invalidArgs.length > 0) {
    throw new Error('Usage: pa update [--repo-only]');
  }

  return {
    repoOnly: hasOption(args, '--repo-only'),
  };
}

function pullLatestFromGit(repoRoot: string): string {
  if (!existsSync(join(repoRoot, '.git'))) {
    throw new Error(`Repository root is not a git checkout: ${repoRoot}`);
  }

  const result = spawnSync('git', ['-C', repoRoot, 'pull', '--rebase', '--autostash'], {
    encoding: 'utf-8',
  });

  if (result.error) {
    throw new Error(`Failed to run git pull: ${result.error.message}`);
  }

  const statusCode = result.status ?? 1;
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  if (statusCode !== 0) {
    const detail = [stderr, stdout].filter((line) => line.length > 0).join('\n') || `exit code ${statusCode}`;
    throw new Error(`Git pull failed in ${repoRoot}: ${detail}`);
  }

  return [stdout, stderr].filter((line) => line.length > 0).join('\n');
}

interface RepoPiUpdateResult {
  output: string;
  version: string;
}

function runNpmCommand(repoRoot: string, args: string[], failurePrefix: string): string {
  const result = spawnSync('npm', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
  });

  if (result.error) {
    throw new Error(`${failurePrefix} in ${repoRoot}: ${result.error.message}`);
  }

  const statusCode = result.status ?? 1;
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  if (statusCode !== 0) {
    const outputs = [stdout, stderr].filter((line) => line.length > 0);
    const detail = outputs.length > 0 ? outputs.join('\n') : `exit code ${statusCode}`;
    throw new Error(`${failurePrefix} in ${repoRoot}: ${detail}`);
  }

  return [stdout, stderr].filter((line) => line.length > 0).join('\n');
}

function updateRepoPiPackage(repoRoot: string): RepoPiUpdateResult {
  const outputs: string[] = [];

  outputs.push(
    runNpmCommand(
      repoRoot,
      ['install', '--no-audit', '--no-fund'],
      'Repository dependency install failed',
    ),
  );

  outputs.push(
    runNpmCommand(
      repoRoot,
      ['install', '--no-audit', '--no-fund', `${PI_PACKAGE_NAME}@latest`],
      `Unable to install latest ${PI_PACKAGE_NAME} at repo root`,
    ),
  );


  const repoInvocation = resolveRepoPiCommand(repoRoot);
  if (!repoInvocation) {
    throw new Error(`Repo-local pi binary missing after npm install in ${repoRoot}`);
  }

  const version = readPiVersion(repoInvocation);
  if (!version) {
    throw new Error(`Repo-local pi binary is not runnable after npm install in ${repoRoot}`);
  }

  return {
    output: outputs.filter((line) => line.length > 0).join('\n'),
    version,
  };
}

function rebuildRepoPackages(repoRoot: string): string {
  return runNpmCommand(
    repoRoot,
    ['run', 'build'],
    'Repository build failed',
  );
}

function isMissingServiceManagerError(error: unknown): boolean {
  const message = (error as Error).message;
  return message.includes('spawnSync launchctl ENOENT') || message.includes('spawnSync systemctl ENOENT');
}

async function restartDaemonWithManagedServiceFallback(): Promise<{
  serviceManagerAvailable: boolean;
  daemonStatus: string;
}> {
  let managedDaemonService: ReturnType<typeof getManagedDaemonServiceStatus> | undefined;
  let serviceManagerAvailable = true;

  try {
    managedDaemonService = getManagedDaemonServiceStatus();
  } catch (error) {
    if (isMissingServiceManagerError(error)) {
      serviceManagerAvailable = false;
    } else {
      throw new Error(`Unable to inspect managed daemon service: ${(error as Error).message}`);
    }
  }

  const daemonSpinner = spinner('Restarting personal-agentd');
  daemonSpinner.start();

  try {
    if (managedDaemonService?.installed) {
      const restarted = restartManagedDaemonServiceIfInstalled();
      const identifier = restarted?.identifier ?? managedDaemonService.identifier;
      daemonSpinner.succeed('personal-agentd restart requested');
      return {
        serviceManagerAvailable: true,
        daemonStatus: `restarted (mode: managed service ${identifier})`,
      };
    }

    await stopDaemonGracefully();
    await startDaemonDetached();
    daemonSpinner.succeed('personal-agentd restart requested');
    return {
      serviceManagerAvailable,
      daemonStatus: serviceManagerAvailable
        ? 'restarted (mode: detached; managed service not installed)'
        : 'restarted (mode: detached; service manager unavailable)',
    };
  } catch (error) {
    daemonSpinner.fail('Unable to restart personal-agentd');
    throw error;
  }
}

interface RestartSummary {
  daemonStatus: string;
  webUiStatus: string;
}

async function restartBackgroundServices(options: {
  webUiStrategy?: 'restart' | 'blue-green';
  repoRoot?: string;
  webUiPort?: number;
} = {}): Promise<RestartSummary> {
  const daemonRestart = await restartDaemonWithManagedServiceFallback();
  const serviceManagerAvailable = daemonRestart.serviceManagerAvailable;
  const daemonStatus = daemonRestart.daemonStatus;
  let webUiStatus = 'not installed';

  if (!serviceManagerAvailable) {
    webUiStatus = 'skipped (service manager unavailable)';
  }

  if (serviceManagerAvailable) {
    const webUiOptions = getWebUiServiceOptions({
      repoRoot: options.repoRoot,
      port: options.webUiPort,
    });
    const useBlueGreen = options.webUiStrategy === 'blue-green';
    const webUiSpinner = spinner(useBlueGreen ? 'Deploying managed web UI (blue/green)' : 'Restarting managed web UI service');
    webUiSpinner.start();

    try {
      if (useBlueGreen) {
        const currentStatus = getWebUiServiceStatus(webUiOptions);
        if (!currentStatus.installed) {
          webUiSpinner.succeed('Managed web UI service not installed (skipped)');
        } else {
          const webUiConfig = finalizeWebUiConfig({
            ...readWebUiConfig(),
            port: webUiOptions.port,
          });
          const swapSummary = await deployManagedWebUiBlueGreen(
            webUiOptions.repoRoot,
            webUiOptions.port,
            webUiConfig.companionPort,
          );
          webUiSpinner.succeed(`Deployed managed web UI (${swapSummary})`);
          webUiStatus = `blue/green ${swapSummary}`;
        }
      } else {
        const status = restartWebUiServiceIfInstalled(webUiOptions);

        if (status) {
          await waitForWebUiHealthy(status.port);
          webUiSpinner.succeed(`Restarted managed web UI service (${status.url})`);
          webUiStatus = `restarted (${status.identifier} @ ${status.url})`;
        } else {
          webUiSpinner.succeed('Managed web UI service not installed (skipped)');
        }
      }
    } catch (error) {
      if (isMissingServiceManagerError(error)) {
        webUiSpinner.succeed('Service manager not available (skipped)');
        webUiStatus = 'skipped (service manager unavailable)';
      } else {
        webUiSpinner.fail(useBlueGreen ? 'Failed to deploy managed web UI' : 'Failed to restart managed web UI service');
        throw new Error(`Failed to ${useBlueGreen ? 'deploy' : 'restart'} managed web UI service: ${(error as Error).message}`);
      }
    }
  } else {
    console.log(`  ${warning('Web UI service manager not found; skipping managed web UI restart')}`);
  }

  return {
    daemonStatus,
    webUiStatus,
  };
}

async function restartCommand(args: string[]): Promise<number> {
  const options = parseRestartOptions(args);
  const repoRoot = options.rebuild ? getRepoRoot() : undefined;
  let currentPhase = options.rebuild ? 'rebuild packages' : 'restart background services';

  try {
    let buildStatus = 'skipped';
    let summary: RestartSummary;

    if (options.rebuild) {
      const buildSpinner = spinner('Rebuilding personal-agent packages');
      buildSpinner.start();

      let buildOutput = '';

      try {
        buildOutput = rebuildRepoPackages(repoRoot as string);
        buildSpinner.succeed('Rebuilt personal-agent packages');
        buildStatus = 'repo packages rebuilt';
      } catch (error) {
        buildSpinner.fail('Unable to rebuild personal-agent packages');
        throw error;
      }

      if (buildOutput.length > 0) {
        console.log(dim(buildOutput));
      }

      currentPhase = 'restart background services';
      summary = await restartBackgroundServices({
        webUiStrategy: 'blue-green',
        repoRoot: repoRoot as string,
        webUiPort: getWebUiServiceOptions({ repoRoot: repoRoot as string }).port,
      });
    } else {
      summary = await restartBackgroundServices();
    }

    console.log('');
    console.log(section('Restart summary'));
    console.log(keyValue('build', buildStatus));
    console.log(keyValue('daemon', summary.daemonStatus));
    console.log(keyValue('web ui', summary.webUiStatus));

    if (
      process.env.PERSONAL_AGENT_RESTART_NOTIFY_INBOX === '1'
      && summary.webUiStatus.startsWith('blue/green')
    ) {
      const profile = process.env.PERSONAL_AGENT_RESTART_NOTIFY_PROFILE?.trim();

      if (profile) {
        try {
          writeRestartCompletionInboxEntry({
            profile,
            repoRoot,
            requestedAt: process.env.PERSONAL_AGENT_RESTART_REQUESTED_AT,
            daemonStatus: summary.daemonStatus,
            webUiStatus: summary.webUiStatus,
          });
        } catch (error) {
          console.log(`  ${warning(`Unable to write restart completion inbox entry: ${(error as Error).message}`)}`);
        }
      }
    }

    return 0;
  } catch (error) {
    if (process.env.PERSONAL_AGENT_RESTART_NOTIFY_INBOX === '1') {
      const profile = process.env.PERSONAL_AGENT_RESTART_NOTIFY_PROFILE?.trim();

      if (profile) {
        try {
          writeRestartFailureInboxEntry({
            profile,
            repoRoot,
            requestedAt: process.env.PERSONAL_AGENT_RESTART_REQUESTED_AT,
            phase: currentPhase,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch (writeError) {
          console.log(`  ${warning(`Unable to write restart failure inbox entry: ${(writeError as Error).message}`)}`);
        }
      }
    }

    throw error;
  } finally {
    clearOwnedApplicationCommandLock('restart');
  }
}

async function updateCommand(args: string[]): Promise<number> {
  const options = parseUpdateOptions(args);

  const repoRoot = getRepoRoot();
  let currentPhase = 'pull latest changes from git';

  try {
    const pullSpinner = spinner('Pulling latest changes from git');
    pullSpinner.start();

    let gitOutput = '';

    try {
      gitOutput = pullLatestFromGit(repoRoot);
      pullSpinner.succeed('Git repository updated');
    } catch (error) {
      pullSpinner.fail('Unable to update repository');
      throw error;
    }

    if (gitOutput.length > 0) {
      console.log(dim(gitOutput));
    }

    let piOutput = '';
    let piVersion = '';
    let piUpdated = false;

    if (!options.repoOnly) {
      currentPhase = `sync repo-local pi to latest (${PI_PACKAGE_NAME})`;
      const piSpinner = spinner(`Syncing repo-local pi to latest (${PI_PACKAGE_NAME})`);
      piSpinner.start();

      try {
        const piUpdateResult = updateRepoPiPackage(repoRoot);
        piOutput = piUpdateResult.output;
        piVersion = piUpdateResult.version;
        piUpdated = true;
        piSpinner.succeed(`Synced repo-local pi to latest (${piVersion})`);
      } catch (error) {
        piSpinner.fail('Unable to sync repo-local pi to latest');
        throw error;
      }

      if (piOutput.length > 0) {
        console.log(dim(piOutput));
      }
    }

    currentPhase = 'rebuild packages';
    const buildSpinner = spinner('Rebuilding personal-agent packages');
    buildSpinner.start();

    let buildOutput = '';

    try {
      buildOutput = rebuildRepoPackages(repoRoot);
      buildSpinner.succeed('Rebuilt personal-agent packages');
    } catch (error) {
      buildSpinner.fail('Unable to rebuild personal-agent packages');
      throw error;
    }

    if (buildOutput.length > 0) {
      console.log(dim(buildOutput));
    }

    currentPhase = 'restart background services';
    const summary = await restartBackgroundServices({
      webUiStrategy: 'blue-green',
      repoRoot,
      webUiPort: getWebUiServiceOptions({ repoRoot }).port,
    });

    console.log('');
    console.log(section('Update summary'));
    console.log(keyValue('repository', repoRoot));
    console.log(keyValue('pi package', options.repoOnly ? 'skipped (--repo-only)' : (piUpdated ? `repo-local (${piVersion})` : 'unknown')));
    console.log(keyValue('build', 'repo packages rebuilt'));
    console.log(keyValue('daemon', summary.daemonStatus));
    console.log(keyValue('web ui', summary.webUiStatus));

    if (
      process.env.PERSONAL_AGENT_UPDATE_NOTIFY_INBOX === '1'
      && summary.webUiStatus.startsWith('blue/green')
    ) {
      const profile = process.env.PERSONAL_AGENT_UPDATE_NOTIFY_PROFILE?.trim();

      if (profile) {
        try {
          writeUpdateCompletionInboxEntry({
            profile,
            repoRoot,
            requestedAt: process.env.PERSONAL_AGENT_UPDATE_REQUESTED_AT,
            daemonStatus: summary.daemonStatus,
            webUiStatus: summary.webUiStatus,
          });
        } catch (error) {
          console.log(`  ${warning(`Unable to write update completion inbox entry: ${(error as Error).message}`)}`);
        }
      }
    }

    return 0;
  } catch (error) {
    if (process.env.PERSONAL_AGENT_UPDATE_NOTIFY_INBOX === '1') {
      const profile = process.env.PERSONAL_AGENT_UPDATE_NOTIFY_PROFILE?.trim();

      if (profile) {
        try {
          writeUpdateFailureInboxEntry({
            profile,
            repoRoot,
            requestedAt: process.env.PERSONAL_AGENT_UPDATE_REQUESTED_AT,
            phase: currentPhase,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch (writeError) {
          console.log(`  ${warning(`Unable to write update failure inbox entry: ${(writeError as Error).message}`)}`);
        }
      }
    }

    throw error;
  } finally {
    clearOwnedApplicationCommandLock('update');
  }
}

interface TaskParseError {
  filePath: string;
  error: string;
}

interface TaskRuntimeRecord {
  id?: string;
  filePath?: string;
  running?: boolean;
  runningStartedAt?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  lastLogPath?: string;
  lastAttemptCount?: number;
  oneTimeResolvedAt?: string;
  oneTimeResolvedStatus?: string;
  oneTimeCompletedAt?: string;
}

const TASK_LIST_STATUS_FILTERS = ['running', 'active', 'completed', 'disabled', 'pending', 'error'] as const;

type TaskListStatus = (typeof TASK_LIST_STATUS_FILTERS)[number];
type TaskListStatusFilter = TaskListStatus | 'all';

interface TaskListEntry {
  task: ParsedTaskDefinition;
  runtime: TaskRuntimeRecord | undefined;
  status: TaskListStatus;
}

function isTaskStateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function listTaskDefinitionFiles(taskDir: string): string[] {
  if (!existsSync(taskDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [resolve(taskDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!entry.name.endsWith('.task.md')) {
        continue;
      }

      output.push(fullPath);
    }
  }

  output.sort();
  return output;
}

function loadTaskDefinitions(taskDir: string, defaultTimeoutSeconds: number): {
  tasks: ParsedTaskDefinition[];
  parseErrors: TaskParseError[];
} {
  const files = listTaskDefinitionFiles(taskDir);
  const tasks: ParsedTaskDefinition[] = [];
  const parseErrors: TaskParseError[] = [];

  for (const filePath of files) {
    try {
      const task = parseTaskDefinition({
        filePath,
        rawContent: readFileSync(filePath, 'utf-8'),
        defaultTimeoutSeconds,
      });
      tasks.push(task);
    } catch (error) {
      parseErrors.push({
        filePath,
        error: (error as Error).message,
      });
    }
  }

  tasks.sort((left, right) => left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath));

  return {
    tasks,
    parseErrors,
  };
}

function resolveTaskRuntimePaths(config: ReturnType<typeof loadDaemonConfig>): {
  taskDir: string;
  stateFile: string;
  runsRoot: string;
} {
  const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
  return {
    taskDir: config.modules.tasks.taskDir,
    stateFile: join(daemonPaths.root, 'task-state.json'),
    runsRoot: resolveDurableRunsRoot(daemonPaths.root),
  };
}

function loadTaskRuntimeState(stateFile: string): Record<string, TaskRuntimeRecord> {
  if (!existsSync(stateFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as unknown;
    if (!isTaskStateRecord(parsed)) {
      return {};
    }

    const tasks = parsed.tasks;
    if (!isTaskStateRecord(tasks)) {
      return {};
    }

    const output: Record<string, TaskRuntimeRecord> = {};

    for (const [key, value] of Object.entries(tasks)) {
      if (!isTaskStateRecord(value)) {
        continue;
      }

      output[key] = {
        id: typeof value.id === 'string' ? value.id : undefined,
        filePath: typeof value.filePath === 'string' ? value.filePath : undefined,
        running: typeof value.running === 'boolean' ? value.running : undefined,
        runningStartedAt: typeof value.runningStartedAt === 'string' ? value.runningStartedAt : undefined,
        lastStatus: typeof value.lastStatus === 'string' ? value.lastStatus : undefined,
        lastRunAt: typeof value.lastRunAt === 'string' ? value.lastRunAt : undefined,
        lastSuccessAt: typeof value.lastSuccessAt === 'string' ? value.lastSuccessAt : undefined,
        lastFailureAt: typeof value.lastFailureAt === 'string' ? value.lastFailureAt : undefined,
        lastError: typeof value.lastError === 'string' ? value.lastError : undefined,
        lastLogPath: typeof value.lastLogPath === 'string' ? value.lastLogPath : undefined,
        lastAttemptCount: typeof value.lastAttemptCount === 'number' ? value.lastAttemptCount : undefined,
        oneTimeResolvedAt: typeof value.oneTimeResolvedAt === 'string' ? value.oneTimeResolvedAt : undefined,
        oneTimeResolvedStatus: typeof value.oneTimeResolvedStatus === 'string' ? value.oneTimeResolvedStatus : undefined,
        oneTimeCompletedAt: typeof value.oneTimeCompletedAt === 'string' ? value.oneTimeCompletedAt : undefined,
      };
    }

    return output;
  } catch {
    return {};
  }
}

function formatTaskSchedule(task: ParsedTaskDefinition): string {
  if (task.schedule.type === 'cron') {
    return `cron ${task.schedule.expression}`;
  }

  return `at ${task.schedule.at}`;
}

function resolveTaskListStatus(
  task: ParsedTaskDefinition,
  runtime: TaskRuntimeRecord | undefined,
): TaskListStatus {
  if (runtime?.running === true) {
    return 'running';
  }

  if (
    task.schedule.type === 'at'
    && (runtime?.oneTimeCompletedAt || runtime?.oneTimeResolvedStatus === 'success')
  ) {
    return 'completed';
  }

  if (runtime?.lastStatus === 'failed') {
    return 'error';
  }

  if (runtime?.lastStatus === 'skipped') {
    return 'pending';
  }

  return task.enabled ? 'active' : 'disabled';
}

function toTaskListEntry(task: ParsedTaskDefinition, runtimeState: Record<string, TaskRuntimeRecord>): TaskListEntry {
  const runtime = runtimeState[task.key];

  return {
    task,
    runtime,
    status: resolveTaskListStatus(task, runtime),
  };
}

function toTaskListPayload(entry: TaskListEntry): {
  id: string;
  enabled: boolean;
  status: TaskListStatus;
  schedule: string;
  profile: string;
  model: string | null;
  cwd: string | null;
  timeoutSeconds: number;
  filePath: string;
  runtime: TaskRuntimeRecord | null;
} {
  const { task, runtime, status } = entry;

  return {
    id: task.id,
    enabled: task.enabled,
    status,
    schedule: formatTaskSchedule(task),
    profile: task.profile,
    model: task.modelRef ?? null,
    cwd: task.cwd ?? null,
    timeoutSeconds: task.timeoutSeconds,
    filePath: task.filePath,
    runtime: runtime ?? null,
  };
}

function parseTaskTailCount(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error('Usage: pa tasks logs <id> [--tail <count>]');
  }

  const count = Number.parseInt(raw, 10);

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('Usage: pa tasks logs <id> [--tail <count>]');
  }

  return count;
}

function listLogFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.log')) {
        output.push(fullPath);
      }
    }
  }

  return output;
}

function findLatestTaskLogFile(runsRoot: string, taskId: string): string | undefined {
  const entries = scanDurableRunsForRecovery(runsRoot)
    .filter((run) => run.manifest?.kind === 'scheduled-task')
    .filter((run) => run.manifest?.source?.id === taskId || run.manifest?.spec.taskId === taskId)
    .flatMap((run) => listLogFiles(run.paths.root));

  if (entries.length === 0) {
    return undefined;
  }

  const withMtime = entries.map((path) => ({
    path,
    mtimeMs: statSync(path).mtimeMs,
  }));

  withMtime.sort((left, right) => right.mtimeMs - left.mtimeMs);

  return withMtime[0]?.path;
}

function resolveTaskById(tasks: ParsedTaskDefinition[], id: string): ParsedTaskDefinition {
  const matches = tasks.filter((task) => task.id === id);

  if (matches.length === 0) {
    throw new Error(`No task found with id: ${id}`);
  }

  if (matches.length > 1) {
    const files = matches.map((task) => task.filePath).join(', ');
    throw new Error(`Task id is ambiguous (${id}). Matches: ${files}`);
  }

  return matches[0] as ParsedTaskDefinition;
}

function isTaskOption(arg: string): boolean {
  return arg.startsWith('-');
}

function taskListUsageText(): string {
  return `Usage: pa tasks list [--json] [--status <all|${TASK_LIST_STATUS_FILTERS.join('|')}>]`;
}

function isTaskListStatus(value: string): value is TaskListStatus {
  return (TASK_LIST_STATUS_FILTERS as readonly string[]).includes(value);
}

function parseTaskListStatusFilter(value: string): TaskListStatusFilter {
  if (value === 'all') {
    return value;
  }

  if (isTaskListStatus(value)) {
    return value;
  }

  throw new Error(taskListUsageText());
}

function parseTaskListOptions(args: string[]): {
  jsonMode: boolean;
  statusFilter: TaskListStatusFilter;
} {
  let jsonMode = false;
  let statusFilter: TaskListStatusFilter = 'all';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    if (arg === '--status') {
      const nextValue = args[index + 1];
      if (!nextValue || isTaskOption(nextValue)) {
        throw new Error(taskListUsageText());
      }

      statusFilter = parseTaskListStatusFilter(nextValue);
      index += 1;
      continue;
    }

    if (arg.startsWith('--status=')) {
      const value = arg.slice('--status='.length);
      if (!value) {
        throw new Error(taskListUsageText());
      }

      statusFilter = parseTaskListStatusFilter(value);
      continue;
    }

    throw new Error(taskListUsageText());
  }

  return {
    jsonMode,
    statusFilter,
  };
}

function printTasksHelp(): void {
  console.log(section('Tasks commands'));
  console.log('');
  console.log(`Usage: pa tasks [list|show|validate|logs|help]

Commands:
  list [--json] [--status <all|running|active|completed|disabled|pending|error>]
                           List parsed scheduled tasks with runtime status
  show <id> [--json]       Show one task definition and runtime state
  validate [--all|file]    Validate task file frontmatter and prompt body
  logs <id> [--tail <n>]   Show latest task run log (default: 80 lines)
  help                     Show tasks help
`);

  const config = loadDaemonConfig();
  console.log(keyValue('Task directory', config.modules.tasks.taskDir));
}

async function tasksCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    printTasksHelp();
    return 0;
  }

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(rest, 'pa tasks help');
    printTasksHelp();
    return 0;
  }

  if (subcommand === 'list') {
    const { jsonMode, statusFilter } = parseTaskListOptions(rest);

    const config = loadDaemonConfig();
    const paths = resolveTaskRuntimePaths(config);
    const { tasks, parseErrors } = loadTaskDefinitions(paths.taskDir, config.modules.tasks.defaultTimeoutSeconds);
    const runtimeState = loadTaskRuntimeState(paths.stateFile);

    const taskEntries = tasks.map((task) => toTaskListEntry(task, runtimeState));
    const filteredTaskEntries = statusFilter === 'all'
      ? taskEntries
      : taskEntries.filter((entry) => entry.status === statusFilter);
    const completedTaskEntries = taskEntries.filter((entry) => entry.status === 'completed');

    const payload = {
      paths,
      filters: {
        status: statusFilter,
        supportedStatus: ['all', ...TASK_LIST_STATUS_FILTERS],
      },
      tasks: filteredTaskEntries.map((entry) => toTaskListPayload(entry)),
      sections: {
        completed: completedTaskEntries.map((entry) => toTaskListPayload(entry)),
      },
      parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Scheduled tasks'));
    console.log(keyValue('Task directory', paths.taskDir));
    console.log(keyValue('Task state file', paths.stateFile));
    console.log(keyValue('Status filter', statusFilter));

    if (tasks.length === 0) {
      console.log(dim('No valid task files found.'));
    } else if (filteredTaskEntries.length === 0) {
      console.log(dim(`No tasks matched status filter: ${statusFilter}`));
    }

    for (const entry of filteredTaskEntries) {
      const { task, runtime } = entry;
      const status = statusChip(entry.status);

      console.log('');
      console.log(bullet(`${task.id}: ${status}`));
      console.log(keyValue('Schedule', formatTaskSchedule(task), 4));
      console.log(keyValue('Profile', task.profile, 4));
      console.log(keyValue('File', task.filePath, 4));

      if (runtime?.lastRunAt) {
        console.log(keyValue('Last run', new Date(runtime.lastRunAt).toLocaleString(), 4));
      }

      if (runtime?.lastStatus) {
        console.log(keyValue('Last status', runtime.lastStatus, 4));
      }
    }

    if (parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${parseErrors.length} task file(s) failed to parse`));
      for (const issue of parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    return parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'show') {
    const jsonMode = hasOption(rest, '--json');
    const nonJsonArgs = rest.filter((arg) => arg !== '--json');
    const unknownOptions = rest.filter((arg) => isTaskOption(arg) && arg !== '--json');

    if (unknownOptions.length > 0 || nonJsonArgs.length !== 1) {
      throw new Error('Usage: pa tasks show <id> [--json]');
    }

    const taskId = nonJsonArgs[0] as string;
    const config = loadDaemonConfig();
    const paths = resolveTaskRuntimePaths(config);
    const { tasks } = loadTaskDefinitions(paths.taskDir, config.modules.tasks.defaultTimeoutSeconds);
    const runtimeState = loadTaskRuntimeState(paths.stateFile);
    const task = resolveTaskById(tasks, taskId);
    const runtime = runtimeState[task.key];

    const payload = {
      paths,
      task,
      runtime: runtime ?? null,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section(`Task: ${task.id}`));
    console.log(keyValue('Schedule', formatTaskSchedule(task)));
    console.log(keyValue('Enabled', task.enabled ? 'yes' : 'no'));
    console.log(keyValue('Profile', task.profile));
    console.log(keyValue('File', task.filePath));
    console.log(keyValue('Task directory', paths.taskDir));

    if (task.modelRef) {
      console.log(keyValue('Model', task.modelRef));
    }

    if (task.cwd) {
      console.log(keyValue('CWD', task.cwd));
    }

    console.log(keyValue('Timeout', `${task.timeoutSeconds}s`));

    if (runtime) {
      console.log('');
      console.log(section('Runtime'));
      if (runtime.lastStatus) {
        console.log(keyValue('Last status', runtime.lastStatus));
      }

      if (runtime.lastRunAt) {
        console.log(keyValue('Last run', new Date(runtime.lastRunAt).toLocaleString()));
      }

      if (runtime.runningStartedAt) {
        console.log(keyValue('Running since', new Date(runtime.runningStartedAt).toLocaleString()));
      }

      if (runtime.lastLogPath) {
        console.log(keyValue('Last log', runtime.lastLogPath));
      }

      if (runtime.lastError) {
        console.log(uiError('Task runtime', runtime.lastError));
      }
    }

    console.log('');
    console.log(section('Prompt'));
    console.log(task.prompt);
    return 0;
  }

  if (subcommand === 'validate') {
    let jsonMode = false;
    let allMode = false;
    const positional: string[] = [];

    for (const arg of rest) {
      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--all') {
        allMode = true;
        continue;
      }

      if (arg.startsWith('--')) {
        throw new Error('Usage: pa tasks validate [--all|file] [--json]');
      }

      positional.push(arg);
    }

    if (positional.length > 1) {
      throw new Error('Usage: pa tasks validate [--all|file] [--json]');
    }

    if (allMode && positional.length > 0) {
      throw new Error('Usage: pa tasks validate [--all|file] [--json]');
    }

    const config = loadDaemonConfig();
    const paths = resolveTaskRuntimePaths(config);

    const files = allMode || positional.length === 0
      ? listTaskDefinitionFiles(paths.taskDir)
      : [resolve(positional[0] as string)];

    const results = files.map((filePath) => {
      try {
        parseTaskDefinition({
          filePath,
          rawContent: readFileSync(filePath, 'utf-8'),
          defaultTimeoutSeconds: config.modules.tasks.defaultTimeoutSeconds,
        });

        return {
          filePath,
          valid: true,
          error: null,
        };
      } catch (error) {
        return {
          filePath,
          valid: false,
          error: (error as Error).message,
        };
      }
    });

    const invalidCount = results.filter((result) => !result.valid).length;

    if (jsonMode) {
      console.log(JSON.stringify({
        taskDir: paths.taskDir,
        checked: results.length,
        invalid: invalidCount,
        results,
      }, null, 2));
      return invalidCount > 0 ? 1 : 0;
    }

    console.log(section('Task validation'));
    console.log(keyValue('Task directory', paths.taskDir));
    console.log(keyValue('Files checked', results.length));

    if (results.length === 0) {
      console.log(dim('No task files found.'));
      return 0;
    }

    for (const result of results) {
      const label = result.valid ? success('valid') : uiError('invalid', result.error || 'unknown error');
      console.log(bullet(`${result.filePath}`));
      console.log(`    ${label}`);
    }

    if (invalidCount > 0) {
      console.log('');
      console.log(uiError('Validation failed', `${invalidCount} file(s) are invalid`));
      return 1;
    }

    console.log('');
    console.log(success('All task files are valid'));
    return 0;
  }

  if (subcommand === 'logs') {
    let tail = 80;
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--tail') {
        const value = rest[index + 1];
        if (!value) {
          throw new Error('Usage: pa tasks logs <id> [--tail <count>]');
        }

        tail = parseTaskTailCount(value);
        index += 1;
        continue;
      }

      if (arg.startsWith('--')) {
        throw new Error('Usage: pa tasks logs <id> [--tail <count>]');
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error('Usage: pa tasks logs <id> [--tail <count>]');
    }

    const taskId = positional[0] as string;
    const config = loadDaemonConfig();
    const paths = resolveTaskRuntimePaths(config);
    const { tasks } = loadTaskDefinitions(paths.taskDir, config.modules.tasks.defaultTimeoutSeconds);
    const runtimeState = loadTaskRuntimeState(paths.stateFile);
    const task = resolveTaskById(tasks, taskId);

    let logPath = runtimeState[task.key]?.lastLogPath;

    if (!logPath || !existsSync(logPath)) {
      logPath = findLatestTaskLogFile(paths.runsRoot, task.id);
    }

    if (!logPath || !existsSync(logPath)) {
      throw new Error(`No logs found for task: ${taskId}`);
    }

    const tailOutput = readTailLines(logPath, tail);

    console.log(section(`Task logs: ${task.id}`));
    console.log(keyValue('Log file', logPath));
    console.log('');
    console.log(tailOutput.length > 0 ? tailOutput : dim('(empty log)'));

    return 0;
  }

  throw new Error(`Unknown tasks subcommand: ${subcommand}`);
}

type InboxReadFilter = 'all' | 'read' | 'unread';
type InboxItemKindFilter = 'all' | 'activity' | 'conversation';
type InboxNotificationState = 'none' | 'queued' | 'sent' | 'failed';

type InboxActivityEntry = ReturnType<typeof listProfileActivityEntries>[number]['entry'] & {
  relatedConversationIds?: string[];
};

type InboxActivityStateEntry = {
  path: string;
  entry: InboxActivityEntry;
  read: boolean;
};

type InboxConversationStateEntry = ReturnType<typeof listStoredSessions>[number] & {
  needsAttention: boolean;
  attentionUpdatedAt: string;
  attentionUnreadMessageCount: number;
  attentionUnreadActivityCount: number;
  attentionActivityIds: string[];
};

type InboxSurfaceEntry =
  | {
      kind: 'activity';
      key: string;
      id: string;
      sortAt: string;
      read: boolean;
      path: string;
      entry: InboxActivityEntry;
    }
  | {
      kind: 'conversation';
      key: string;
      id: string;
      sortAt: string;
      read: false;
      session: InboxConversationStateEntry;
    };

type InboxSelector = {
  kind: 'activity' | 'conversation' | 'auto';
  id: string;
  raw: string;
};

function inboxListUsageText(): string {
  return 'Usage: pa inbox [list] [--json] [--limit <count>] [--all|--read|--unread] [--activities|--conversations]';
}

function inboxCreateUsageText(): string {
  return 'Usage: pa inbox create <summary> [--details <text>] [--kind <kind>] [--id <id>] [--project <id>]... [--conversation <id>]... [--notify <none|queued|sent|failed>] [--created-at <iso>] [--json]';
}

function inboxReadUsageText(subcommand: 'read' | 'unread'): string {
  return `Usage: pa inbox ${subcommand} <selector>... [--all] [--json]`;
}

function inboxDeleteUsageText(): string {
  return 'Usage: pa inbox delete <activity-selector>... [--json]';
}

function readRequiredOptionValue(args: string[], index: number, usageText: string): string {
  const nextValue = args[index + 1];
  if (!nextValue) {
    throw new Error(usageText);
  }

  return nextValue;
}

function normalizeIsoTimestamp(value: string, usageText: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(usageText);
  }

  return parsed.toISOString();
}

function parseInboxNotificationState(value: string): InboxNotificationState {
  const normalized = value.trim();

  if (normalized === 'none' || normalized === 'queued' || normalized === 'sent' || normalized === 'failed') {
    return normalized;
  }

  throw new Error(inboxCreateUsageText());
}

function sanitizeInboxActivityIdSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'item';
}

function buildDefaultInboxActivityId(kind: string, summary: string, createdAt: string): string {
  const kindSegment = sanitizeInboxActivityIdSegment(kind);
  const createdAtSegment = sanitizeInboxActivityIdSegment(createdAt.replace(/[.:]/g, '-'));
  const summarySegment = sanitizeInboxActivityIdSegment(summary).slice(0, 48);
  return [kindSegment, createdAtSegment, summarySegment || 'item'].join('-');
}

function resolveUniqueInboxActivityId(repoRoot: string, profile: string, desiredId: string): string {
  if (!existsSync(resolveActivityEntryPath({ repoRoot, profile, activityId: desiredId }))) {
    return desiredId;
  }

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${desiredId}-${suffix}`;
    if (!existsSync(resolveActivityEntryPath({ repoRoot, profile, activityId: candidate }))) {
      return candidate;
    }
  }

  throw new Error(`Unable to allocate a unique inbox id based on: ${desiredId}`);
}

function attachActivityConversationLinks(profile: string, entry: ReturnType<typeof listProfileActivityEntries>[number]['entry']): InboxActivityEntry {
  const relatedConversationIds = getActivityConversationLink({
    profile,
    activityId: entry.id,
  })?.relatedConversationIds;

  if (!relatedConversationIds || relatedConversationIds.length === 0) {
    return entry;
  }

  return {
    ...entry,
    relatedConversationIds,
  };
}

function buildConversationAttentionReason(session: InboxConversationStateEntry): string {
  const parts: string[] = [];

  if (session.attentionUnreadActivityCount > 0) {
    parts.push(`${session.attentionUnreadActivityCount} linked update${session.attentionUnreadActivityCount === 1 ? '' : 's'}`);
  }

  if (session.attentionUnreadMessageCount > 0) {
    parts.push(`${session.attentionUnreadMessageCount} new message${session.attentionUnreadMessageCount === 1 ? '' : 's'}`);
  }

  return parts.join(', ') || 'needs attention';
}

function parseInboxSelector(value: string): InboxSelector {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Inbox selector must not be empty.');
  }

  if (trimmed.startsWith('activity:')) {
    const id = trimmed.slice('activity:'.length);
    validateActivityId(id);
    return { kind: 'activity', id, raw: trimmed };
  }

  if (trimmed.startsWith('conversation:')) {
    const id = trimmed.slice('conversation:'.length);
    return { kind: 'conversation', id, raw: trimmed };
  }

  return {
    kind: 'auto',
    id: trimmed,
    raw: trimmed,
  };
}

function parseInboxListOptions(args: string[]): {
  jsonMode: boolean;
  limit: number;
  readFilter: InboxReadFilter;
  itemKindFilter: InboxItemKindFilter;
} {
  let jsonMode = false;
  let limit = 20;
  let readFilter: InboxReadFilter = 'all';
  let itemKindFilter: InboxItemKindFilter = 'all';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    if (arg === '--all') {
      readFilter = 'all';
      continue;
    }

    if (arg === '--read') {
      readFilter = 'read';
      continue;
    }

    if (arg === '--unread') {
      readFilter = 'unread';
      continue;
    }

    if (arg === '--activities') {
      itemKindFilter = 'activity';
      continue;
    }

    if (arg === '--conversations') {
      itemKindFilter = 'conversation';
      continue;
    }

    if (arg === '--limit') {
      const parsed = Number.parseInt(readRequiredOptionValue(args, index, inboxListUsageText()), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(inboxListUsageText());
      }

      limit = parsed;
      index += 1;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = arg.slice('--limit='.length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(inboxListUsageText());
      }

      limit = parsed;
      continue;
    }

    throw new Error(inboxListUsageText());
  }

  return {
    jsonMode,
    limit,
    readFilter,
    itemKindFilter,
  };
}

function parseInboxCreateOptions(args: string[]): {
  jsonMode: boolean;
  id?: string;
  kind: string;
  summary: string;
  details?: string;
  relatedProjectIds?: string[];
  relatedConversationIds?: string[];
  notificationState?: InboxNotificationState;
  createdAt: string;
} {
  let jsonMode = false;
  let id: string | undefined;
  let kind = 'note';
  let summary: string | undefined;
  let details: string | undefined;
  const relatedProjectIds: string[] = [];
  const relatedConversationIds: string[] = [];
  let notificationState: InboxNotificationState | undefined;
  let createdAt = new Date().toISOString();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    if (arg === '--id') {
      id = readRequiredOptionValue(args, index, inboxCreateUsageText());
      index += 1;
      continue;
    }

    if (arg.startsWith('--id=')) {
      id = arg.slice('--id='.length);
      continue;
    }

    if (arg === '--kind') {
      kind = readRequiredOptionValue(args, index, inboxCreateUsageText());
      index += 1;
      continue;
    }

    if (arg.startsWith('--kind=')) {
      kind = arg.slice('--kind='.length);
      continue;
    }

    if (arg === '--details') {
      details = readRequiredOptionValue(args, index, inboxCreateUsageText());
      index += 1;
      continue;
    }

    if (arg.startsWith('--details=')) {
      details = arg.slice('--details='.length);
      continue;
    }

    if (arg === '--project') {
      relatedProjectIds.push(readRequiredOptionValue(args, index, inboxCreateUsageText()));
      index += 1;
      continue;
    }

    if (arg.startsWith('--project=')) {
      relatedProjectIds.push(arg.slice('--project='.length));
      continue;
    }

    if (arg === '--conversation') {
      relatedConversationIds.push(readRequiredOptionValue(args, index, inboxCreateUsageText()));
      index += 1;
      continue;
    }

    if (arg.startsWith('--conversation=')) {
      relatedConversationIds.push(arg.slice('--conversation='.length));
      continue;
    }

    if (arg === '--notify') {
      notificationState = parseInboxNotificationState(readRequiredOptionValue(args, index, inboxCreateUsageText()));
      index += 1;
      continue;
    }

    if (arg.startsWith('--notify=')) {
      notificationState = parseInboxNotificationState(arg.slice('--notify='.length));
      continue;
    }

    if (arg === '--created-at') {
      createdAt = normalizeIsoTimestamp(readRequiredOptionValue(args, index, inboxCreateUsageText()), inboxCreateUsageText());
      index += 1;
      continue;
    }

    if (arg.startsWith('--created-at=')) {
      createdAt = normalizeIsoTimestamp(arg.slice('--created-at='.length), inboxCreateUsageText());
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(inboxCreateUsageText());
    }

    if (summary) {
      throw new Error(inboxCreateUsageText());
    }

    summary = arg;
  }

  if (!summary) {
    throw new Error(inboxCreateUsageText());
  }

  if (id) {
    validateActivityId(id);
  }

  return {
    jsonMode,
    id,
    kind: kind.trim(),
    summary: summary.trim(),
    details: details?.trim(),
    relatedProjectIds: relatedProjectIds.length > 0 ? relatedProjectIds : undefined,
    relatedConversationIds: relatedConversationIds.length > 0 ? relatedConversationIds : undefined,
    notificationState,
    createdAt,
  };
}

function parseInboxReadToggleOptions(args: string[], subcommand: 'read' | 'unread'): {
  jsonMode: boolean;
  markAll: boolean;
  selectors: InboxSelector[];
} {
  let jsonMode = false;
  let markAll = false;
  const selectors: InboxSelector[] = [];

  for (const arg of args) {
    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    if (arg === '--all') {
      markAll = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(inboxReadUsageText(subcommand));
    }

    selectors.push(parseInboxSelector(arg));
  }

  if ((markAll && selectors.length > 0) || (!markAll && selectors.length === 0)) {
    throw new Error(inboxReadUsageText(subcommand));
  }

  return {
    jsonMode,
    markAll,
    selectors,
  };
}

function parseInboxDeleteOptions(args: string[]): {
  jsonMode: boolean;
  selectors: InboxSelector[];
} {
  let jsonMode = false;
  const selectors: InboxSelector[] = [];

  for (const arg of args) {
    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(inboxDeleteUsageText());
    }

    selectors.push(parseInboxSelector(arg));
  }

  if (selectors.length === 0) {
    throw new Error(inboxDeleteUsageText());
  }

  return {
    jsonMode,
    selectors,
  };
}

function loadInboxState(): {
  repoRoot: string;
  profile: string;
  activityDir: string;
  readState: Set<string>;
  sessions: ReturnType<typeof listStoredSessions>;
  activityEntries: InboxActivityStateEntry[];
  standaloneActivityEntries: InboxActivityStateEntry[];
  conversationEntries: InboxConversationStateEntry[];
  surfaceEntries: InboxSurfaceEntry[];
} {
  const profile = resolveProfileName();
  const repoRoot = getRepoRoot();
  const activityDir = resolveProfileActivityDir({ repoRoot, profile });
  const readState = loadProfileActivityReadState({ repoRoot, profile });
  const activityEntries = listProfileActivityEntries({ repoRoot, profile })
    .map(({ path, entry }) => ({
      path,
      entry: attachActivityConversationLinks(profile, entry),
      read: readState.has(entry.id),
    }));

  const sessions = listStoredSessions();
  ensureConversationAttentionBaselines({
    profile,
    conversations: sessions.map((session) => ({
      conversationId: session.id,
      messageCount: session.messageCount,
    })),
  });

  const conversationSummaries = summarizeConversationAttention({
    profile,
    conversations: sessions.map((session) => ({
      conversationId: session.id,
      messageCount: session.messageCount,
      lastActivityAt: session.lastActivityAt,
    })),
    unreadActivityEntries: activityEntries
      .filter(({ read, entry }) => !read && entry.relatedConversationIds && entry.relatedConversationIds.length > 0)
      .map(({ entry }) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        relatedConversationIds: entry.relatedConversationIds ?? [],
      })),
  });

  const summaryByConversationId = new Map(conversationSummaries.map((summary) => [summary.conversationId, summary]));
  const knownConversationIds = new Set(sessions.map((session) => session.id));
  const standaloneActivityEntries = activityEntries.filter(({ entry }) => {
    return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
  });
  const conversationEntries = sessions.flatMap((session) => {
    const summary = summaryByConversationId.get(session.id);
    if (!summary?.needsAttention) {
      return [];
    }

    return [{
      ...session,
      needsAttention: true,
      attentionUpdatedAt: summary.attentionUpdatedAt,
      attentionUnreadMessageCount: summary.unreadMessageCount,
      attentionUnreadActivityCount: summary.unreadActivityCount,
      attentionActivityIds: summary.unreadActivityIds,
    } satisfies InboxConversationStateEntry];
  });
  const surfaceEntries: InboxSurfaceEntry[] = [
    ...standaloneActivityEntries.map(({ path, entry, read }) => ({
      kind: 'activity' as const,
      key: `activity:${entry.id}`,
      id: entry.id,
      sortAt: entry.createdAt,
      read,
      path,
      entry,
    })),
    ...conversationEntries.map((session) => ({
      kind: 'conversation' as const,
      key: `conversation:${session.id}`,
      id: session.id,
      sortAt: session.attentionUpdatedAt,
      read: false as const,
      session,
    })),
  ].sort((left, right) => {
    const sortCompare = right.sortAt.localeCompare(left.sortAt);
    if (sortCompare !== 0) {
      return sortCompare;
    }

    return left.key.localeCompare(right.key);
  });

  return {
    repoRoot,
    profile,
    activityDir,
    readState,
    sessions,
    activityEntries,
    standaloneActivityEntries,
    conversationEntries,
    surfaceEntries,
  };
}

function resolveInboxActivityEntry(state: ReturnType<typeof loadInboxState>, selector: InboxSelector): InboxActivityStateEntry | null {
  if (selector.kind === 'conversation') {
    return null;
  }

  const matches = state.activityEntries.filter(({ entry }) => entry.id === selector.id);
  if (matches.length === 0) {
    return null;
  }

  if (selector.kind === 'auto' && state.conversationEntries.some((entry) => entry.id === selector.id)) {
    throw new Error(`Ambiguous inbox selector: ${selector.raw}. Use activity:${selector.id} or conversation:${selector.id}.`);
  }

  return matches[0] ?? null;
}

function printInboxHelp(): void {
  console.log(section('Inbox commands'));
  console.log('');
  console.log(`Usage: pa inbox [list|show|create|read|unread|delete|help] [args...]

Commands:
  list [--json] [--limit <count>] [--all|--read|--unread] [--activities|--conversations]
                           List inbox items (default when no subcommand is provided)
  show <selector> [--json] Show one inbox activity or conversation attention item
  create <summary> [options]
                           Create a standalone inbox activity entry
  read <selector>... [--all] [--json]
                           Mark inbox items as read
  unread <selector>... [--all] [--json]
                           Mark inbox items as unread
  delete <activity-selector>... [--json]
                           Delete inbox activity entries
  help                     Show inbox help
`);
}

async function inboxCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(rest, 'pa inbox help');
    printInboxHelp();
    return 0;
  }

  const treatAsList = !subcommand || subcommand === 'list' || subcommand.startsWith('--');
  const effectiveSubcommand = treatAsList ? 'list' : subcommand;

  if (effectiveSubcommand === 'list') {
    const listArgs = !subcommand || subcommand.startsWith('--') ? args : rest;
    const { jsonMode, limit, readFilter, itemKindFilter } = parseInboxListOptions(listArgs);
    const { profile, activityDir, standaloneActivityEntries, conversationEntries, surfaceEntries } = loadInboxState();
    const filteredEntries = surfaceEntries.filter((entry) => {
      if (itemKindFilter !== 'all' && entry.kind !== itemKindFilter) {
        return false;
      }

      if (readFilter === 'read') {
        return entry.kind === 'activity' && entry.read;
      }

      if (readFilter === 'unread') {
        return !entry.read;
      }

      return true;
    });
    const limitedEntries = filteredEntries.slice(0, limit);

    const payload = {
      profile,
      activityDir,
      count: surfaceEntries.length,
      filteredCount: filteredEntries.length,
      limit,
      filter: readFilter,
      itemKindFilter,
      counts: {
        activities: standaloneActivityEntries.length,
        conversations: conversationEntries.length,
        unread: surfaceEntries.filter((entry) => !entry.read).length,
      },
      entries: limitedEntries.map((entry) => {
        if (entry.kind === 'activity') {
          return {
            ...entry.entry,
            key: entry.key,
            path: entry.path,
            read: entry.read,
          };
        }

        return {
          kind: entry.kind,
          key: entry.key,
          id: entry.session.id,
          title: entry.session.title,
          sessionFile: entry.session.file,
          cwd: entry.session.cwd,
          lastActivityAt: entry.session.lastActivityAt,
          attentionUpdatedAt: entry.session.attentionUpdatedAt,
          read: false,
          unreadMessageCount: entry.session.attentionUnreadMessageCount,
          unreadActivityCount: entry.session.attentionUnreadActivityCount,
          attentionActivityIds: entry.session.attentionActivityIds,
          summary: buildConversationAttentionReason(entry.session),
        };
      }),
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section('Inbox'));
    console.log(keyValue('Profile', profile));
    console.log(keyValue('Activity directory', activityDir));
    console.log(keyValue('Filter', readFilter));
    console.log(keyValue('Kinds', itemKindFilter));
    console.log(keyValue('Showing', `${limitedEntries.length} of ${filteredEntries.length}${filteredEntries.length === surfaceEntries.length ? '' : ` (${surfaceEntries.length} total)`}`));

    if (limitedEntries.length === 0) {
      console.log(dim('No inbox items.'));
      return 0;
    }

    for (const entry of limitedEntries) {
      console.log('');
      if (entry.kind === 'activity') {
        console.log(bullet(`activity:${entry.entry.id}: ${entry.entry.summary}`));
        console.log(keyValue('Kind', entry.entry.kind, 4));
        console.log(keyValue('Created', new Date(entry.entry.createdAt).toLocaleString(), 4));
        console.log(keyValue('Read', entry.read ? 'yes' : 'no', 4));
        console.log(keyValue('Notification', entry.entry.notificationState ?? 'none', 4));

        if (entry.entry.relatedProjectIds && entry.entry.relatedProjectIds.length > 0) {
          console.log(keyValue('Projects', entry.entry.relatedProjectIds.join(', '), 4));
        }

        if (entry.entry.relatedConversationIds && entry.entry.relatedConversationIds.length > 0) {
          console.log(keyValue('Conversations', entry.entry.relatedConversationIds.join(', '), 4));
        }

        continue;
      }

      console.log(bullet(`conversation:${entry.session.id}: ${entry.session.title}`));
      console.log(keyValue('Reason', buildConversationAttentionReason(entry.session), 4));
      console.log(keyValue('Updated', new Date(entry.session.attentionUpdatedAt).toLocaleString(), 4));
      console.log(keyValue('Last activity', new Date(entry.session.lastActivityAt).toLocaleString(), 4));
      console.log(keyValue('Messages', String(entry.session.messageCount), 4));
      console.log(keyValue('Cwd', entry.session.cwd, 4));
    }

    return 0;
  }

  if (effectiveSubcommand === 'show') {
    const jsonMode = hasOption(rest, '--json');
    const nonJsonArgs = rest.filter((arg) => arg !== '--json');
    const unknownOptions = rest.filter((arg) => arg.startsWith('--') && arg !== '--json');

    if (unknownOptions.length > 0 || nonJsonArgs.length !== 1) {
      throw new Error('Usage: pa inbox show <selector> [--json]');
    }

    const selector = parseInboxSelector(nonJsonArgs[0] as string);
    const state = loadInboxState();

    const activityMatch = resolveInboxActivityEntry(state, selector);
    const conversationMatch = (selector.kind === 'activity')
      ? null
      : state.conversationEntries.find((entry) => entry.id === selector.id) ?? null;

    if (!activityMatch && !conversationMatch) {
      throw new Error(`No inbox item found for selector: ${selector.raw}`);
    }

    if (activityMatch && conversationMatch) {
      throw new Error(`Ambiguous inbox selector: ${selector.raw}. Use activity:${selector.id} or conversation:${selector.id}.`);
    }

    if (activityMatch) {
      const payload = {
        profile: state.profile,
        activityDir: state.activityDir,
        path: activityMatch.path,
        entry: {
          ...activityMatch.entry,
          read: activityMatch.read,
        },
      };

      if (jsonMode) {
        console.log(JSON.stringify(payload, null, 2));
        return 0;
      }

      console.log(section(`Inbox activity: ${activityMatch.entry.id}`));
      console.log(keyValue('Profile', state.profile));
      console.log(keyValue('Activity directory', state.activityDir));
      console.log(keyValue('Path', activityMatch.path));
      console.log(keyValue('Kind', activityMatch.entry.kind));
      console.log(keyValue('Created', new Date(activityMatch.entry.createdAt).toLocaleString()));
      console.log(keyValue('Read', activityMatch.read ? 'yes' : 'no'));
      console.log(keyValue('Notification', activityMatch.entry.notificationState ?? 'none'));

      if (activityMatch.entry.relatedProjectIds && activityMatch.entry.relatedProjectIds.length > 0) {
        console.log(keyValue('Projects', activityMatch.entry.relatedProjectIds.join(', ')));
      }

      if (activityMatch.entry.relatedConversationIds && activityMatch.entry.relatedConversationIds.length > 0) {
        console.log(keyValue('Conversations', activityMatch.entry.relatedConversationIds.join(', ')));
      }

      console.log('');
      console.log(section('Summary'));
      console.log(activityMatch.entry.summary);

      if (activityMatch.entry.details) {
        console.log('');
        console.log(section('Details'));
        console.log(activityMatch.entry.details);
      }

      return 0;
    }

    const conversation = conversationMatch as InboxConversationStateEntry;
    const payload = {
      profile: state.profile,
      entry: {
        kind: 'conversation' as const,
        key: `conversation:${conversation.id}`,
        id: conversation.id,
        title: conversation.title,
        read: false,
        sessionFile: conversation.file,
        cwd: conversation.cwd,
        model: conversation.model,
        messageCount: conversation.messageCount,
        startedAt: conversation.timestamp,
        lastActivityAt: conversation.lastActivityAt,
        attentionUpdatedAt: conversation.attentionUpdatedAt,
        unreadMessageCount: conversation.attentionUnreadMessageCount,
        unreadActivityCount: conversation.attentionUnreadActivityCount,
        attentionActivityIds: conversation.attentionActivityIds,
        summary: buildConversationAttentionReason(conversation),
      },
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section(`Inbox conversation: ${conversation.id}`));
    console.log(keyValue('Profile', state.profile));
    console.log(keyValue('Title', conversation.title));
    console.log(keyValue('Session file', conversation.file));
    console.log(keyValue('Cwd', conversation.cwd));
    console.log(keyValue('Model', conversation.model));
    console.log(keyValue('Started', new Date(conversation.timestamp).toLocaleString()));
    console.log(keyValue('Last activity', new Date(conversation.lastActivityAt).toLocaleString()));
    console.log(keyValue('Attention updated', new Date(conversation.attentionUpdatedAt).toLocaleString()));
    console.log(keyValue('Unread messages', String(conversation.attentionUnreadMessageCount)));
    console.log(keyValue('Linked updates', String(conversation.attentionUnreadActivityCount)));

    if (conversation.attentionActivityIds.length > 0) {
      console.log(keyValue('Activity ids', conversation.attentionActivityIds.join(', ')));
    }

    console.log('');
    console.log(section('Summary'));
    console.log(buildConversationAttentionReason(conversation));

    return 0;
  }

  if (effectiveSubcommand === 'create') {
    const { jsonMode, id, kind, summary, details, relatedProjectIds, relatedConversationIds, notificationState, createdAt } = parseInboxCreateOptions(rest);
    const { repoRoot, profile, activityDir, readState } = loadInboxState();
    const desiredId = id ?? buildDefaultInboxActivityId(kind, summary, createdAt);
    const finalId = id ? desiredId : resolveUniqueInboxActivityId(repoRoot, profile, desiredId);

    if (id && existsSync(resolveActivityEntryPath({ repoRoot, profile, activityId: finalId }))) {
      throw new Error(`An inbox activity item already exists with id: ${finalId}`);
    }

    const entry = createProjectActivityEntry({
      id: finalId,
      createdAt,
      profile,
      kind,
      summary,
      details,
      relatedProjectIds,
      notificationState,
    });

    const path = writeProfileActivityEntry({
      repoRoot,
      profile,
      entry,
    });

    const activityConversationLink = setActivityConversationLinks({
      profile,
      activityId: finalId,
      relatedConversationIds: relatedConversationIds ?? [],
      updatedAt: createdAt,
    });

    if (readState.has(finalId)) {
      readState.delete(finalId);
      saveProfileActivityReadState({ repoRoot, profile, ids: readState });
    }

    const payload = {
      profile,
      activityDir,
      path,
      entry: {
        ...entry,
        ...(activityConversationLink ? { relatedConversationIds: activityConversationLink.relatedConversationIds } : {}),
        read: false,
      },
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section(`Created inbox activity: ${entry.id}`));
    console.log(keyValue('Profile', profile));
    console.log(keyValue('Path', path));
    console.log(keyValue('Kind', entry.kind));
    console.log(keyValue('Created', new Date(entry.createdAt).toLocaleString()));
    console.log(keyValue('Read', 'no'));

    console.log('');
    console.log(section('Summary'));
    console.log(entry.summary);

    if (entry.details) {
      console.log('');
      console.log(section('Details'));
      console.log(entry.details);
    }

    return 0;
  }

  if (effectiveSubcommand === 'read' || effectiveSubcommand === 'unread') {
    const { jsonMode, markAll, selectors } = parseInboxReadToggleOptions(rest, effectiveSubcommand);
    const read = effectiveSubcommand === 'read';
    const state = loadInboxState();
    const activityIds = new Set<string>();
    const conversationIds = new Set<string>();

    if (markAll) {
      for (const entry of state.surfaceEntries) {
        if (entry.kind === 'activity') {
          activityIds.add(entry.id);
        } else {
          conversationIds.add(entry.id);
        }
      }
    } else {
      for (const selector of selectors) {
        const activityMatch = resolveInboxActivityEntry(state, selector);
        const conversationSession = selector.kind === 'activity'
          ? null
          : state.sessions.find((entry) => entry.id === selector.id) ?? null;
        const conversationMatch = selector.kind === 'activity'
          ? null
          : state.conversationEntries.find((entry) => entry.id === selector.id) ?? null;

        if (!activityMatch && !conversationSession) {
          throw new Error(`No inbox item found for selector: ${selector.raw}`);
        }

        if (activityMatch && conversationSession) {
          throw new Error(`Ambiguous inbox selector: ${selector.raw}. Use activity:${selector.id} or conversation:${selector.id}.`);
        }

        if (activityMatch) {
          activityIds.add(activityMatch.entry.id);
        } else {
          const resolvedConversation = conversationMatch ?? conversationSession;
          if (resolvedConversation) {
            conversationIds.add(resolvedConversation.id);
          }
        }
      }
    }

    for (const id of activityIds) {
      if (read) {
        state.readState.add(id);
      } else {
        state.readState.delete(id);
      }
    }

    if (activityIds.size > 0) {
      saveProfileActivityReadState({ repoRoot: state.repoRoot, profile: state.profile, ids: state.readState });
    }

    for (const conversationId of conversationIds) {
      const session = state.conversationEntries.find((entry) => entry.id === conversationId)
        ?? state.sessions.find((entry) => entry.id === conversationId);
      if (!session) {
        throw new Error(`No inbox conversation found with id: ${conversationId}`);
      }

      if (read) {
        markConversationAttentionRead({
          profile: state.profile,
          conversationId,
          messageCount: session.messageCount,
        });
      } else {
        markConversationAttentionUnread({
          profile: state.profile,
          conversationId,
          messageCount: session.messageCount,
        });
      }
    }

    const payload = {
      ok: true,
      profile: state.profile,
      read,
      updated: {
        activities: [...activityIds].map((id) => `activity:${id}`),
        conversations: [...conversationIds].map((id) => `conversation:${id}`),
      },
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    const totalUpdated = activityIds.size + conversationIds.size;
    if (totalUpdated === 0) {
      console.log(dim(`No inbox items to mark as ${read ? 'read' : 'unread'}.`));
      return 0;
    }

    console.log(success(`Marked ${totalUpdated} inbox item${totalUpdated === 1 ? '' : 's'} as ${read ? 'read' : 'unread'}.`));
    return 0;
  }

  if (effectiveSubcommand === 'delete' || effectiveSubcommand === 'rm') {
    const { jsonMode, selectors } = parseInboxDeleteOptions(rest);
    const state = loadInboxState();
    const requested = selectors.map((selector) => {
      const match = resolveInboxActivityEntry(state, selector);
      if (!match) {
        if (selector.kind === 'conversation' || state.conversationEntries.some((entry) => entry.id === selector.id)) {
          throw new Error(`Inbox conversations cannot be deleted. Mark them read instead: ${selector.raw}`);
        }

        throw new Error(`No inbox activity found for selector: ${selector.raw}`);
      }

      return match;
    });

    const deleted = [...new Map(requested.map((entry) => [entry.entry.id, entry])).values()].map(({ path, entry }) => ({
      id: entry.id,
      path,
    }));

    for (const item of deleted) {
      rmSync(item.path, { force: true });
      clearActivityConversationLinks({ profile: state.profile, activityId: item.id });
      state.readState.delete(item.id);
    }

    saveProfileActivityReadState({ repoRoot: state.repoRoot, profile: state.profile, ids: state.readState });

    const payload = {
      ok: true,
      profile: state.profile,
      deleted,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(success(`Deleted ${deleted.length} inbox activity item${deleted.length === 1 ? '' : 's'}.`));
    for (const item of deleted) {
      console.log(keyValue(item.id, item.path, 2));
    }
    return 0;
  }

  throw new Error(`Unknown inbox subcommand: ${effectiveSubcommand}`);
}

function parseNumericOption(
  args: string[],
  optionName: string,
  fallback: number,
  usage: string,
): { value: number; rest: string[] } {
  const rest: string[] = [];
  let value = fallback;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg !== optionName) {
      rest.push(arg);
      continue;
    }

    const rawValue = args[index + 1];
    if (!rawValue) {
      throw new Error(`Usage: ${usage}`);
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`Usage: ${usage}`);
    }

    value = parsed;
    index += 1;
  }

  return { value, rest };
}

function parseBooleanOption(
  args: string[],
  optionName: string,
  _usage: string,
): { value: boolean; rest: string[]; explicit: boolean } {
  const rest: string[] = [];
  let value = false;
  let explicit = false;
  const negated = `--no-${optionName.slice(2)}`;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === optionName) {
      value = true;
      explicit = true;
      continue;
    }

    if (arg === negated) {
      value = false;
      explicit = true;
      continue;
    }

    rest.push(arg);
  }

  return { value, rest, explicit };
}

function parseStringOption(
  args: string[],
  optionName: string,
  usage: string,
): { value: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg !== optionName) {
      rest.push(arg);
      continue;
    }

    const rawValue = args[index + 1];
    if (!rawValue || rawValue.startsWith('--')) {
      throw new Error(`Usage: ${usage}`);
    }

    value = rawValue;
    index += 1;
  }

  return { value, rest };
}

function openWebUiInBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'linux'
      ? 'xdg-open'
      : undefined;

  if (!command) {
    return;
  }

  spawnSync(command, [url], { stdio: 'ignore' });
}

async function isLocalPortListening(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const socket = createConnection({ host: '127.0.0.1', port });

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolvePromise(result);
    };

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

interface WebUiCandidateHandle {
  child: ReturnType<typeof spawn>;
  release: WebUiReleaseSummary;
  port: number;
  logFile: string;
}

function resolveWebUiCandidateLogFile(slot: WebUiReleaseSummary['slot']): string {
  return join(resolveStatePaths().root, 'web', 'logs', `candidate-${slot}.log`);
}

function resolveWebUiCandidatePort(stablePort: number, slot: WebUiReleaseSummary['slot'], companionPort: number): number {
  let candidate = getWebUiSlotHealthPort(stablePort, slot);
  if (candidate !== stablePort && candidate !== companionPort) {
    return candidate;
  }

  const step = 2;
  const maxPort = 65535;
  while (candidate <= maxPort && (candidate === stablePort || candidate === companionPort)) {
    candidate += step;
  }

  if (candidate <= maxPort) {
    return candidate;
  }

  candidate = getWebUiSlotHealthPort(stablePort, slot);
  while (candidate > 0 && (candidate === stablePort || candidate === companionPort)) {
    candidate -= step;
  }

  if (candidate > 0) {
    return candidate;
  }

  throw new Error(`Could not find an available candidate port for web UI slot ${slot}.`);
}

function startWebUiCandidateProcess(release: WebUiReleaseSummary, port: number): WebUiCandidateHandle {
  const logFile = resolveWebUiCandidateLogFile(release.slot);
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, '');

  const child = spawn(process.execPath, [release.serverEntryFile], {
    cwd: release.sourceRepoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PA_WEB_PORT: String(port),
      PA_WEB_DISABLE_COMPANION: '1',
      PA_WEB_DIST: release.distDir,
      PERSONAL_AGENT_REPO_ROOT: release.sourceRepoRoot,
      PERSONAL_AGENT_WEB_SLOT: release.slot,
      ...(release.revision ? { PERSONAL_AGENT_WEB_REVISION: release.revision } : {}),
    },
  });

  child.stdout?.on('data', (chunk) => {
    writeFileSync(logFile, String(chunk), { flag: 'a' });
  });
  child.stderr?.on('data', (chunk) => {
    writeFileSync(logFile, String(chunk), { flag: 'a' });
  });

  return {
    child,
    release,
    port,
    logFile,
  };
}

async function stopWebUiCandidateProcess(handle: WebUiCandidateHandle): Promise<void> {
  if (handle.child.exitCode !== null) {
    return;
  }

  handle.child.kill('SIGTERM');

  await Promise.race([
    new Promise<void>((resolvePromise) => {
      handle.child.once('exit', () => resolvePromise());
      handle.child.once('close', () => resolvePromise());
    }),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);

  if (handle.child.exitCode === null) {
    handle.child.kill('SIGKILL');
  }
}

async function validateWebUiReleaseCandidate(
  release: WebUiReleaseSummary,
  stablePort: number,
  companionPort: number,
): Promise<{ port: number; logFile: string }> {
  const port = resolveWebUiCandidatePort(stablePort, release.slot, companionPort);
  const handle = startWebUiCandidateProcess(release, port);

  try {
    await Promise.race([
      waitForWebUiHealthy(port, 30_000, {
        slot: release.slot,
        revision: release.revision,
      }),
      new Promise<never>((_, reject) => {
        handle.child.once('exit', (code, signal) => {
          reject(new Error(`Candidate web UI exited before becoming healthy (code=${code ?? 'null'} signal=${signal ?? 'none'})`));
        });
      }),
    ]);

    return {
      port,
      logFile: handle.logFile,
    };
  } catch (error) {
    const tail = existsSync(handle.logFile) ? readTailLines(handle.logFile, 40) : '';
    const suffix = tail.trim().length > 0 ? `\n\nCandidate log tail (${handle.logFile}):\n${tail}` : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
  } finally {
    await stopWebUiCandidateProcess(handle);
  }
}

async function deployManagedWebUiBlueGreen(repoRoot: string, port: number, companionPort: number): Promise<string> {
  const deployment = getWebUiDeploymentSummary({ stablePort: port });
  const nextSlot = getInactiveWebUiSlot(deployment.activeSlot);
  const release = stageWebUiRelease({ repoRoot, slot: nextSlot, stablePort: port });

  await validateWebUiReleaseCandidate(release, port, companionPort);
  activateWebUiSlot({ slot: nextSlot, stablePort: port });
  installWebUiService({ repoRoot, port });
  await waitForWebUiHealthy(port, 30_000, {
    slot: release.slot,
    revision: release.revision,
  });

  const nextDeployment = getWebUiDeploymentSummary({ stablePort: port });
  return `swapped ${deployment.activeSlot ?? 'none'} → ${nextSlot}${nextDeployment.activeRelease?.revision ? ` (${nextDeployment.activeRelease.revision})` : ''}`;
}

function printWebUiHelp(): void {
  console.log(section('Web UI'));
  console.log('');
  console.log('Commands:');
  console.log('  pa ui help                                    Show web UI help');
  console.log('  pa ui [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Start the web UI in the foreground');
  console.log('  pa ui logs [--tail <count>]                   Show recent managed web UI logs');
  console.log('  pa ui pairing-code [--port <port>]            Create a pairing code for remote desktop or companion access');
  console.log('  pa ui service help                            Show web UI service help');
  console.log('  pa ui service install [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Install and start managed web UI service');
  console.log('  pa ui service status [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Show managed web UI service status');
  console.log('  pa ui service start [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Start managed web UI service');
  console.log('  pa ui service stop [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Stop managed web UI service');
  console.log('  pa ui service restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Restart managed web UI service');
  console.log('  pa ui service rollback [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Roll back to the inactive staged web UI slot');
  console.log('  pa ui service mark-bad [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Mark the active staged web UI release as bad');
  console.log('  pa ui service uninstall [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Stop and remove managed web UI service');
  console.log('');
  console.log(`  ${formatNextStep('pa ui service install')}`);
}

function printWebUiServiceHelp(): void {
  console.log(section('Web UI service'));
  console.log('');
  console.log('Commands:');
  console.log('  pa ui service help                            Show web UI service help');
  console.log('  pa ui service install [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Install and start managed web UI service');
  console.log('  pa ui service status [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Show managed web UI service status');
  console.log('  pa ui service start [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Start managed web UI service');
  console.log('  pa ui service stop [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Stop managed web UI service');
  console.log('  pa ui service restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Restart managed web UI service');
  console.log('  pa ui service rollback [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Roll back to the inactive staged web UI slot');
  console.log('  pa ui service mark-bad [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Mark the active staged web UI release as bad');
  console.log('  pa ui service uninstall [--port <port>] [--tailscale-serve|--no-tailscale-serve]'
    + ' Stop and remove managed web UI service');
  console.log('');
  console.log('Updates use blue/green staging automatically when the managed web UI service is installed.');
  console.log('');
  console.log(keyValue('Supported platforms', 'macOS launchd, Linux systemd --user'));
  console.log(keyValue('Config file', getWebUiConfigFilePath()));
  console.log(keyValue('Default port', String(readWebUiConfig().port)));
  console.log(keyValue('Log file', resolveWebUiLogFile()));
  console.log('');
  console.log(`  ${formatNextStep('pa ui service install')}`);
}

function printWebUiServiceStatus(status: WebUiServiceStatus): void {
  console.log(section('Web UI service'));
  console.log('');
  console.log(keyValue('Service', status.identifier));
  console.log(keyValue('Manifest', status.manifestPath));
  console.log(keyValue('Installed', status.installed ? 'yes' : 'no'));
  console.log(keyValue('Running', status.running ? 'yes' : 'no'));
  console.log(keyValue('Repo', status.repoRoot));
  console.log(keyValue('Port', String(status.port)));
  console.log(keyValue('URL', status.url));

  if (status.deployment?.activeSlot) {
    console.log(keyValue('Active slot', status.deployment.activeSlot));
  }
  console.log(keyValue('Tailscale Serve', readWebUiConfig().useTailscaleServe ? 'enabled' : 'disabled'));
  if (status.deployment?.activeRelease?.revision) {
    console.log(keyValue('Active release', status.deployment.activeRelease.revision));
  }
  if (status.deployment?.inactiveRelease?.revision || status.deployment?.inactiveRelease?.slot) {
    console.log(keyValue('Inactive slot', [
      status.deployment.inactiveRelease?.slot,
      status.deployment.inactiveRelease?.revision,
    ].filter(Boolean).join(' · ')));
  }

  const activeBadRelease = findBadWebUiRelease({
    release: status.deployment?.activeRelease,
    stablePort: status.port,
  });
  if (activeBadRelease) {
    console.log(keyValue('Active release bad', [
      activeBadRelease.revision,
      activeBadRelease.reason,
    ].filter(Boolean).join(' · ')));
  }

  const badReleaseCount = listBadWebUiReleases({ stablePort: status.port }).length;
  if (badReleaseCount > 0) {
    console.log(keyValue('Bad releases', String(badReleaseCount)));
  }

  if (status.logFile) {
    console.log(keyValue('Log file', status.logFile));
  }

  if (!status.installed) {
    console.log('');
    console.log(`  ${formatNextStep('pa ui service install')}`);
  }
}

function showWebUiLogs(args: string[]): void {
  const parsed = parseNumericOption(args, '--tail', 80, 'pa ui logs [--tail <count>]');
  ensureNoExtraCommandArgs(parsed.rest, 'pa ui logs [--tail <count>]');

  const logFile = resolveWebUiLogFile();

  console.log('');
  console.log(section('Web UI logs'));
  console.log(keyValue('Log file', logFile));

  if (!existsSync(logFile)) {
    console.log(dim('No web UI log file found yet. Install and run the managed service with `pa ui service install` or start the UI and inspect stdout directly.'));
    return;
  }

  const tail = readTailLines(logFile, parsed.value);
  if (tail.trim().length === 0) {
    console.log(dim('Log file is empty.'));
    return;
  }

  console.log('');
  console.log(tail);
}

async function createWebUiPairingCode(port: number): Promise<{ id: string; code: string; createdAt: string; expiresAt: string }> {
  const url = `http://127.0.0.1:${port}/api/companion-auth/pairing-code`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Origin: `http://127.0.0.1:${port}`,
      },
    });
  } catch (error) {
    throw new Error(`Could not reach the web UI on ${url}. Start it first with \`pa ui\` or \`pa ui service start\`.`);
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const parsed = await response.json() as { error?: string };
      if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        detail = parsed.error;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }

    throw new Error(`Could not create a pairing code: ${detail}`);
  }

  return response.json() as Promise<{ id: string; code: string; createdAt: string; expiresAt: string }>;
}

async function showWebUiPairingCode(args: string[]): Promise<void> {
  const parsed = parseNumericOption(args, '--port', readWebUiConfig().port, 'pa ui pairing-code [--port <port>]');
  ensureNoExtraCommandArgs(parsed.rest, 'pa ui pairing-code [--port <port>]');

  const config = readWebUiConfig();
  const created = await createWebUiPairingCode(parsed.value);
  const tailscaleUrl = config.useTailscaleServe ? resolveWebUiTailscaleUrl() : undefined;

  console.log(section('Web UI pairing code'));
  console.log(keyValue('Code', created.code));
  console.log(keyValue('Expires', new Date(created.expiresAt).toLocaleString()));
  console.log(keyValue('Port', String(parsed.value)));
  if (tailscaleUrl) {
    console.log(keyValue('Desktop URL', tailscaleUrl));
    console.log(keyValue('Companion URL', `${tailscaleUrl.replace(/\/+$/, '')}/app`));
  }
  console.log(dim('Use this one-time code to pair a remote desktop browser or the companion app. Once paired, the browser stays signed in until you revoke it.'));
}

function syncWebUiTailscaleServeFromCli(input: {
  enabled: boolean;
  port: number;
  companionPort: number;
  strict: boolean;
  context: string;
}): void {
  try {
    syncWebUiTailscaleServe({
      enabled: input.enabled,
      port: input.port,
      companionPort: input.companionPort,
    });
    console.log(keyValue('Tailscale Serve', `${input.enabled ? 'enabled' : 'disabled'} · / → localhost:${input.port}, /app → localhost:${input.companionPort}`));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (input.strict) {
      throw new Error(`${input.context}: ${detail}`);
    }

    console.log(`  ${warning(`${input.context}: ${detail}`)}`);
  }
}

async function runWebUiServiceAction(action: string, args: string[]): Promise<void> {
  const usage = action === 'rollback'
    ? 'pa ui service rollback [--port <port>] [--tailscale-serve|--no-tailscale-serve] [--reason <text>]'
    : action === 'mark-bad'
      ? 'pa ui service mark-bad [--port <port>] [--tailscale-serve|--no-tailscale-serve] [--slot <blue|green>] [--reason <text>]'
      : `pa ui service ${action} [--port <port>] [--tailscale-serve|--no-tailscale-serve]`;

  const parsedTailscaleServe = parseBooleanOption(args, '--tailscale-serve', usage);
  const parsedPort = parseNumericOption(parsedTailscaleServe.rest, '--port', readWebUiConfig().port, usage);

  let rest = parsedPort.rest;
  let reason: string | undefined;
  let slot: 'blue' | 'green' | undefined;

  if (action === 'rollback' || action === 'mark-bad') {
    const parsedReason = parseStringOption(rest, '--reason', usage);
    reason = parsedReason.value;
    rest = parsedReason.rest;
  }

  if (action === 'mark-bad') {
    const parsedSlot = parseStringOption(rest, '--slot', usage);
    if (parsedSlot.value) {
      if (parsedSlot.value !== 'blue' && parsedSlot.value !== 'green') {
        throw new Error(`Usage: ${usage}`);
      }
      slot = parsedSlot.value;
    }
    rest = parsedSlot.rest;
  }

  ensureNoExtraCommandArgs(rest, usage);

  const currentConfig = readWebUiConfig();
  const options = getWebUiServiceOptions({ port: parsedPort.value });
  const desiredUseTailscaleServe = parsedTailscaleServe.explicit
    ? parsedTailscaleServe.value
    : currentConfig.useTailscaleServe;
  const desiredConfig = finalizeWebUiConfig({
    ...currentConfig,
    port: options.port,
    useTailscaleServe: desiredUseTailscaleServe,
  });
  const autoEnableTailscaleAfterServiceStart = !parsedTailscaleServe.explicit
    && desiredUseTailscaleServe
    && ['install', 'start', 'restart'].includes(action);

  if (parsedTailscaleServe.explicit) {
    syncWebUiTailscaleServeFromCli({
      enabled: parsedTailscaleServe.value,
      port: desiredConfig.port,
      companionPort: desiredConfig.companionPort,
      strict: true,
      context: `Unable to ${parsedTailscaleServe.value ? 'enable' : 'disable'} Tailscale Serve`,
    });
    writeWebUiConfig(desiredConfig);
  }

  if (action === 'install') {
    writeWebUiConfig(desiredConfig);
    const service = installWebUiService(options);
    await waitForWebUiHealthy(service.port);

    if (autoEnableTailscaleAfterServiceStart) {
      syncWebUiTailscaleServeFromCli({
        enabled: true,
        port: desiredConfig.port,
        companionPort: desiredConfig.companionPort,
        strict: false,
        context: 'Could not re-apply configured Tailscale Serve setting',
      });
    }

    console.log(success('Installed managed web UI service'));
    console.log(keyValue('Service', service.identifier));
    console.log(keyValue('Manifest', service.manifestPath));
    console.log(keyValue('URL', service.url));
    if (service.logFile) {
      console.log(keyValue('Log file', service.logFile));
    }
    console.log(`  ${formatNextStep('pa ui service status')}`);
    return;
  }

  if (action === 'status') {
    printWebUiServiceStatus(getWebUiServiceStatus(options));
    return;
  }

  if (action === 'start') {
    const service = startWebUiService(options);
    await waitForWebUiHealthy(service.port);

    if (autoEnableTailscaleAfterServiceStart) {
      syncWebUiTailscaleServeFromCli({
        enabled: true,
        port: desiredConfig.port,
        companionPort: desiredConfig.companionPort,
        strict: false,
        context: 'Could not re-apply configured Tailscale Serve setting',
      });
    }

    console.log(success(`Started managed web UI service on ${service.url}`));
    return;
  }

  if (action === 'stop') {
    const service = stopWebUiService(options);
    console.log(success(`Stopped managed web UI service (${service.identifier})`));
    return;
  }

  if (action === 'restart') {
    try {
      const service = restartWebUiService(options);
      await waitForWebUiHealthy(service.port);

      if (autoEnableTailscaleAfterServiceStart) {
        syncWebUiTailscaleServeFromCli({
          enabled: true,
          port: desiredConfig.port,
          companionPort: desiredConfig.companionPort,
          strict: false,
          context: 'Could not re-apply configured Tailscale Serve setting',
        });
      }

      console.log(success(`Restarted managed web UI service on ${service.url}`));
      return;
    } finally {
      clearOwnedApplicationCommandLock('web-ui-service-restart');
    }
  }

  if (action === 'rollback') {
    const status = getWebUiServiceStatus(options);
    if (!status.installed) {
      throw new Error('Managed web UI service is not installed. Run `pa ui service install` first.');
    }

    const result = rollbackWebUiDeployment({
      stablePort: options.port,
      reason,
    });
    const service = installWebUiService(options);
    await waitForWebUiHealthy(service.port, 30_000, {
      slot: result.restoredRelease.slot,
      revision: result.restoredRelease.revision,
    });

    if (!parsedTailscaleServe.explicit && desiredUseTailscaleServe) {
      syncWebUiTailscaleServeFromCli({
        enabled: true,
        port: desiredConfig.port,
        companionPort: desiredConfig.companionPort,
        strict: false,
        context: 'Could not re-apply configured Tailscale Serve setting',
      });
    }

    console.log(success(`Rolled back managed web UI to ${result.restoredRelease.slot}${result.restoredRelease.revision ? ` (${result.restoredRelease.revision})` : ''}`));
    console.log(keyValue('Rolled back from', `${result.rolledBackFrom.slot}${result.rolledBackFrom.revision ? ` · ${result.rolledBackFrom.revision}` : ''}`));
    console.log(keyValue('Restored release', `${result.restoredRelease.slot}${result.restoredRelease.revision ? ` · ${result.restoredRelease.revision}` : ''}`));
    if (result.markedBad) {
      console.log(keyValue('Marked bad', `${result.markedBad.revision}${result.markedBad.reason ? ` · ${result.markedBad.reason}` : ''}`));
    }

    try {
      writeWebUiRollbackInboxEntry({
        profile: resolveActivityProfileName(),
        repoRoot: status.repoRoot,
        rolledBackFromSlot: result.rolledBackFrom.slot,
        rolledBackFromRevision: result.rolledBackFrom.revision,
        restoredSlot: result.restoredRelease.slot,
        restoredRevision: result.restoredRelease.revision,
        reason,
        markedBadRevision: result.markedBad?.revision,
        markedBadReason: result.markedBad?.reason,
      });
    } catch (error) {
      console.log(`  ${warning(`Unable to write web UI rollback inbox entry: ${(error as Error).message}`)}`);
    }
    return;
  }

  if (action === 'mark-bad') {
    const status = getWebUiServiceStatus(options);
    const marked = markWebUiReleaseBad({
      slot,
      stablePort: options.port,
      reason,
    });

    console.log(success(`Marked web UI release ${marked.revision} as bad`));
    if (marked.slot) {
      console.log(keyValue('Slot', marked.slot));
    }
    console.log(keyValue('Revision', marked.revision));
    if (marked.reason) {
      console.log(keyValue('Reason', marked.reason));
    }

    try {
      writeWebUiMarkedBadInboxEntry({
        profile: resolveActivityProfileName(),
        repoRoot: status.repoRoot,
        slot: marked.slot,
        revision: marked.revision,
        reason: marked.reason,
      });
    } catch (error) {
      console.log(`  ${warning(`Unable to write web UI mark-bad inbox entry: ${(error as Error).message}`)}`);
    }
    return;
  }

  const removed = uninstallWebUiService(options);
  console.log(success('Removed managed web UI service'));
  console.log(keyValue('Service', removed.identifier));
  console.log(keyValue('Manifest', removed.manifestPath));
  if (removed.logFile) {
    console.log(keyValue('Log file', removed.logFile));
  }
  console.log(`  ${formatNextStep('pa ui service install')}`);
}

async function startForegroundWebUi(args: string[]): Promise<number> {
  const parsedTailscaleServe = parseBooleanOption(args, '--tailscale-serve', 'pa ui [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]');
  const currentConfig = readWebUiConfig();
  const portParse = parseNumericOption(
    parsedTailscaleServe.rest,
    '--port',
    currentConfig.port,
    'pa ui [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]',
  );
  const openBrowser = hasOption(portParse.rest, '--open');
  const remainingArgs = portParse.rest.filter((arg) => arg !== '--open');
  ensureNoExtraCommandArgs(
    remainingArgs,
    'pa ui [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]',
  );

  const desiredUseTailscaleServe = parsedTailscaleServe.explicit
    ? parsedTailscaleServe.value
    : currentConfig.useTailscaleServe;
  const desiredConfig = finalizeWebUiConfig({
    ...currentConfig,
    port: portParse.value,
    useTailscaleServe: desiredUseTailscaleServe,
  });

  if (parsedTailscaleServe.explicit) {
    syncWebUiTailscaleServeFromCli({
      enabled: parsedTailscaleServe.value,
      port: desiredConfig.port,
      companionPort: desiredConfig.companionPort,
      strict: true,
      context: `Unable to ${parsedTailscaleServe.value ? 'enable' : 'disable'} Tailscale Serve`,
    });

    writeWebUiConfig(desiredConfig);
  } else if (desiredUseTailscaleServe) {
    syncWebUiTailscaleServeFromCli({
      enabled: true,
      port: desiredConfig.port,
      companionPort: desiredConfig.companionPort,
      strict: false,
      context: 'Could not re-apply configured Tailscale Serve setting',
    });
  }

  const repoRoot = getRepoRoot();
  const serverPath = join(repoRoot, 'packages', 'web', 'dist-server', 'index.js');
  const distPath = join(repoRoot, 'packages', 'web', 'dist');

  if (!existsSync(serverPath)) {
    console.error(uiError('Web UI server not built.'));
    console.error(formatHint(`Run: cd ${join(repoRoot, 'packages', 'web')} && npm run build`));
    return 1;
  }

  const url = `http://localhost:${portParse.value}`;

  try {
    const managedStatus = getWebUiServiceStatus({ repoRoot, port: portParse.value });
    if (managedStatus.installed && managedStatus.running && await isLocalPortListening(portParse.value)) {
      if (openBrowser) {
        setTimeout(() => {
          openWebUiInBrowser(url);
        }, 1200);
      }

      console.log(warning(`Managed web UI service is already running on ${managedStatus.url}; skipping foreground launch.`));
      console.log(`  ${formatNextStep('pa ui service status')}`);
      return 0;
    }
  } catch (error) {
    if (!isMissingServiceManagerError(error)) {
      console.log(`  ${warning(`Could not inspect managed web UI service: ${(error as Error).message}`)}`);
    }
  }

  if (openBrowser) {
    setTimeout(() => {
      openWebUiInBrowser(url);
    }, 1200);
  }

  console.log(success(`Starting web UI on ${url}`));

  const result = spawnSync(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PA_WEB_PORT: String(portParse.value),
      PA_WEB_COMPANION_PORT: String(desiredConfig.companionPort),
      PA_WEB_DIST: distPath,
      PERSONAL_AGENT_REPO_ROOT: repoRoot,
      PERSONAL_AGENT_WEB_TAILSCALE_SERVE: String(desiredUseTailscaleServe),
    },
  });

  return result.status ?? 0;
}

async function uiCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    return startForegroundWebUi(args);
  }

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(rest, 'pa ui help');
    printWebUiHelp();
    return 0;
  }

  if (subcommand === 'logs') {
    showWebUiLogs(rest);
    return 0;
  }

  if (subcommand === 'pairing-code') {
    await showWebUiPairingCode(rest);
    return 0;
  }

  if (subcommand === 'service') {
    const [action, ...serviceArgs] = rest;

    if (!action || isCliHelpToken(action)) {
      ensureNoExtraCommandArgs(serviceArgs, 'pa ui service help');
      printWebUiServiceHelp();
      return 0;
    }

    if (!['install', 'status', 'start', 'stop', 'restart', 'rollback', 'mark-bad', 'uninstall'].includes(action)) {
      throw new Error(`Unknown ui service subcommand: ${action}`);
    }

    await runWebUiServiceAction(action, serviceArgs);
    return 0;
  }

  return startForegroundWebUi(args);
}

type CommandHandler = (args: string[]) => Promise<number>;

interface CliCommandDefinition {
  name: string;
  description: string;
  usage?: string;
  helpText?: string;
  disableBuiltInHelp?: boolean;
  run: CommandHandler;
}

function buildCommandDefinitions(): CliCommandDefinition[] {
  const definitions: CliCommandDefinition[] = [
    {
      name: 'tui',
      usage: 'tui [args...]',
      description: 'Run pi with profile resources',
      run: runCommand,
    },
    {
      name: 'install',
      usage: 'install [args...]',
      description: 'Add a Pi package source to durable pa settings',
      helpText: `\nUsage: ${INSTALL_COMMAND_USAGE}\n\n${INSTALL_COMMAND_HELP_TEXT}\n`,
      disableBuiltInHelp: true,
      run: installCommand,
    },
    {
      name: 'profile',
      usage: 'profile [list|show|use|help] [args...]',
      description: 'Manage profile settings',
      disableBuiltInHelp: true,
      run: profileCommand,
    },
    {
      name: 'doctor',
      usage: 'doctor [args...]',
      description: 'Validate local setup',
      run: async (args) => {
        if (hasOption(args, '--profile')) {
          throw new Error('doctor no longer accepts --profile. Set it once with: pa profile use <name>');
        }

        return doctor({ json: hasOption(args, '--json') });
      },
    },
    {
      name: 'restart',
      usage: 'restart [--rebuild]',
      description: 'Restart the daemon and managed web UI (use --rebuild to rebuild packages and blue/green redeploy the web UI)',
      run: restartCommand,
    },
    {
      name: 'update',
      usage: 'update [--repo-only]',
      description: 'Pull latest git changes, refresh repo dependencies, sync pi to latest, rebuild packages, then restart background services',
      run: updateCommand,
    },
    {
      name: 'daemon',
      usage: 'daemon [status|start|stop|restart|logs|service|help] [args...]',
      description: 'Manage personal-agent daemon',
      helpText: DAEMON_HELP_TEXT,
      disableBuiltInHelp: true,
      run: daemonCommand,
    },
    {
      name: 'tasks',
      usage: 'tasks [list|show|validate|logs|help] [args...]',
      description: 'Inspect and validate scheduled daemon tasks',
      disableBuiltInHelp: true,
      run: tasksCommand,
    },
    {
      name: 'inbox',
      usage: 'inbox [list|show|create|read|unread|delete|help] [args...]',
      description: 'Inspect and manage activity/inbox items for the active profile',
      disableBuiltInHelp: true,
      run: inboxCommand,
    },
    {
      name: 'ui',
      usage: 'ui [logs|service|help] [args...]',
      description: 'Start and manage the personal agent web UI',
      disableBuiltInHelp: true,
      run: uiCommand,
    },
    {
      name: 'memory',
      usage: 'memory [list|find|show|new|lint|help] [args...]',
      description: 'Inspect shared note nodes',
      disableBuiltInHelp: true,
      run: memoryCommand,
    },
    {
      name: 'mcp',
      usage: 'mcp [list|info|grep|call|auth|logout|help] [args...]',
      description: 'Inspect and call configured MCP servers natively',
      disableBuiltInHelp: true,
      run: mcpCommand,
    },
    {
      name: 'runs',
      usage: 'runs [list|show|logs|start|cancel|help] [args...]',
      description: 'Inspect and manage durable background runs',
      disableBuiltInHelp: true,
      run: runsCommand,
    },
    {
      name: 'targets',
      usage: 'targets [list|show|add|update|install|delete|help] [args...]',
      description: 'Inspect and manage execution targets',
      disableBuiltInHelp: true,
      run: targetsCommand,
    },
    {
      name: 'sync',
      usage: 'sync [status|run|setup|help] [args...]',
      description: 'Configure and run automatic git state sync',
      disableBuiltInHelp: true,
      run: syncCommand,
    },

  ];

  return definitions;
}

function toPositionalArg(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function normalizeActionArgs(values: unknown[]): string[] {
  if (values.length === 0) {
    return [];
  }

  const positionalValues = values.slice(0, -1);
  const normalized: string[] = [];

  for (const value of positionalValues) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const arg = toPositionalArg(item);
        if (arg !== undefined) {
          normalized.push(arg);
        }
      }
      continue;
    }

    const arg = toPositionalArg(value);
    if (arg !== undefined) {
      normalized.push(arg);
    }
  }

  return normalized;
}

function createProgram(definitions: CliCommandDefinition[], setExitCode: (code: number) => void): Command {
  const program = new Command();

  program
    .name('pa')
    .description('Personal Agent CLI')
    .showHelpAfterError()
    .addHelpText(
      'after',
      `
Global options:
  --plain, --no-color   Disable rich ANSI styling

Examples:
  pa
  pa --plain tui -p "hello"
  pa tui --profile datadog -p "hello"
  pa tui -- --model kimi-coding/k2p5
  pa install https://github.com/davebcn87/pi-autoresearch
  pa install --local ./my-package
  pa profile use datadog
  pa profile list
  pa doctor
  pa doctor --json
  pa restart
  pa update
  pa update --repo-only
  pa daemon
  pa daemon status
  pa daemon service install
  pa tasks list
  pa tasks list --json --status completed
  pa tasks validate --all
  pa tasks logs <id> --tail 120
  pa memory list
  pa memory find --tag runpod --type project
  pa memory show runpod
  pa memory new quick-note --title "Quick Note" --summary "What this doc tracks." --tags notes
  pa memory lint
  pa mcp list
  pa mcp list --probe
  pa mcp info atlassian
  pa runs list
  pa runs show <id>
  pa runs start code-review -- npm test
  pa runs start-agent code-review --prompt "review this diff"
  pa runs cancel <id>
  pa targets list
  pa targets add gpu-box --label "GPU Box" --ssh gpu-box --default-cwd /srv/personal-agent --map /Users/patrickc.lee/personal/personal-agent=/srv/personal-agent
  pa targets install gpu-box
  pa sync status
  pa sync setup --repo git@github.com:you/personal-agent-state.git --fresh
  pa sync run

`,
    )
    .configureOutput({
      outputError: (message, write) => {
        write(`${uiError('CLI error', message.trim())}\n`);
      },
    })
    .exitOverride();

  for (const definition of definitions) {
    const command = program
      .command(definition.usage ?? `${definition.name} [args...]`)
      .description(definition.description)
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .action(async (...actionArgs: unknown[]) => {
        const args = normalizeActionArgs(actionArgs);
        setExitCode(await definition.run(args));
      });

    if (definition.disableBuiltInHelp) {
      command.helpOption(false);
    }

    if (definition.helpText) {
      command.addHelpText('after', definition.helpText);
    }
  }

  return program;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsedFlags = parseGlobalFlags(argv);
  configureUi({ plain: parsedFlags.plain });

  try {
    const definitions = buildCommandDefinitions();
    const knownCommands = new Set(definitions.map((definition) => definition.name));

    let exitCode = 0;
    const program = createProgram(definitions, (code) => {
      exitCode = code;
    });

    if (parsedFlags.argv.length === 0) {
      await program.parseAsync(['--help'], { from: 'user' });
      return 0;
    }

    const firstArg = parsedFlags.argv[0];
    const isHelpRequest = firstArg === '--help' || firstArg === '-h' || firstArg === 'help';

    if (!isHelpRequest && !knownCommands.has(firstArg)) {
      console.error(uiError('CLI error', `Unknown top-level command or option: ${firstArg}. Use 'pa tui ...' to pass arguments to Pi.`));
      return 1;
    }

    await program.parseAsync(parsedFlags.argv, { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.help') {
        return 0;
      }

      console.error(uiError('CLI error', error.message));
      return error.exitCode ?? 1;
    }

    const message = (error as Error).message;
    console.error(uiError('CLI error', message));

    return 1;
  }
}

function resolveExecutablePath(path: string): string {
  const resolvedPath = resolve(path);

  if (!existsSync(resolvedPath)) {
    return resolvedPath;
  }

  try {
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

const entryFile = process.argv[1] ? resolveExecutablePath(process.argv[1]) : undefined;
const moduleFile = resolveExecutablePath(fileURLToPath(import.meta.url));

if (entryFile === moduleFile) {
  runCli().then((code) => {
    process.exit(code);
  });
}

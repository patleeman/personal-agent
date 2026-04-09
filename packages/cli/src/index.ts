#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { createConnection, createServer } from 'net';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { Command, CommanderError } from 'commander';
import {
  bootstrapStateOrThrow,
  clearActivityConversationLinks,
  createProjectActivityEntry,
  deleteProfileActivityEntries,
  ensureConversationAttentionBaselines,
  finalizeMachineWebUiConfigState,
  getActivityConversationLink,
  getDurableProfilesDir,
  hasProfileActivityEntry,
  listProfileActivityEntries,
  listStoredSessions,
  loadProfileActivityReadState,
  markConversationAttentionRead,
  markConversationAttentionUnread,
  preparePiAgentDir,
  readMachineWebUiConfig,
  resolveProfileActivityDbPath,
  resolveStatePaths,
  saveProfileActivityReadState,
  setActivityConversationLinks,
  summarizeConversationAttention,
  validateActivityId,
  validateStatePathsOutsideRepo,
  writeMachineWebUiConfig,
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
  ensureLegacyTaskImports,
  getAutomationDbPath,
  getDaemonStatus,
  listStoredAutomations,
  loadAutomationRuntimeStateMap,
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
  type StoredAutomation,
} from '@personal-agent/daemon';
import {
  getManagedDaemonServiceStatus,
  getWebUiServiceStatus,
  installManagedDaemonService,
  installWebUiService,
  restartManagedDaemonServiceIfInstalled,
  resolveWebUiTailscaleUrl,
  restartWebUiService,
  restartWebUiServiceIfInstalled,
  startWebUiService,
  stopWebUiService,
  syncWebUiTailscaleServe,
  uninstallManagedDaemonService,
  uninstallWebUiService,
  type WebUiServiceOptions,
  type WebUiServiceStatus,
} from '@personal-agent/services';
import { hasOption } from './args.js';
import { readTailLines } from './file-utils.js';
import { mcpCommand } from './mcp-command.js';
import { readConfig, setDefaultProfile } from './config.js';
import {
  writeRestartCompletionInboxEntry,
  writeRestartFailureInboxEntry,
  writeUpdateCompletionInboxEntry,
  writeUpdateFailureInboxEntry,
} from './restartNotifications.js';
import { runsCommand } from './runs-command.js';
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
  printDenseCommandList,
  printDenseLines,
  printDenseParagraph,
  printDenseUsage,
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

function readWebUiConfig() {
  return readMachineWebUiConfig();
}

function writeWebUiConfig(config: Parameters<typeof writeMachineWebUiConfig>[0]): void {
  writeMachineWebUiConfig(config);
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

async function applyDefaultModelArgs(
  args: string[],
  settings: Record<string, unknown>,
  _agentDir: string,
): Promise<string[]> {
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
  const withDefaults = await applyDefaultModelArgs(piArgs, settings, runtime.agentDir);

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

interface CliHomeSnapshot {
  profile: string;
  daemonSummary: string;
  webUiSummary: string;
  tailscaleSummary: string;
}

async function collectCliHomeSnapshot(): Promise<CliHomeSnapshot> {
  const profile = resolveProfileName();

  const daemonConfig = loadDaemonConfig();
  const daemonPaths = resolveDaemonPaths(daemonConfig.ipc.socketPath);
  let daemonSummary = `${statusChip('stopped')} ${dim(daemonPaths.socketPath)}`;

  try {
    const daemonRunning = await pingDaemon(daemonConfig);
    if (daemonRunning) {
      try {
        const daemonStatus = await getDaemonStatus(daemonConfig);
        daemonSummary = `${statusChip('running')} pid ${daemonStatus.pid}`;
      } catch (error) {
        daemonSummary = `${statusChip('error')} ${(error as Error).message}`;
      }
    }
  } catch (error) {
    daemonSummary = `${statusChip('error')} ${(error as Error).message}`;
  }

  const webUiConfig = readWebUiConfig();
  const webUiOptions = getWebUiServiceOptions({ port: webUiConfig.port });
  const webUiUrl = `http://localhost:${webUiOptions.port}`;
  let webUiSummary = `${statusChip('stopped')} ${webUiUrl}`;

  try {
    const serviceStatus = getWebUiServiceStatus(webUiOptions);
    const listening = await isLocalPortListening(webUiOptions.port);

    if (serviceStatus.installed && serviceStatus.running && listening) {
      webUiSummary = `${statusChip('running')} managed · ${serviceStatus.url}`;
    } else if (serviceStatus.installed && serviceStatus.running) {
      webUiSummary = `${statusChip('pending')} managed service says running · port closed`;
    } else if (serviceStatus.installed) {
      webUiSummary = `${statusChip('stopped')} managed service installed · ${serviceStatus.url}`;
    } else if (listening) {
      webUiSummary = `${statusChip('running')} reachable · ${webUiUrl}`;
    }
  } catch (error) {
    if (isMissingServiceManagerError(error)) {
      const listening = await isLocalPortListening(webUiOptions.port);
      webUiSummary = listening
        ? `${statusChip('running')} reachable · ${webUiUrl}`
        : `${statusChip('stopped')} ${webUiUrl}`;
    } else {
      webUiSummary = `${statusChip('error')} ${(error as Error).message}`;
    }
  }

  let tailscaleSummary = webUiConfig.useTailscaleServe ? 'enabled' : 'disabled';
  if (webUiConfig.useTailscaleServe) {
    try {
      const tailscaleUrl = resolveWebUiTailscaleUrl();
      tailscaleSummary = tailscaleUrl && tailscaleUrl.trim().length > 0
        ? `enabled · ${tailscaleUrl}`
        : 'enabled';
    } catch {
      tailscaleSummary = 'enabled';
    }
  }

  return {
    profile,
    daemonSummary,
    webUiSummary,
    tailscaleSummary,
  };
}

async function printCliHome(options: { includeTailHint?: boolean } = {}): Promise<void> {
  const snapshot = await collectCliHomeSnapshot();
  const includeTailHint = options.includeTailHint ?? true;

  console.log(section('Personal Agent'));
  console.log('');
  console.log(keyValue('Profile', snapshot.profile));
  console.log(keyValue('Daemon', snapshot.daemonSummary));
  console.log(keyValue('Web UI', snapshot.webUiSummary));
  console.log(keyValue('Tailscale', snapshot.tailscaleSummary));

  if (includeTailHint) {
    console.log('');
    console.log(keyValue('Help', 'pa help [command]'));
  }
}

async function statusCommand(args: string[]): Promise<number> {
  ensureNoExtraCommandArgs(args, 'pa status');
  await printCliHome();
  return 0;
}

function printProfileHelp(): void {
  console.log('Profile');
  console.log('');
  printDenseUsage('pa profile [list|show|use|help]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'list', description: 'List available profiles' },
    { usage: 'show [name]', description: 'Show profile details' },
    { usage: 'use <name>', description: 'Set default profile' },
    { usage: 'help', description: 'Show profile help' },
  ]);
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
  console.log('Install');
  console.log('');
  printDenseUsage(INSTALL_COMMAND_USAGE);
  console.log('');
  printDenseParagraph('Add a Pi package source to the durable settings used by pa.');
  console.log('');
  printDenseLines('Options', [
    '--profile <name>   Install into the selected profile\'s settings.json',
    '-l, --local        Install into the machine-local overlay settings.json',
  ]);
  console.log('');
  printDenseLines('Examples', [
    'pa install https://github.com/davebcn87/pi-autoresearch',
    'pa install npm:@scope/package@1.2.3',
    'pa install ./my-package',
    'pa install --profile assistant https://github.com/user/repo',
    'pa install --local ./my-package',
  ]);
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
    lastError?: string;
  } | undefined;

  const status = module.lastError || detail?.lastError
    ? statusChip('error')
    : module.enabled
      ? statusChip('active')
      : statusChip('disabled');

  const summary = typeof detail?.cleanedFiles === 'number' && detail.cleanedFiles > 0
    ? ` · ${detail.cleanedFiles} cleaned`
    : '';

  console.log(bullet(`Housekeeping: ${status}${summary}`));

  if (module.lastError || detail?.lastError) {
    console.log(`    ${uiError('Housekeeping module', module.lastError || detail?.lastError || 'Unknown error')}`);
  }
}

function printTasksModuleStatus(module: DaemonStatus['modules'][0], configuredTaskDir: string): void {
  const detail = module.detail as {
    taskDir?: string;
    knownTasks?: number;
    parseErrors?: number;
    runningTasks?: number;
    lastError?: string;
  } | undefined;

  const status = module.lastError || detail?.lastError
    ? statusChip('error')
    : module.enabled
      ? statusChip('active')
      : statusChip('disabled');

  const parts: string[] = [];
  if (typeof detail?.knownTasks === 'number') {
    parts.push(`${detail.knownTasks} tasks`);
  }
  if (typeof detail?.runningTasks === 'number' && detail.runningTasks > 0) {
    parts.push(`${detail.runningTasks} running`);
  }
  if (typeof detail?.parseErrors === 'number' && detail.parseErrors > 0) {
    parts.push(`${detail.parseErrors} parse errors`);
  }

  console.log(bullet(`Tasks: ${status}${parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}`));

  if (module.lastError || detail?.lastError) {
    console.log(`    ${uiError('Tasks module', module.lastError || detail?.lastError || 'Unknown error')}`);
    return;
  }

  if (detail?.taskDir && detail.taskDir !== configuredTaskDir) {
    console.log(keyValue('Task directory', detail.taskDir, 4));
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

async function printDaemonStatusHumanReadable(options: { showNextStep?: boolean } = {}): Promise<void> {
  const config = loadDaemonConfig();
  const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
  const running = await pingDaemon(config);
  const showNextStep = options.showNextStep ?? true;

  if (!running) {
    console.log('');
    console.log(section('Daemon'));
    console.log(keyValue('Status', statusChip('stopped')));
    console.log(keyValue('Socket', daemonPaths.socketPath));
    if (showNextStep) {
      console.log('');
      console.log(`  ${formatNextStep('pa daemon start')}`);
    }
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

function printDaemonHelp(options: { title?: string; includeNextStep?: boolean } = {}): void {
  const title = options.title;
  const includeNextStep = options.includeNextStep ?? true;

  if (title) {
    console.log(title);
    console.log('');
  }
  printDenseUsage('pa daemon [status|start|stop|restart|logs|service|help] [args...]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'pa daemon', description: 'Show daemon status and commands' },
    { usage: 'pa daemon status [--json]', description: 'Show daemon status' },
    { usage: 'pa daemon start', description: 'Start daemon' },
    { usage: 'pa daemon stop', description: 'Stop daemon' },
    { usage: 'pa daemon restart', description: 'Restart daemon' },
    { usage: 'pa daemon logs', description: 'Show daemon log file and PID' },
    { usage: 'pa daemon service [install|status|uninstall|help]', description: 'Manage daemon as OS user service' },
    { usage: 'pa daemon help', description: 'Show daemon help' },
  ]);

  if (includeNextStep) {
    console.log('');
    console.log(`  ${formatNextStep('pa daemon')}`);
  }
}

function printDaemonServiceHelp(options: { includeNextStep?: boolean } = {}): void {
  const includeNextStep = options.includeNextStep ?? true;

  console.log('Daemon service');
  console.log('');
  printDenseUsage('pa daemon service [install|status|uninstall|help]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'pa daemon service help', description: 'Show daemon service help' },
    { usage: 'pa daemon service install', description: 'Install and start managed daemon service' },
    { usage: 'pa daemon service status', description: 'Show managed daemon service status' },
    { usage: 'pa daemon service uninstall', description: 'Stop and remove managed daemon service' },
  ]);
  if (includeNextStep) {
    console.log('');
    console.log(`  ${formatNextStep('pa daemon service install')}`);
  }
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
    await printDaemonStatusHumanReadable({ showNextStep: false });
    console.log('');
    printDaemonHelp({ includeNextStep: false });
    return 0;
  }

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(rest, 'pa daemon help');
    printDaemonHelp({ title: 'Daemon', includeNextStep: false });
    return 0;
  }

  if (subcommand === 'service') {
    const [rawAction, ...serviceArgs] = rest;

    if (!rawAction || isCliHelpToken(rawAction)) {
      ensureNoExtraCommandArgs(serviceArgs, 'pa daemon service help');
      printDaemonServiceHelp({ includeNextStep: false });
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
    const webUiSpinner = spinner('Restarting managed web UI service');
    webUiSpinner.start();

    try {
      const status = restartWebUiServiceIfInstalled(webUiOptions);

      if (status) {
        await waitForWebUiHealthy(status.port);
        webUiSpinner.succeed(`Restarted managed web UI service (${status.url})`);
        webUiStatus = `restarted (${status.identifier} @ ${status.url})`;
      } else {
        webUiSpinner.succeed('Managed web UI service not installed (skipped)');
      }
    } catch (error) {
      if (isMissingServiceManagerError(error)) {
        webUiSpinner.succeed('Service manager not available (skipped)');
        webUiStatus = 'skipped (service manager unavailable)';
      } else {
        webUiSpinner.fail('Failed to restart managed web UI service');
        throw new Error(`Failed to restart managed web UI service: ${(error as Error).message}`);
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

    if (process.env.PERSONAL_AGENT_RESTART_NOTIFY_SUCCESS_INBOX === '1') {
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
    if (
      process.env.PERSONAL_AGENT_RESTART_NOTIFY_FAILURE_INBOX === '1'
      || process.env.PERSONAL_AGENT_RESTART_NOTIFY_INBOX === '1'
    ) {
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
      currentPhase = `refresh repo-local pi to latest (${PI_PACKAGE_NAME})`;
      const piSpinner = spinner(`Refreshing repo-local pi to latest (${PI_PACKAGE_NAME})`);
      piSpinner.start();

      try {
        const piUpdateResult = updateRepoPiPackage(repoRoot);
        piOutput = piUpdateResult.output;
        piVersion = piUpdateResult.version;
        piUpdated = true;
        piSpinner.succeed(`Refreshed repo-local pi to latest (${piVersion})`);
      } catch (error) {
        piSpinner.fail('Unable to refresh repo-local pi to latest');
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

    if (process.env.PERSONAL_AGENT_UPDATE_NOTIFY_INBOX === '1') {
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
  task: StoredAutomation;
  runtime: TaskRuntimeRecord | undefined;
  status: TaskListStatus;
}

interface ResolvedTaskRuntimePaths {
  taskDir: string;
  stateFile: string;
  dbPath: string;
  runsRoot: string;
}

interface LoadedTaskCatalog {
  paths: ResolvedTaskRuntimePaths;
  tasks: StoredAutomation[];
  runtimeState: Record<string, TaskRuntimeRecord>;
  parseErrors: TaskParseError[];
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

function resolveTaskRuntimePaths(config: ReturnType<typeof loadDaemonConfig>): ResolvedTaskRuntimePaths {
  const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
  return {
    taskDir: config.modules.tasks.taskDir,
    stateFile: join(daemonPaths.root, 'task-state.json'),
    dbPath: getAutomationDbPath(config),
    runsRoot: resolveDurableRunsRoot(daemonPaths.root),
  };
}

function loadTaskCatalog(config: ReturnType<typeof loadDaemonConfig>): LoadedTaskCatalog {
  const paths = resolveTaskRuntimePaths(config);
  const importResult = ensureLegacyTaskImports({
    taskDir: paths.taskDir,
    defaultTimeoutSeconds: config.modules.tasks.defaultTimeoutSeconds,
    dbPath: paths.dbPath,
    legacyStateFile: paths.stateFile,
  });

  return {
    paths,
    tasks: listStoredAutomations({ dbPath: paths.dbPath }),
    runtimeState: loadAutomationRuntimeStateMap({ dbPath: paths.dbPath }) as Record<string, TaskRuntimeRecord>,
    parseErrors: importResult.parseErrors,
  };
}

function formatTaskSchedule(task: Pick<StoredAutomation, 'schedule'>): string {
  if (task.schedule.type === 'cron') {
    return `cron ${task.schedule.expression}`;
  }

  return `at ${task.schedule.at}`;
}

function resolveTaskListStatus(
  task: Pick<StoredAutomation, 'schedule' | 'enabled'>,
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

function toTaskListEntry(task: StoredAutomation, runtimeState: Record<string, TaskRuntimeRecord>): TaskListEntry {
  const runtime = runtimeState[task.id];

  return {
    task,
    runtime,
    status: resolveTaskListStatus(task, runtime),
  };
}

function toTaskListPayload(entry: TaskListEntry): {
  id: string;
  title: string;
  enabled: boolean;
  status: TaskListStatus;
  schedule: string;
  profile: string;
  model: string | null;
  cwd: string | null;
  timeoutSeconds: number;
  filePath: string | null;
  legacyFilePath: string | null;
  runtime: TaskRuntimeRecord | null;
} {
  const { task, runtime, status } = entry;

  return {
    id: task.id,
    title: task.title,
    enabled: task.enabled,
    status,
    schedule: formatTaskSchedule(task),
    profile: task.profile,
    model: task.modelRef ?? null,
    cwd: task.cwd ?? null,
    timeoutSeconds: task.timeoutSeconds,
    filePath: task.legacyFilePath ?? null,
    legacyFilePath: task.legacyFilePath ?? null,
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

function resolveTaskById(tasks: StoredAutomation[], id: string): StoredAutomation {
  const task = tasks.find((entry) => entry.id === id);
  if (!task) {
    throw new Error(`No task found with id: ${id}`);
  }

  return task;
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
  console.log('Tasks');
  console.log('');
  printDenseUsage('pa tasks [list|show|validate|logs|help]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'list [--json] [--status <all|running|active|completed|disabled|pending|error>]', description: 'List automations from SQLite and imported legacy task files' },
    { usage: 'show <id> [--json]', description: 'Show one automation definition and runtime state' },
    { usage: 'validate [--all|file]', description: 'Validate legacy task file frontmatter and prompt body' },
    { usage: 'logs <id> [--tail <n>]', description: 'Show latest automation run log (default: 80 lines)' },
    { usage: 'help', description: 'Show tasks help' },
  ]);
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
    const { paths, tasks, runtimeState, parseErrors } = loadTaskCatalog(config);

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

    console.log(section('Automations'));
    console.log(keyValue('Automation DB', paths.dbPath));
    console.log(keyValue('Legacy task directory', paths.taskDir));
    console.log(keyValue('Status filter', statusFilter));

    if (tasks.length === 0) {
      console.log(dim('No automations found.'));
    } else if (filteredTaskEntries.length === 0) {
      console.log(dim(`No automations matched status filter: ${statusFilter}`));
    }

    for (const entry of filteredTaskEntries) {
      const { task, runtime } = entry;
      const status = statusChip(entry.status);

      console.log('');
      console.log(bullet(`${task.id}: ${status}`));
      if (task.title && task.title !== task.id) {
        console.log(keyValue('Title', task.title, 4));
      }
      console.log(keyValue('Schedule', formatTaskSchedule(task), 4));
      console.log(keyValue('Profile', task.profile, 4));
      if (task.legacyFilePath) {
        console.log(keyValue('Imported from', task.legacyFilePath, 4));
      }

      if (runtime?.lastRunAt) {
        console.log(keyValue('Last run', new Date(runtime.lastRunAt).toLocaleString(), 4));
      }

      if (runtime?.lastStatus) {
        console.log(keyValue('Last status', runtime.lastStatus, 4));
      }
    }

    if (parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${parseErrors.length} legacy task file(s) failed to import`));
      for (const issue of parseErrors) {
        console.log(keyValue('Import error', `${issue.filePath}: ${issue.error}`, 4));
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
    const { paths, tasks, runtimeState } = loadTaskCatalog(config);
    const task = resolveTaskById(tasks, taskId);
    const runtime = runtimeState[task.id];

    const payload = {
      paths,
      task,
      runtime: runtime ?? null,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section(`Automation: ${task.id}`));
    console.log(keyValue('Title', task.title));
    console.log(keyValue('Schedule', formatTaskSchedule(task)));
    console.log(keyValue('Enabled', task.enabled ? 'yes' : 'no'));
    console.log(keyValue('Profile', task.profile));
    console.log(keyValue('Automation DB', paths.dbPath));
    console.log(keyValue('Legacy task directory', paths.taskDir));
    if (task.legacyFilePath) {
      console.log(keyValue('Imported from', task.legacyFilePath));
    }

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

    console.log(section('Legacy task validation'));
    console.log(keyValue('Task directory', paths.taskDir));
    console.log(keyValue('Files checked', results.length));

    if (results.length === 0) {
      console.log(dim('No legacy task files found.'));
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
    const { paths, tasks, runtimeState } = loadTaskCatalog(config);
    const task = resolveTaskById(tasks, taskId);

    let logPath = runtimeState[task.id]?.lastLogPath;

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
  if (!hasProfileActivityEntry({ repoRoot, profile, activityId: desiredId })) {
    return desiredId;
  }

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${desiredId}-${suffix}`;
    if (!hasProfileActivityEntry({ repoRoot, profile, activityId: candidate })) {
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
  activityStorePath: string;
  readState: Set<string>;
  sessions: ReturnType<typeof listStoredSessions>;
  activityEntries: InboxActivityStateEntry[];
  standaloneActivityEntries: InboxActivityStateEntry[];
  conversationEntries: InboxConversationStateEntry[];
  surfaceEntries: InboxSurfaceEntry[];
} {
  const profile = resolveProfileName();
  const repoRoot = getRepoRoot();
  const activityStorePath = resolveProfileActivityDbPath({ repoRoot, profile });
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
    activityStorePath,
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
  console.log('Inbox');
  console.log('');
  printDenseUsage('pa inbox [list|show|create|read|unread|delete|help] [args...]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'list [--json] [--limit <count>] [--all|--read|--unread] [--activities|--conversations]', description: 'List inbox items (default when no subcommand is provided)' },
    { usage: 'show <selector> [--json]', description: 'Show one inbox activity or conversation attention item' },
    { usage: 'create <summary> [options]', description: 'Create a standalone inbox activity entry' },
    { usage: 'read <selector>... [--all] [--json]', description: 'Mark inbox items as read' },
    { usage: 'unread <selector>... [--all] [--json]', description: 'Mark inbox items as unread' },
    { usage: 'delete <activity-selector>... [--json]', description: 'Delete inbox activity entries' },
    { usage: 'help', description: 'Show inbox help' },
  ]);
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
    const { profile, activityStorePath, standaloneActivityEntries, conversationEntries, surfaceEntries } = loadInboxState();
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
      activityStorePath,
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
    console.log(keyValue('Activity store', activityStorePath));
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
        activityStorePath: state.activityStorePath,
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
      console.log(keyValue('Activity store', state.activityStorePath));
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
    const { repoRoot, profile, activityStorePath, readState } = loadInboxState();
    const desiredId = id ?? buildDefaultInboxActivityId(kind, summary, createdAt);
    const finalId = id ? desiredId : resolveUniqueInboxActivityId(repoRoot, profile, desiredId);

    if (id && hasProfileActivityEntry({ repoRoot, profile, activityId: finalId })) {
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
      activityStorePath,
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

    deleteProfileActivityEntries({
      repoRoot: state.repoRoot,
      profile: state.profile,
      activityIds: deleted.map((item) => item.id),
    });

    for (const item of deleted) {
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

async function isLocalPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const server = createServer();
    server.unref();

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;

      if (result) {
        server.close(() => resolvePromise(true));
        return;
      }

      try {
        server.close(() => resolvePromise(false));
      } catch {
        resolvePromise(false);
      }
    };

    server.once('error', () => finish(false));
    server.listen(port, '127.0.0.1', () => finish(true));
  });
}

async function resolveForegroundCompanionPort(preferredPort: number, uiPort: number): Promise<{ port: number; adjusted: boolean }> {
  if (preferredPort !== uiPort && await isLocalPortAvailable(preferredPort)) {
    return { port: preferredPort, adjusted: false };
  }

  for (let candidate = uiPort + 1; candidate <= 65535; candidate += 1) {
    if (candidate === preferredPort) {
      continue;
    }

    if (await isLocalPortAvailable(candidate)) {
      return { port: candidate, adjusted: true };
    }
  }

  for (let candidate = uiPort - 1; candidate >= 1; candidate -= 1) {
    if (candidate === preferredPort) {
      continue;
    }

    if (await isLocalPortAvailable(candidate)) {
      return { port: candidate, adjusted: true };
    }
  }

  throw new Error(`Could not find a free companion port for web UI foreground launch (ui port ${uiPort}, preferred companion port ${preferredPort}).`);
}

async function showWebUiStatus(
  args: string[],
  displayOptions: { showNextStep?: boolean } = {},
): Promise<void> {
  const usage = 'pa ui status [--port <port>]';
  const parsed = parseNumericOption(args, '--port', readWebUiConfig().port, usage);
  ensureNoExtraCommandArgs(parsed.rest, usage);
  const showNextStep = displayOptions.showNextStep ?? true;

  const config = readWebUiConfig();
  const webUiOptions = getWebUiServiceOptions({ port: parsed.value });
  const url = `http://localhost:${webUiOptions.port}`;
  const listening = await isLocalPortListening(webUiOptions.port);
  let serviceSummary = 'not installed';

  try {
    const serviceStatus = getWebUiServiceStatus(webUiOptions);
    serviceSummary = serviceStatus.installed
      ? serviceStatus.running
        ? 'installed · running'
        : 'installed · stopped'
      : 'not installed';
  } catch (error) {
    serviceSummary = isMissingServiceManagerError(error)
      ? 'service manager unavailable'
      : `error · ${(error as Error).message}`;
  }

  console.log(section('Web UI'));
  console.log('');
  console.log(keyValue('URL', url));
  console.log(keyValue('Reachable', listening ? statusChip('running') : statusChip('stopped')));
  console.log(keyValue('Managed service', serviceSummary));
  console.log(keyValue('Tailscale Serve', config.useTailscaleServe ? 'enabled' : 'disabled'));

  if (config.useTailscaleServe) {
    try {
      const tailscaleUrl = resolveWebUiTailscaleUrl();
      if (tailscaleUrl && tailscaleUrl.trim().length > 0) {
        console.log(keyValue('Tailnet URL', tailscaleUrl));
      }
    } catch {
      // Ignore transient tailscale resolution failures in human-readable status output.
    }
  }

  if (!showNextStep) {
    return;
  }

  console.log('');
  if (listening) {
    console.log(`  ${formatNextStep('pa ui open')}`);
    return;
  }

  if (serviceSummary.startsWith('installed')) {
    console.log(`  ${formatNextStep('pa ui start')}`);
    return;
  }

  console.log(`  ${formatNextStep('pa ui foreground')}`);
}

async function openWebUiCommand(args: string[]): Promise<number> {
  const usage = 'pa ui open [--port <port>]';
  const parsed = parseNumericOption(args, '--port', readWebUiConfig().port, usage);
  ensureNoExtraCommandArgs(parsed.rest, usage);

  const url = `http://localhost:${parsed.value}`;
  if (!await isLocalPortListening(parsed.value)) {
    throw new Error(`Web UI is not reachable on ${url}. Start it with \`pa ui start\` or \`pa ui foreground\`.`);
  }

  openWebUiInBrowser(url);
  console.log(success(`Opened web UI at ${url}`));
  return 0;
}

function printWebUiHelp(options: { title?: string; includeNextStep?: boolean } = {}): void {
  const title = options.title;
  const includeNextStep = options.includeNextStep ?? true;

  if (title) {
    console.log(title);
    console.log('');
  }
  printDenseUsage('pa ui [status|open|foreground|logs|pairing-code|install|start|stop|restart|uninstall|help] [args...]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'pa ui', description: 'Show web UI status and commands' },
    { usage: 'pa ui status', description: 'Show web UI status' },
    { usage: 'pa ui open', description: 'Open the web UI in a browser' },
    { usage: 'pa ui foreground [--open]', description: 'Run the web UI in the foreground' },
    { usage: 'pa ui logs [--tail <count>]', description: 'Show recent managed web UI logs' },
    { usage: 'pa ui pairing-code', description: 'Create a pairing code for remote desktop or companion access' },
    { usage: 'pa ui install', description: 'Install and start managed web UI service' },
    { usage: 'pa ui start', description: 'Start managed web UI service' },
    { usage: 'pa ui stop', description: 'Stop managed web UI service' },
    { usage: 'pa ui restart', description: 'Restart managed web UI service' },
    { usage: 'pa ui uninstall', description: 'Stop and remove managed web UI service' },
    { usage: 'pa ui help', description: 'Show web UI help' },
  ]);
  console.log('');
  printDenseCommandList('Options', [
    { usage: '--port <port>', description: 'Override the configured web UI port' },
    { usage: '--[no-]tailscale-serve', description: 'Override Tailscale Serve for foreground and managed-service actions' },
  ]);

  if (includeNextStep) {
    console.log('');
    console.log(`  ${formatNextStep('pa ui')}`);
  }
}

function printWebUiServiceHelp(options: { includeNextStep?: boolean } = {}): void {
  const includeNextStep = options.includeNextStep ?? true;

  console.log('Web UI service');
  console.log('');
  printDenseUsage('pa ui service [install|status|start|stop|restart|uninstall|help] [args...]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'pa ui service help', description: 'Show web UI service help' },
    { usage: 'pa ui service install', description: 'Install and start managed web UI service' },
    { usage: 'pa ui service status', description: 'Show managed web UI service status' },
    { usage: 'pa ui service start', description: 'Start managed web UI service' },
    { usage: 'pa ui service stop', description: 'Stop managed web UI service' },
    { usage: 'pa ui service restart', description: 'Restart managed web UI service' },
    { usage: 'pa ui service uninstall', description: 'Stop and remove managed web UI service' },
  ]);
  console.log('');
  printDenseCommandList('Options', [
    { usage: '--port <port>', description: 'Override the configured web UI port' },
    { usage: '--[no-]tailscale-serve', description: 'Override Tailscale Serve for foreground and managed-service actions' },
  ]);
  if (includeNextStep) {
    console.log('');
    console.log(`  ${formatNextStep('pa ui install')}`);
  }
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
  console.log(keyValue('Tailscale Serve', readWebUiConfig().useTailscaleServe ? 'enabled' : 'disabled'));
  if (status.deployment?.activeRelease?.revision) {
    console.log(keyValue('Active release', status.deployment.activeRelease.revision));
  }

  if (status.logFile) {
    console.log(keyValue('Log file', status.logFile));
  }

  if (!status.installed) {
    console.log('');
    console.log(`  ${formatNextStep('pa ui install')}`);
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
    console.log(dim('No web UI log file found yet. Install and run the managed service with `pa ui install` or start the UI in the foreground with `pa ui foreground`.'));
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
    throw new Error(`Could not reach the web UI on ${url}. Start it first with \`pa ui start\` or \`pa ui foreground\`.`);
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

async function runWebUiServiceAction(action: string, args: string[], commandPrefix = 'pa ui'): Promise<void> {
  const usage = `${commandPrefix} ${action} [--port <port>] [--tailscale-serve|--no-tailscale-serve]`;

  const parsedTailscaleServe = parseBooleanOption(args, '--tailscale-serve', usage);
  const parsedPort = parseNumericOption(parsedTailscaleServe.rest, '--port', readWebUiConfig().port, usage);
  ensureNoExtraCommandArgs(parsedPort.rest, usage);

  const currentConfig = readWebUiConfig();
  const options = getWebUiServiceOptions({ port: parsedPort.value });
  const desiredUseTailscaleServe = parsedTailscaleServe.explicit
    ? parsedTailscaleServe.value
    : currentConfig.useTailscaleServe;
  const desiredConfig = finalizeMachineWebUiConfigState({
    ...currentConfig,
    port: options.port,
    useTailscaleServe: desiredUseTailscaleServe,
    resumeFallbackPrompt: currentConfig.resumeFallbackPrompt,
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
    console.log(`  ${formatNextStep(`${commandPrefix} status`)}`);
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

  const removed = uninstallWebUiService(options);
  console.log(success('Removed managed web UI service'));
  console.log(keyValue('Service', removed.identifier));
  console.log(keyValue('Manifest', removed.manifestPath));
  if (removed.logFile) {
    console.log(keyValue('Log file', removed.logFile));
  }
  console.log(`  ${formatNextStep(`${commandPrefix} install`)}`);
}

async function startForegroundWebUi(args: string[], commandPrefix = 'pa ui foreground'): Promise<number> {
  const usage = `${commandPrefix} [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]`;
  const parsedTailscaleServe = parseBooleanOption(args, '--tailscale-serve', usage);
  const currentConfig = readWebUiConfig();
  const portParse = parseNumericOption(
    parsedTailscaleServe.rest,
    '--port',
    currentConfig.port,
    usage,
  );
  const openBrowser = hasOption(portParse.rest, '--open');
  const remainingArgs = portParse.rest.filter((arg) => arg !== '--open');
  ensureNoExtraCommandArgs(remainingArgs, usage);

  const desiredUseTailscaleServe = parsedTailscaleServe.explicit
    ? parsedTailscaleServe.value
    : currentConfig.useTailscaleServe;
  const desiredConfig = finalizeMachineWebUiConfigState({
    ...currentConfig,
    port: portParse.value,
    useTailscaleServe: desiredUseTailscaleServe,
    resumeFallbackPrompt: currentConfig.resumeFallbackPrompt,
  });

  if (parsedTailscaleServe.explicit) {
    writeWebUiConfig(desiredConfig);

    syncWebUiTailscaleServeFromCli({
      enabled: parsedTailscaleServe.value,
      port: desiredConfig.port,
      companionPort: desiredConfig.companionPort,
      strict: parsedTailscaleServe.value,
      context: `Could not ${parsedTailscaleServe.value ? 'enable' : 'disable'} Tailscale Serve`,
    });
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
      console.log(`  ${formatNextStep('pa ui status')}`);
      return 0;
    }
  } catch (error) {
    if (!isMissingServiceManagerError(error)) {
      console.log(`  ${warning(`Could not inspect managed web UI service: ${(error as Error).message}`)}`);
    }
  }

  const launchCompanionPort = await resolveForegroundCompanionPort(desiredConfig.companionPort, desiredConfig.port);

  if (launchCompanionPort.adjusted) {
    console.log(`  ${warning(`Configured companion port ${desiredConfig.companionPort} is unavailable; using ${launchCompanionPort.port} for this foreground session`)}`);

    if (desiredUseTailscaleServe) {
      syncWebUiTailscaleServeFromCli({
        enabled: true,
        port: desiredConfig.port,
        companionPort: launchCompanionPort.port,
        strict: parsedTailscaleServe.explicit && parsedTailscaleServe.value,
        context: 'Could not update Tailscale Serve for the foreground companion port',
      });
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
      PA_WEB_COMPANION_PORT: String(launchCompanionPort.port),
      PA_WEB_DIST: distPath,
      PERSONAL_AGENT_REPO_ROOT: repoRoot,
      PERSONAL_AGENT_WEB_TAILSCALE_SERVE: String(desiredUseTailscaleServe),
    },
  });

  return result.status ?? 0;
}

async function uiCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  const directActions = ['install', 'start', 'stop', 'restart', 'uninstall'] as const;

  if (!subcommand) {
    await showWebUiStatus([], { showNextStep: false });
    console.log('');
    printWebUiHelp({ includeNextStep: false });
    return 0;
  }

  if (isCliHelpToken(subcommand)) {
    ensureNoExtraCommandArgs(rest, 'pa ui help');
    printWebUiHelp({ title: 'Web UI', includeNextStep: false });
    return 0;
  }

  if (subcommand.startsWith('-')) {
    return startForegroundWebUi(args, 'pa ui');
  }

  if (subcommand === 'status') {
    await showWebUiStatus(rest);
    return 0;
  }

  if (subcommand === 'open') {
    return openWebUiCommand(rest);
  }

  if (subcommand === 'foreground') {
    return startForegroundWebUi(rest, 'pa ui foreground');
  }

  if (subcommand === 'logs') {
    showWebUiLogs(rest);
    return 0;
  }

  if (subcommand === 'pairing-code') {
    await showWebUiPairingCode(rest);
    return 0;
  }

  if (directActions.includes(subcommand as (typeof directActions)[number])) {
    await runWebUiServiceAction(subcommand, rest);
    return 0;
  }

  if (subcommand === 'service') {
    const [action, ...serviceArgs] = rest;

    if (!action || isCliHelpToken(action)) {
      ensureNoExtraCommandArgs(serviceArgs, 'pa ui service help');
      printWebUiServiceHelp({ includeNextStep: false });
      return 0;
    }

    if (!['install', 'status', 'start', 'stop', 'restart', 'uninstall'].includes(action)) {
      throw new Error(`Unknown ui service subcommand: ${action}`);
    }

    await runWebUiServiceAction(action, serviceArgs, 'pa ui service');
    return 0;
  }

  throw new Error(`Unknown ui subcommand: ${subcommand}`);
}

type CommandHandler = (args: string[]) => Promise<number>;

type CliCommandCategory = 'chat' | 'system' | 'automation' | 'data' | 'configuration';

interface CliCommandDefinition {
  name: string;
  description: string;
  category: CliCommandCategory;
  usage?: string;
  helpText?: string;
  disableBuiltInHelp?: boolean;
  run: CommandHandler;
}

function buildCommandDefinitions(): CliCommandDefinition[] {
  const definitions: CliCommandDefinition[] = [
    {
      name: 'status',
      category: 'system',
      usage: 'status',
      description: 'Show status',
      run: statusCommand,
    },
    {
      name: 'tui',
      category: 'chat',
      usage: 'tui [args...]',
      description: 'Start a chat session',
      run: runCommand,
    },
    {
      name: 'install',
      category: 'configuration',
      usage: 'install [args...]',
      description: 'Add a Pi package source',
      helpText: `\nUsage: ${INSTALL_COMMAND_USAGE}\n\n${INSTALL_COMMAND_HELP_TEXT}\n`,
      disableBuiltInHelp: true,
      run: installCommand,
    },
    {
      name: 'profile',
      category: 'configuration',
      usage: 'profile [list|show|use|help] [args...]',
      description: 'Manage profile settings',
      disableBuiltInHelp: true,
      run: profileCommand,
    },
    {
      name: 'doctor',
      category: 'system',
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
      category: 'system',
      usage: 'restart [--rebuild]',
      description: 'Restart daemon and web UI',
      run: restartCommand,
    },
    {
      name: 'update',
      category: 'system',
      usage: 'update [--repo-only]',
      description: 'Update repo, pi, and services',
      run: updateCommand,
    },
    {
      name: 'daemon',
      category: 'system',
      usage: 'daemon [status|start|stop|restart|logs|service|help] [args...]',
      description: 'Manage daemon',
      helpText: DAEMON_HELP_TEXT,
      disableBuiltInHelp: true,
      run: daemonCommand,
    },
    {
      name: 'tasks',
      category: 'automation',
      usage: 'tasks [list|show|validate|logs|help] [args...]',
      description: 'Inspect scheduled tasks',
      disableBuiltInHelp: true,
      run: tasksCommand,
    },
    {
      name: 'inbox',
      category: 'data',
      usage: 'inbox [list|show|create|read|unread|delete|help] [args...]',
      description: 'Manage inbox items',
      disableBuiltInHelp: true,
      run: inboxCommand,
    },
    {
      name: 'ui',
      category: 'system',
      usage: 'ui [status|open|foreground|logs|pairing-code|install|start|stop|restart|uninstall|help] [args...]',
      description: 'Inspect web UI',
      disableBuiltInHelp: true,
      run: uiCommand,
    },
    {
      name: 'mcp',
      category: 'data',
      usage: 'mcp [list|info|grep|call|auth|logout|help] [args...]',
      description: 'Inspect and call MCP servers',
      disableBuiltInHelp: true,
      run: mcpCommand,
    },
    {
      name: 'runs',
      category: 'automation',
      usage: 'runs [list|show|logs|start|start-agent|rerun|follow-up|cancel|help] [args...]',
      description: 'Inspect background runs',
      disableBuiltInHelp: true,
      run: runsCommand,
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

function printRootHelp(
  definitions: CliCommandDefinition[],
  options: { includePreamble?: boolean } = {},
): void {
  const includePreamble = options.includePreamble ?? true;

  if (includePreamble) {
    printDenseUsage('pa [command] [args...]');
    console.log('');
  }

  printDenseCommandList('Commands', [
    ...definitions.map((definition) => ({
      usage: `pa ${definition.usage ?? definition.name}`,
      description: definition.description,
    })),
    { usage: 'pa help [command]', description: 'Show command help' },
  ]);
  console.log('');
  printDenseCommandList('Global options', [
    { usage: '--plain, --no-color', description: 'Disable rich ANSI styling' },
  ]);
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
      await printCliHome({ includeTailHint: false });
      console.log('');
      printRootHelp(definitions, { includePreamble: false });
      return 0;
    }

    const [firstArg, ...restArgs] = parsedFlags.argv;
    const isHelpRequest = firstArg === '--help' || firstArg === '-h' || firstArg === 'help';

    if (isHelpRequest) {
      if (firstArg === 'help' && restArgs.length > 0) {
        const targetCommand = restArgs[0] as string;

        if (!knownCommands.has(targetCommand)) {
          console.error(uiError('CLI error', `Unknown top-level command: ${targetCommand}`));
          return 1;
        }

        await program.parseAsync([targetCommand, '--help'], { from: 'user' });
        return 0;
      }

      printRootHelp(definitions);
      return 0;
    }

    if (!knownCommands.has(firstArg)) {
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

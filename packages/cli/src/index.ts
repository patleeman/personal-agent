#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { Command, CommanderError } from 'commander';
import {
  bootstrapStateOrThrow,
  preparePiAgentDir,
  resolveStatePaths,
  validateStatePathsOutsideRepo,
} from '@personal-agent/core';
import {
  buildPiResourceArgs,
  getExtensionDependencyDirs,
  getRepoRoot,
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
  startDaemonDetached,
  stopDaemonGracefully,
  parseTaskDefinition,
  type DaemonStatus,
  type ParsedTaskDefinition,
} from '@personal-agent/daemon';
import {
  SUPPORTED_GATEWAY_PROVIDERS,
  getManagedDaemonServiceStatus,
  installManagedDaemonService,
  registerGatewayCliCommands,
  restartGatewayServiceIfInstalled,
  restartManagedDaemonServiceIfInstalled,
  uninstallManagedDaemonService,
  type RegisteredCliCommand,
} from '@personal-agent/gateway';
import { hasOption } from './args.js';
import { readConfig, setDefaultProfile } from './config.js';
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
  pending,
  progressBar,
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
const PI_PACKAGE_LATEST = `${PI_PACKAGE_NAME}@latest`;

function ensurePiInstalled(): void {
  const result = spawnSync('pi', ['--version'], { encoding: 'utf-8' });
  if (result.error || result.status !== 0) {
    throw new Error(`\`pi\` command not found. Install with: npm install -g ${PI_PACKAGE_NAME}`);
  }
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

interface SystemThemeMappingStatus {
  configured: boolean;
  mode?: SystemThemeMode;
  selectedTheme?: string;
}

function parseSystemThemeMode(value: string | undefined): SystemThemeMode | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'light' || normalized === 'dark') {
    return normalized;
  }

  return undefined;
}

function detectSystemThemeMode(): SystemThemeMode | undefined {
  const override = parseSystemThemeMode(process.env.PERSONAL_AGENT_SYSTEM_THEME);
  if (override) {
    return override;
  }

  if (process.platform === 'darwin') {
    const result = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], {
      encoding: 'utf-8',
    });

    if (result.error) {
      return undefined;
    }

    if ((result.status ?? 1) === 0) {
      const value = result.stdout.toLowerCase();
      return value.includes('dark') ? 'dark' : 'light';
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

function getSystemThemeMappingStatus(): SystemThemeMappingStatus {
  const darkTheme = process.env.PERSONAL_AGENT_THEME_DARK?.trim();
  const lightTheme = process.env.PERSONAL_AGENT_THEME_LIGHT?.trim();

  if (!darkTheme || !lightTheme) {
    return { configured: false };
  }

  const mode = detectSystemThemeMode();

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

function applySystemThemeOverride(settingsPath: string, settings: Record<string, unknown>): Record<string, unknown> {
  const mappingStatus = getSystemThemeMappingStatus();
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

async function runPi(profileName: string, piArgs: string[]): Promise<number> {
  const resolvedProfile = resolveResourceProfile(profileName);
  const statePaths = resolveStatePaths();

  validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);

  ensurePiInstalled();
  await maybeStartDaemon();

  return runPiWithResolvedProfile(resolvedProfile, piArgs);
}

async function runPiWithResolvedProfile(
  resolvedProfile: ReturnType<typeof resolveResourceProfile>,
  piArgs: string[],
): Promise<number> {
  const statePaths = resolveStatePaths();

  await bootstrapStateOrThrow(statePaths);

  const runtime = await preparePiAgentDir({
    statePaths,
    copyLegacyAuth: true,
  });

  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);
  ensureExtensionDependencies(resolvedProfile);

  const fallbackSettings = resolvedProfile.settingsFiles.length > 0
    ? mergeJsonFiles(resolvedProfile.settingsFiles)
    : {};
  const settingsPath = join(runtime.agentDir, 'settings.json');
  const runtimeSettings = readRuntimeSettings(settingsPath, fallbackSettings);
  const settings = applySystemThemeOverride(settingsPath, runtimeSettings);

  const resourceArgs = buildPiResourceArgs(resolvedProfile);
  const withDefaults = applyDefaultModelArgs(piArgs, settings);

  const args = [...resourceArgs, ...withDefaults];

  const result = spawnSync('pi', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: runtime.agentDir,
      PERSONAL_AGENT_ACTIVE_PROFILE: resolvedProfile.name,
      PERSONAL_AGENT_REPO_ROOT: resolvedProfile.repoRoot,
    },
  });

  if (result.error) {
    throw result.error;
  }

  const sessionFile = extractSessionFile(withDefaults);
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

function countFilesNamed(directories: string[], fileName: string): number {
  const stack = [...directories];
  let count = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name === fileName) {
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
    const hint = `npm install -g ${PI_PACKAGE_NAME}`;

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

  try {
    await bootstrapStateOrThrow(statePaths);
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

  const runtime = await preparePiAgentDir({ statePaths, copyLegacyAuth: true });
  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);

  const runtimeAuth = runtime.authFile;
  const legacyAuth = join(homedir(), '.pi', 'agent', 'auth.json');
  const themeMappingStatus = getSystemThemeMappingStatus();

  const report = {
    ok: true,
    profile: resolvedProfile.name,
    layers: resolvedProfile.layers.map((layer) => layer.name),
    runtimeRoot: statePaths.root,
    runtimeAgentDir: runtime.agentDir,
    extensionDirs: resolvedProfile.extensionDirs.length,
    extensionEntries: resolvedProfile.extensionEntries.length,
    skillDirs: resolvedProfile.skillDirs.length,
    skillDefinitions: countFilesNamed(resolvedProfile.skillDirs, 'SKILL.md'),
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

async function runCommand(args: string[]): Promise<number> {
  const profileName = resolveProfileName();
  const passthroughArgs = args[0] === '--'
    ? args.slice(1)
    : args;

  return runPi(profileName, passthroughArgs);
}

async function profileCommand(args: string[]): Promise<number> {
  const [subcommand, value] = args;

  if (!subcommand) {
    console.log(section('Profile commands'));
    console.log('');
    console.log(`Usage: pa profile [list|show|use]

Commands:
  list           List available profiles
  show [name]    Show profile details
  use <name>     Set default profile
`);
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

async function printMemoryModuleStatus(module: DaemonStatus['modules'][0]): Promise<void> {
  const detail = module.detail as {
    scannedSessions?: number;
    summarizedSessions?: number;
    skippedSessions?: number;
    failedSessions?: number;
    needsEmbedding?: boolean;
    dirty?: boolean;
    lastScanAt?: string;
    lastError?: string;
  } | undefined;

  const { loadDaemonConfig } = await import('@personal-agent/daemon');
  const config = loadDaemonConfig();

  const sessionDir = config.modules.memory.sessionSource;
  const summaryDir = config.modules.memory.summaryDir;

  const sessionFiles = existsSync(sessionDir)
    ? spawnSync('find', [sessionDir, '-name', '*.jsonl', '-type', 'f'], { encoding: 'utf-8' }).stdout.split('\n').filter(Boolean)
    : [];

  const summaryFiles = listMemorySummaryFiles(summaryDir);
  const skipMarkerFiles = listMemorySkipMarkerFiles(summaryDir);

  const total = sessionFiles.length;
  const summarizedOnDisk = summaryFiles.length;
  const filteredOnDisk = skipMarkerFiles.length;
  const processedOnDisk = Math.min(total, summarizedOnDisk + filteredOnDisk);
  const failed = detail?.failedSessions ?? 0;
  const hasError = Boolean(module.lastError || detail?.lastError);
  const hasPending = Boolean(detail?.needsEmbedding || detail?.dirty);

  const primaryCollection = config.modules.memory.collections[0]?.name;
  const qmdCounts = primaryCollection
    ? getQmdCollectionCounts(primaryCollection)
    : undefined;

  const status = hasError
    ? statusChip('error')
    : hasPending
      ? statusChip('pending')
      : statusChip('active');

  console.log(bullet(`Memory summaries: ${status}`));
  console.log(keyValue('Coverage', `${progressBar(processedOnDisk, total)} (${summarizedOnDisk} summarized, ${filteredOnDisk} filtered, ${total} total)`, 4));

  if (qmdCounts && primaryCollection) {
    console.log(keyValue(`qmd indexed summaries (${primaryCollection})`, qmdCounts.workspace, 4));

    if (qmdCounts.workspace < summarizedOnDisk) {
      console.log(`    ${pending('qmd index is behind summaries on disk')}`);
    }
  }

  if (failed > 0) {
    console.log(`    ${warning(`${failed} session scans failed`)}`);
  }

  if (detail?.needsEmbedding) {
    console.log(`    ${pending('Waiting for embedding')}`);
  }

  if (detail?.dirty) {
    console.log(`    ${pending('Updates pending')}`);
  }

  if (hasError) {
    console.log(`    ${uiError('Memory module', module.lastError || detail?.lastError || 'Unknown error')}`);
  }
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

  if (detail?.runsRoot) {
    console.log(keyValue('Task runs directory', detail.runsRoot, 4));
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
    if (module.name === 'memory') {
      await printMemoryModuleStatus(module);
      continue;
    }

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
    console.log('personal-agentd: stopped');
    console.log(`socket: ${daemonPaths.socketPath}`);
    console.log(`taskDir: ${config.modules.tasks.taskDir}`);
    console.log('hint: pa daemon start');

    console.log('');
    console.log(uiError('Daemon is stopped'));
    console.log(`  ${formatHint('pa daemon start')}`);
    return;
  }

  const status = await getDaemonStatus(config);
  const uptime = Date.now() - new Date(status.startedAt).getTime();
  const uptimeMinutes = Math.floor(uptime / 60000);
  const uptimeText = uptimeMinutes < 60
    ? `${uptimeMinutes}m`
    : `${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m`;

  console.log('personal-agentd: running');
  console.log(`socket: ${daemonPaths.socketPath}`);

  console.log('');
  console.log(section('Daemon status'));
  console.log(success('Daemon running', `pid ${status.pid}, up ${uptimeText}`));
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

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    ensureNoExtraCommandArgs(rest, 'pa daemon help');
    printDaemonHelp();
    return 0;
  }

  if (subcommand === 'service') {
    const [rawAction, ...serviceArgs] = rest;

    if (!rawAction || rawAction === 'help' || rawAction === '--help' || rawAction === '-h') {
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
    const daemonSpinner = spinner('Restarting personal-agentd');
    daemonSpinner.start();
    await stopDaemonGracefully();
    await startDaemonDetached();
    daemonSpinner.succeed('personal-agentd restart requested');
    console.log(`  ${formatNextStep('pa daemon status')}`);
    return 0;
  }

  if (subcommand === 'logs') {
    ensureNoExtraCommandArgs(rest, 'pa daemon logs');
    const config = loadDaemonConfig();
    const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
    const pid = await readDaemonPid();

    console.log(`logFile=${daemonPaths.logFile}`);
    console.log(`pid=${pid ?? 'unknown'}`);

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

  const result = spawnSync('git', ['-C', repoRoot, 'pull', '--ff-only'], {
    encoding: 'utf-8',
  });

  if (result.error) {
    throw new Error(`Failed to run git pull: ${result.error.message}`);
  }

  const statusCode = result.status ?? 1;
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  if (statusCode !== 0) {
    const detail = stderr || stdout || `exit code ${statusCode}`;
    throw new Error(`Git pull failed in ${repoRoot}: ${detail}`);
  }

  return [stdout, stderr].filter((line) => line.length > 0).join('\n');
}

function updatePiPackage(): string {
  const result = spawnSync('npm', ['install', '-g', PI_PACKAGE_LATEST], {
    encoding: 'utf-8',
  });

  if (result.error) {
    throw new Error(`Failed to run npm install -g ${PI_PACKAGE_LATEST}: ${result.error.message}`);
  }

  const statusCode = result.status ?? 1;
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  if (statusCode !== 0) {
    const detail = stderr || stdout || `exit code ${statusCode}`;
    throw new Error(`Pi update failed (${PI_PACKAGE_LATEST}): ${detail}`);
  }

  return [stdout, stderr].filter((line) => line.length > 0).join('\n');
}

function isMissingServiceManagerError(error: unknown): boolean {
  const message = (error as Error).message;
  return message.includes('spawnSync launchctl ENOENT') || message.includes('spawnSync systemctl ENOENT');
}

interface RestartSummary {
  restartedGatewayServices: string[];
  skippedGatewayServices: string[];
  managedDaemonServiceRestarted: boolean;
}

async function restartBackgroundServices(): Promise<RestartSummary> {
  const daemonSpinner = spinner('Restarting personal-agentd');
  daemonSpinner.start();

  try {
    await stopDaemonGracefully();
    await startDaemonDetached();
    daemonSpinner.succeed('personal-agentd restart requested');
  } catch (error) {
    daemonSpinner.fail('Unable to restart personal-agentd');
    throw error;
  }

  const managedDaemonSpinner = spinner('Restarting managed daemon service');
  managedDaemonSpinner.start();

  let managedDaemonServiceRestarted = false;
  let serviceManagerAvailable = true;

  try {
    const managedDaemonService = restartManagedDaemonServiceIfInstalled();

    if (managedDaemonService) {
      managedDaemonServiceRestarted = true;
      managedDaemonSpinner.succeed(`Managed daemon service restarted (${managedDaemonService.identifier})`);
    } else {
      managedDaemonSpinner.succeed('Managed daemon service not installed (skipped)');
    }
  } catch (error) {
    if (isMissingServiceManagerError(error)) {
      serviceManagerAvailable = false;
      managedDaemonSpinner.succeed('Service manager not available (skipped)');
    } else {
      managedDaemonSpinner.fail('Unable to restart managed daemon service');
      throw error;
    }
  }

  const restartedGatewayServices: string[] = [];
  const skippedGatewayServices: string[] = [];
  const failedGatewayServices: string[] = [];

  if (!serviceManagerAvailable) {
    console.log(`  ${warning('Gateway service manager not found; skipping managed gateway restarts')}`);
    skippedGatewayServices.push(...SUPPORTED_GATEWAY_PROVIDERS);
  } else {
    for (const provider of SUPPORTED_GATEWAY_PROVIDERS) {
      const gatewaySpinner = spinner(`Restarting ${provider} gateway service`);
      gatewaySpinner.start();

      try {
        const status = restartGatewayServiceIfInstalled(provider);

        if (status) {
          gatewaySpinner.succeed(`Restarted ${provider} gateway service`);
          restartedGatewayServices.push(provider);
        } else {
          gatewaySpinner.succeed(`${provider} gateway service not installed (skipped)`);
          skippedGatewayServices.push(provider);
        }
      } catch (error) {
        if (isMissingServiceManagerError(error)) {
          gatewaySpinner.succeed('Service manager not available (skipped)');
          skippedGatewayServices.push(provider);
          continue;
        }

        gatewaySpinner.fail(`Failed to restart ${provider} gateway service`);
        failedGatewayServices.push(`${provider}: ${(error as Error).message}`);
      }
    }
  }

  if (failedGatewayServices.length > 0) {
    throw new Error(`Failed to restart gateway services:\n${failedGatewayServices.map((detail) => `- ${detail}`).join('\n')}`);
  }

  return {
    restartedGatewayServices,
    skippedGatewayServices,
    managedDaemonServiceRestarted,
  };
}

async function restartCommand(args: string[]): Promise<number> {
  ensureNoExtraCommandArgs(args, 'pa restart');

  const summary = await restartBackgroundServices();

  console.log('');
  console.log(section('Restart summary'));
  console.log(keyValue('personal-agentd', 'restarted'));
  console.log(keyValue('managed daemon service', summary.managedDaemonServiceRestarted ? 'restarted' : 'not installed'));
  console.log(keyValue('gateway services restarted', summary.restartedGatewayServices.length > 0 ? summary.restartedGatewayServices.join(', ') : 'none'));
  console.log(keyValue('gateway services skipped', summary.skippedGatewayServices.length > 0 ? summary.skippedGatewayServices.join(', ') : 'none'));

  return 0;
}

async function updateCommand(args: string[]): Promise<number> {
  const options = parseUpdateOptions(args);

  const repoRoot = getRepoRoot();
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
  let piUpdated = false;

  if (!options.repoOnly) {
    const piSpinner = spinner(`Updating pi (${PI_PACKAGE_NAME})`);
    piSpinner.start();

    try {
      piOutput = updatePiPackage();
      piUpdated = true;
      piSpinner.succeed(`Updated pi package (${PI_PACKAGE_LATEST})`);
    } catch (error) {
      piSpinner.fail('Unable to update pi package');
      throw error;
    }

    if (piOutput.length > 0) {
      console.log(dim(piOutput));
    }
  }

  const summary = await restartBackgroundServices();

  console.log('');
  console.log(section('Update summary'));
  console.log(keyValue('repository', repoRoot));
  console.log(keyValue('pi package', options.repoOnly ? 'skipped (--repo-only)' : (piUpdated ? 'updated' : 'unknown')));
  console.log(keyValue('managed daemon service', summary.managedDaemonServiceRestarted ? 'restarted' : 'not installed'));
  console.log(keyValue('gateway services restarted', summary.restartedGatewayServices.length > 0 ? summary.restartedGatewayServices.join(', ') : 'none'));
  console.log(keyValue('gateway services skipped', summary.skippedGatewayServices.length > 0 ? summary.skippedGatewayServices.join(', ') : 'none'));

  return 0;
}

function toProcessText(value: string | Buffer | null | undefined): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value) {
    return value.toString('utf-8');
  }

  return '';
}

function parseQmdIndexedFileCount(statusText: string): number | undefined {
  const match = statusText.match(/Total:\s*(\d+)\s*files indexed/i);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

interface QmdCollectionCounts {
  total: number;
  workspace: number;
}

function getQmdCollectionCounts(collectionName: string): QmdCollectionCounts | undefined {
  const result = spawnSync('qmd', ['ls', collectionName], { encoding: 'utf-8' });

  if (result.error || (result.status ?? 1) !== 0) {
    return undefined;
  }

  const output = toProcessText(result.stdout || result.stderr);
  const prefix = `qmd://${collectionName}/`;

  let total = 0;
  let workspace = 0;

  for (const line of output.split('\n')) {
    const index = line.indexOf(prefix);
    if (index < 0) {
      continue;
    }

    const relativePath = line.slice(index + prefix.length).trim();
    if (relativePath.length === 0) {
      continue;
    }

    total += 1;

    if (relativePath.includes('/')) {
      workspace += 1;
    }
  }

  return {
    total,
    workspace,
  };
}

interface RunQmdOptions {
  quiet?: boolean;
}

function runQmdCommand(
  args: string[],
  description: string,
  options: RunQmdOptions = {},
): ReturnType<typeof spawnSync> {
  const commandSpinner = options.quiet ? undefined : spinner(description);
  commandSpinner?.start();

  const result = spawnSync('qmd', args, { encoding: 'utf-8' });

  if (result.error) {
    commandSpinner?.fail('qmd command failed');
    throw new Error(`Failed to run qmd. Is it installed?\n${formatHint('Install qmd and verify with: qmd --version')}`);
  }

  if (!options.quiet) {
    if ((result.status ?? 1) !== 0) {
      commandSpinner?.fail('qmd command failed');
    } else {
      commandSpinner?.succeed('qmd command completed');
    }
  }

  return result;
}

function listMemorySummaryFiles(summaryDir: string): string[] {
  if (!existsSync(summaryDir)) {
    return [];
  }

  const result = spawnSync('find', [summaryDir, '-mindepth', '2', '-name', '*.md', '-type', 'f'], { encoding: 'utf-8' });

  if (result.error || (result.status ?? 1) !== 0) {
    return [];
  }

  return toProcessText(result.stdout).split('\n').filter((line) => line.trim().length > 0);
}

function listMemorySkipMarkerFiles(summaryDir: string): string[] {
  if (!existsSync(summaryDir)) {
    return [];
  }

  const result = spawnSync('find', [summaryDir, '-mindepth', '2', '-name', '*.skip', '-type', 'f'], { encoding: 'utf-8' });

  if (result.error || (result.status ?? 1) !== 0) {
    return [];
  }

  return toProcessText(result.stdout).split('\n').filter((line) => line.trim().length > 0);
}

function parseMemoryHeadCount(rawValue: string | undefined): number {
  if (!rawValue) {
    return 5;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error('Usage: pa memory head [count] (count must be a positive integer)');
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Usage: pa memory head [count] (count must be a positive integer)');
  }

  return parsed;
}

function findMemoryFileBySessionId(files: string[], sessionId: string, extension: string): string | undefined {
  const needle = `${sessionId}${extension}`;
  return files.find((path) => path.endsWith(needle));
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
    runsRoot: join(daemonPaths.root, 'task-runs'),
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

function sanitizeTaskRunDirectoryName(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'task';
}

function findLatestTaskLogFile(taskRunDir: string): string | undefined {
  if (!existsSync(taskRunDir)) {
    return undefined;
  }

  const entries = readdirSync(taskRunDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => join(taskRunDir, entry.name));

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

function readTailLines(path: string, lineCount: number): string {
  const text = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  if (lines.length === 0) {
    return '';
  }

  return lines.slice(-lineCount).join('\n').trimEnd();
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

async function tasksCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    console.log(section('Tasks commands'));
    console.log('');
    console.log(`Usage: pa tasks [list|show|validate|logs]

Commands:
  list [--json]            List parsed scheduled tasks with runtime status
  show <id> [--json]       Show one task definition and runtime state
  validate [--all|file]    Validate task file frontmatter and prompt body
  logs <id> [--tail <n>]   Show latest task run log (default: 80 lines)
`);

    const config = loadDaemonConfig();
    console.log(keyValue('Task directory', config.modules.tasks.taskDir));
    return 0;
  }

  if (subcommand === 'list') {
    const jsonMode = hasOption(rest, '--json');
    const unexpected = rest.filter((arg) => arg !== '--json');

    if (unexpected.length > 0) {
      throw new Error('Usage: pa tasks list [--json]');
    }

    const config = loadDaemonConfig();
    const paths = resolveTaskRuntimePaths(config);
    const { tasks, parseErrors } = loadTaskDefinitions(paths.taskDir, config.modules.tasks.defaultTimeoutSeconds);
    const runtimeState = loadTaskRuntimeState(paths.stateFile);

    const payload = {
      paths,
      tasks: tasks.map((task) => {
        const runtime = runtimeState[task.key];
        return {
          id: task.id,
          enabled: task.enabled,
          schedule: formatTaskSchedule(task),
          profile: task.profile,
          model: task.modelRef ?? null,
          cwd: task.cwd ?? null,
          timeoutSeconds: task.timeoutSeconds,
          filePath: task.filePath,
          runtime: runtime ?? null,
        };
      }),
      parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Scheduled tasks'));
    console.log(keyValue('Task directory', paths.taskDir));
    console.log(keyValue('Task state file', paths.stateFile));

    if (tasks.length === 0) {
      console.log(dim('No valid task files found.'));
    }

    for (const task of tasks) {
      const runtime = runtimeState[task.key];
      const running = runtime?.running === true;
      const status = running
        ? statusChip('running')
        : runtime?.lastStatus === 'failed'
          ? statusChip('error')
          : runtime?.lastStatus === 'skipped'
            ? statusChip('pending')
            : task.enabled
              ? statusChip('active')
              : statusChip('disabled');

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
      const taskRunDir = join(paths.runsRoot, sanitizeTaskRunDirectoryName(task.id));
      logPath = findLatestTaskLogFile(taskRunDir);
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

async function memoryCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    console.log(section('Memory commands'));
    console.log('');
    console.log(`Usage: pa memory [list|query|search|head|open|status]

Commands:
  list                   List memory collections and files
  query <text>           Semantic search with query expansion + reranking
  search <text>          Full-text keyword search (BM25)
  head [count]           Show latest summarized memories (default: 5)
  open <sessionId>       Open session summary markdown
  status [--json]        Show comprehensive memory status
`);
    return 0;
  }

  if (subcommand === 'list') {
    const result = runQmdCommand(['ls'], 'Loading memory collections');
    console.log(toProcessText(result.stdout || result.stderr));
    return result.status ?? 0;
  }

  if (subcommand === 'query' || subcommand === 'search') {
    const query = rest.join(' ');
    if (!query) {
      throw new Error(`Usage: pa memory ${subcommand} <query>`);
    }

    const result = runQmdCommand([subcommand, query], `Running qmd ${subcommand}`);
    console.log(toProcessText(result.stdout || result.stderr));
    return result.status ?? 0;
  }

  if (subcommand === 'head') {
    if (rest.length > 1) {
      throw new Error('Usage: pa memory head [count]');
    }

    const count = parseMemoryHeadCount(rest[0]);
    const { loadDaemonConfig } = await import('@personal-agent/daemon');
    const config = loadDaemonConfig();
    const summaryDir = config.modules.memory.summaryDir;
    const summaryFiles = listMemorySummaryFiles(summaryDir);

    const recentSummaries = summaryFiles
      .map((path) => {
        try {
          return {
            path,
            mtimeMs: statSync(path).mtimeMs,
          };
        } catch {
          return {
            path,
            mtimeMs: 0,
          };
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, count);

    console.log(section(`Latest memories (${recentSummaries.length})`));
    console.log(keyValue('Summary directory', summaryDir));

    if (recentSummaries.length === 0) {
      console.log(dim('No summarized memories found.'));
      return 0;
    }

    for (const [index, entry] of recentSummaries.entries()) {
      const relativePath = relative(summaryDir, entry.path);
      const modifiedAt = entry.mtimeMs > 0 ? new Date(entry.mtimeMs).toLocaleString() : 'unknown';

      let summaryText = '';
      try {
        summaryText = readFileSync(entry.path, 'utf-8').trim();
      } catch {
        summaryText = '(failed to read summary file)';
      }

      console.log('');
      console.log(`${index + 1}. ${relativePath}`);
      console.log(`   ${dim(`Updated: ${modifiedAt}`)}`);
      console.log(summaryText.length > 0 ? summaryText : dim('(empty summary)'));
    }

    return 0;
  }

  if (subcommand === 'open') {
    const sessionId = rest.find((arg) => !arg.startsWith('-'));
    if (!sessionId) {
      throw new Error('Usage: pa memory open <sessionId>');
    }

    const { loadDaemonConfig } = await import('@personal-agent/daemon');
    const config = loadDaemonConfig();
    const summaryDir = config.modules.memory.summaryDir;

    const summaryPath = findMemoryFileBySessionId(listMemorySummaryFiles(summaryDir), sessionId, '.md');

    if (!summaryPath) {
      throw new Error(`No memory summary found for session: ${sessionId}`);
    }

    const text = readFileSync(summaryPath, 'utf-8').trim();
    console.log(text.length > 0 ? text : dim('(empty memory summary)'));
    return 0;
  }

  if (subcommand === 'status') {
    const jsonMode = hasOption(rest, '--json');
    const qmdResult = runQmdCommand(['status'], 'Reading memory index status', { quiet: jsonMode });

    const { getDaemonStatus, loadDaemonConfig } = await import('@personal-agent/daemon');
    const config = loadDaemonConfig();
    const daemonStatus = await getDaemonStatus(config);
    const memoryModule = daemonStatus.modules.find((m) => m.name === 'memory');
    const detail = memoryModule?.detail as {
      scannedSessions?: number;
      summarizedSessions?: number;
      skippedSessions?: number;
      failedSessions?: number;
      needsEmbedding?: boolean;
      dirty?: boolean;
      lastScanAt?: string;
      lastQmdUpdateAt?: string;
      lastQmdReconcileAt?: string;
      lastQmdEmbedAt?: string;
    } | undefined;

    const sessionDir = config.modules.memory.sessionSource;
    const sessionFiles = existsSync(sessionDir)
      ? spawnSync('find', [sessionDir, '-name', '*.jsonl', '-type', 'f'], { encoding: 'utf-8' }).stdout.split('\n').filter(Boolean)
      : [];

    const summaryDir = config.modules.memory.summaryDir;
    const summaryFiles = listMemorySummaryFiles(summaryDir);
    const skipMarkerFiles = listMemorySkipMarkerFiles(summaryDir);

    const totalSessions = sessionFiles.length;
    const summarized = summaryFiles.length;
    const filtered = skipMarkerFiles.length;
    const processed = Math.min(totalSessions, summarized + filtered);
    const unindexed = Math.max(0, totalSessions - processed);
    const failed = detail?.failedSessions ?? 0;
    const needsEmbedding = Boolean(detail?.needsEmbedding);
    const dirty = Boolean(detail?.dirty);

    const qmdStatusText = toProcessText(qmdResult.stdout || qmdResult.stderr).trim();
    const qmdIndexedFiles = parseQmdIndexedFileCount(qmdStatusText);
    const primaryCollection = config.modules.memory.collections[0]?.name;
    const qmdCollectionCounts = primaryCollection
      ? getQmdCollectionCounts(primaryCollection)
      : undefined;
    const qmdSummaryLag = qmdCollectionCounts
      ? Math.max(0, summarized - qmdCollectionCounts.workspace)
      : 0;

    const statusPayload = {
      sessions: {
        total: totalSessions,
        summarizedOnDisk: summarized,
        filteredLowSignalOnDisk: filtered,
        processedOnDisk: processed,
        unindexed,
        failed,
      },
      index: {
        needsEmbedding,
        dirty,
        lastScanAt: detail?.lastScanAt ?? null,
        lastUpdateAt: detail?.lastQmdUpdateAt ?? null,
        lastReconcileAt: detail?.lastQmdReconcileAt ?? null,
        lastEmbedAt: detail?.lastQmdEmbedAt ?? null,
      },
      qmd: {
        indexedFiles: qmdIndexedFiles ?? null,
        primaryCollection: primaryCollection ?? null,
        indexedCollectionFiles: qmdCollectionCounts?.total ?? null,
        indexedSummaries: qmdCollectionCounts?.workspace ?? null,
        summaryLag: qmdSummaryLag,
      },
      paths: {
        sessionDir,
        summaryDir,
      },
      qmdStatus: qmdStatusText,
    };

    if (jsonMode) {
      console.log(JSON.stringify(statusPayload, null, 2));
      return qmdResult.status ?? 0;
    }

    console.log(section('Memory status'));
    console.log('');
    console.log(section('Sessions'));
    console.log(keyValue('Total session files', totalSessions));
    console.log(keyValue('Summarized (on disk)', summarized));
    console.log(keyValue('Filtered low-signal (on disk)', filtered));
    console.log(keyValue('Coverage', progressBar(processed, totalSessions)));
    console.log(keyValue('Unindexed sessions', unindexed > 0 ? statusChip('pending') + ` (${unindexed})` : statusChip('active') + ' (0)'));
    console.log(keyValue('Failed scans', failed > 0 ? statusChip('error') + ` (${failed})` : statusChip('active') + ' (0)'));
    console.log(keyValue('Summary directory', summaryDir));

    if (qmdCollectionCounts && primaryCollection) {
      console.log(keyValue(`qmd indexed summaries (${primaryCollection})`, qmdCollectionCounts.workspace));
      console.log(keyValue(`qmd indexed files (${primaryCollection})`, qmdCollectionCounts.total));
    } else if (typeof qmdIndexedFiles === 'number') {
      console.log(keyValue('qmd indexed files (all collections)', qmdIndexedFiles));
    }

    if (qmdSummaryLag > 0) {
      console.log(keyValue('qmd lag', `${qmdSummaryLag} summaries pending qmd indexing`));
    }

    console.log('');
    console.log(section('Index status'));
    console.log(keyValue('Needs embedding', needsEmbedding ? statusChip('pending') : statusChip('active')));
    console.log(keyValue('Dirty (pending update)', dirty ? statusChip('pending') : statusChip('active')));
    console.log(keyValue('Last scan', detail?.lastScanAt ? new Date(detail.lastScanAt).toLocaleString() : dim('never')));
    console.log(keyValue('Last qmd update', detail?.lastQmdUpdateAt ? new Date(detail.lastQmdUpdateAt).toLocaleString() : dim('never')));
    console.log(keyValue('Last qmd reconcile', detail?.lastQmdReconcileAt ? new Date(detail.lastQmdReconcileAt).toLocaleString() : dim('never')));
    console.log(keyValue('Last embed', detail?.lastQmdEmbedAt ? new Date(detail.lastQmdEmbedAt).toLocaleString() : dim('never')));

    console.log('');
    console.log(section('qmd status'));
    console.log(qmdStatusText);

    if (qmdSummaryLag > 0) {
      console.log(`  ${formatNextStep('Run qmd update (or wait for daemon qmd update timer)')}`);
    } else if (unindexed > 0 || needsEmbedding || dirty) {
      console.log(`  ${formatNextStep('Wait for daemon indexing or run pa daemon restart')}`);
    }

    return qmdResult.status ?? 0;
  }

  throw new Error(`Unknown memory subcommand: ${subcommand}`);
}

type CommandHandler = (args: string[]) => Promise<number>;

interface CliCommandDefinition {
  name: string;
  description: string;
  usage?: string;
  helpText?: string;
  run: CommandHandler;
}

function normalizeCommandUsage(command: Pick<RegisteredCliCommand, 'name' | 'usage'>): string {
  const usage = command.usage.trim();
  if (usage.startsWith('pa ')) {
    return usage.slice(3);
  }

  if (usage.length > 0) {
    return usage;
  }

  return `${command.name} [args...]`;
}

function buildCommandDefinitions(): CliCommandDefinition[] {
  const definitions: CliCommandDefinition[] = [
    {
      name: 'tui',
      usage: 'tui [args...]',
      description: 'Run pi TUI with configured profile resources',
      run: runCommand,
    },
    {
      name: 'profile',
      usage: 'profile [args...]',
      description: 'Manage profile settings',
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
      usage: 'restart [args...]',
      description: 'Restart daemon and managed gateway services',
      run: restartCommand,
    },
    {
      name: 'update',
      usage: 'update [--repo-only]',
      description: 'Update pi package + pull latest git changes, then restart background services',
      run: updateCommand,
    },
    {
      name: 'daemon',
      usage: 'daemon [status|start|stop|restart|logs|service|help] [args...]',
      description: 'Manage personal-agent daemon',
      helpText: DAEMON_HELP_TEXT,
      run: daemonCommand,
    },
    {
      name: 'tasks',
      usage: 'tasks [list|show|validate|logs] [args...]',
      description: 'Inspect and validate scheduled daemon tasks',
      run: tasksCommand,
    },
    {
      name: 'memory',
      usage: 'memory [list|query|search|head|open|status] [args...]',
      description: 'Query memory conversation summaries',
      run: memoryCommand,
    },
  ];

  registerGatewayCliCommands((command) => {
    if (definitions.some((definition) => definition.name === command.name)) {
      throw new Error(`Cannot register duplicate CLI command: ${command.name}`);
    }

    definitions.push({
      name: command.name,
      usage: normalizeCommandUsage(command),
      description: command.description,
      run: command.run,
    });
  });

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
  pa --plain -p "hello"
  pa tui -- --model kimi-coding/k2p5
  pa profile use datadog
  pa profile list
  pa doctor
  pa doctor --json
  pa restart
  pa update
  pa update --repo-only
  pa gateway telegram start
  pa gateway discord start
  pa gateway service install telegram
  pa daemon
  pa daemon status
  pa daemon service install
  pa tasks list
  pa tasks validate --all
  pa tasks logs <id> --tail 120
  pa memory list
  pa memory head 5
  pa memory open <sessionId>
  pa memory status --json
  pa memory query "authentication flow"
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
      return runCommand(parsedFlags.argv);
    }

    await program.parseAsync(parsedFlags.argv, { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed') {
        return 0;
      }

      console.error(uiError('CLI error', error.message));
      return error.exitCode ?? 1;
    }

    const message = (error as Error).message;
    console.error(uiError('CLI error', message));

    if (message.includes('qmd')) {
      console.error(`  ${formatHint('Install and configure qmd, then rerun the command')}`);
    }

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

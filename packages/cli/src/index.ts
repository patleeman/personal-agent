#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs';
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
  type DaemonStatus,
} from '@personal-agent/daemon';
import { registerGatewayCliCommands, type RegisteredCliCommand } from '@personal-agent/gateway';
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

function ensurePiInstalled(): void {
  const result = spawnSync('pi', ['--version'], { encoding: 'utf-8' });
  if (result.error || result.status !== 0) {
    throw new Error('`pi` command not found. Install with: npm install -g @mariozechner/pi-coding-agent');
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

  const settings = resolvedProfile.settingsFiles.length > 0
    ? mergeJsonFiles(resolvedProfile.settingsFiles)
    : {};

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
    const hint = 'npm install -g @mariozechner/pi-coding-agent';

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
  const cardsDir = resolveCardsDir(config.modules.memory);

  const sessionFiles = existsSync(sessionDir)
    ? spawnSync('find', [sessionDir, '-name', '*.jsonl', '-type', 'f'], { encoding: 'utf-8' }).stdout.split('\n').filter(Boolean)
    : [];

  const summaryFiles = listMemorySummaryFiles(summaryDir);
  const skipMarkerFiles = listMemorySkipMarkerFiles(summaryDir);
  const cardFiles = listMemoryCardFiles(cardsDir);

  const total = sessionFiles.length;
  const summarizedOnDisk = summaryFiles.length;
  const filteredOnDisk = skipMarkerFiles.length;
  const cardsOnDisk = cardFiles.length;
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
  console.log(keyValue('Coverage', `${progressBar(processedOnDisk, total)} (${summarizedOnDisk} summarized, ${filteredOnDisk} filtered, ${cardsOnDisk} cards, ${total} total)`, 4));

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

async function printDaemonModules(modules: DaemonStatus['modules']): Promise<void> {
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
  console.log('');
  console.log(section('Modules'));

  await printDaemonModules(status.modules);
}

async function daemonCommand(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand) {
    await printDaemonStatusHumanReadable();
    return 0;
  }

  if (subcommand === 'status' || subcommand === '--json') {
    if (hasOption(args, '--json')) {
      console.log(await daemonStatusJson());
    } else {
      await printDaemonStatusHumanReadable();
    }

    return 0;
  }

  if (subcommand === 'start') {
    const daemonSpinner = spinner('Starting personal-agentd');
    daemonSpinner.start();
    await startDaemonDetached();
    daemonSpinner.succeed('personal-agentd start requested');
    console.log(`  ${formatNextStep('pa daemon status')}`);
    return 0;
  }

  if (subcommand === 'stop') {
    const daemonSpinner = spinner('Stopping personal-agentd');
    daemonSpinner.start();
    await stopDaemonGracefully();
    daemonSpinner.succeed('personal-agentd stop requested');
    return 0;
  }

  if (subcommand === 'restart') {
    const daemonSpinner = spinner('Restarting personal-agentd');
    daemonSpinner.start();
    await stopDaemonGracefully();
    await startDaemonDetached();
    daemonSpinner.succeed('personal-agentd restart requested');
    console.log(`  ${formatNextStep('pa daemon status')}`);
    return 0;
  }

  if (subcommand === 'logs') {
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

function listMemoryCardFiles(cardsDir: string): string[] {
  if (!existsSync(cardsDir)) {
    return [];
  }

  const result = spawnSync('find', [cardsDir, '-mindepth', '2', '-name', '*.json', '-type', 'f'], { encoding: 'utf-8' });

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

function resolveCardsDir(memoryConfig: {
  summaryDir: string;
  cardsDir?: string;
}): string {
  if (typeof memoryConfig.cardsDir === 'string' && memoryConfig.cardsDir.trim().length > 0) {
    return memoryConfig.cardsDir;
  }

  return join(resolve(memoryConfig.summaryDir), '..', 'cards');
}

function findMemoryFileBySessionId(files: string[], sessionId: string, extension: string): string | undefined {
  const needle = `${sessionId}${extension}`;
  return files.find((path) => path.endsWith(needle));
}

async function memoryCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    console.log(section('Memory commands'));
    console.log('');
    console.log(`Usage: pa memory [list|query|search|head|cards|open|status]

Commands:
  list                   List memory collections and files
  query <text>           Semantic search with query expansion + reranking
  search <text>          Full-text keyword search (BM25)
  head [count]           Show latest summarized memories (default: 5)
  cards head [count]     Show latest memory cards (default: 5)
  open <sessionId>       Open session summary markdown (use --card for card JSON)
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

  if (subcommand === 'cards') {
    const [cardsSubcommand, cardsCountRaw] = rest;

    if (cardsSubcommand && cardsSubcommand !== 'head') {
      throw new Error('Usage: pa memory cards head [count]');
    }

    if (rest.length > 2) {
      throw new Error('Usage: pa memory cards head [count]');
    }

    const count = parseMemoryHeadCount(cardsCountRaw);
    const { loadDaemonConfig } = await import('@personal-agent/daemon');
    const config = loadDaemonConfig();
    const cardsDir = resolveCardsDir(config.modules.memory);
    const cardFiles = listMemoryCardFiles(cardsDir);

    const recentCards = cardFiles
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

    console.log(section(`Latest memory cards (${recentCards.length})`));
    console.log(keyValue('Cards directory', cardsDir));

    if (recentCards.length === 0) {
      console.log(dim('No memory cards found.'));
      return 0;
    }

    for (const [index, entry] of recentCards.entries()) {
      const relativePath = relative(cardsDir, entry.path);
      const modifiedAt = entry.mtimeMs > 0 ? new Date(entry.mtimeMs).toLocaleString() : 'unknown';

      let cardText = '';
      try {
        cardText = readFileSync(entry.path, 'utf-8').trim();
      } catch {
        cardText = '(failed to read card file)';
      }

      console.log('');
      console.log(`${index + 1}. ${relativePath}`);
      console.log(`   ${dim(`Updated: ${modifiedAt}`)}`);
      console.log(cardText.length > 0 ? cardText : dim('(empty card)'));
    }

    return 0;
  }

  if (subcommand === 'open') {
    const sessionId = rest.find((arg) => !arg.startsWith('-'));
    if (!sessionId) {
      throw new Error('Usage: pa memory open <sessionId> [--card]');
    }

    const preferCard = hasOption(rest, '--card');
    const { loadDaemonConfig } = await import('@personal-agent/daemon');
    const config = loadDaemonConfig();
    const summaryDir = config.modules.memory.summaryDir;
    const cardsDir = resolveCardsDir(config.modules.memory);

    const summaryPath = findMemoryFileBySessionId(listMemorySummaryFiles(summaryDir), sessionId, '.md');
    const cardPath = findMemoryFileBySessionId(listMemoryCardFiles(cardsDir), sessionId, '.json');

    const target = preferCard
      ? (cardPath ?? summaryPath)
      : (summaryPath ?? cardPath);

    if (!target) {
      throw new Error(`No memory artifact found for session: ${sessionId}`);
    }

    const text = readFileSync(target, 'utf-8').trim();
    console.log(text.length > 0 ? text : dim('(empty memory artifact)'));
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
    const cardsDir = resolveCardsDir(config.modules.memory);
    const summaryFiles = listMemorySummaryFiles(summaryDir);
    const skipMarkerFiles = listMemorySkipMarkerFiles(summaryDir);
    const cardFiles = listMemoryCardFiles(cardsDir);

    const totalSessions = sessionFiles.length;
    const summarized = summaryFiles.length;
    const filtered = skipMarkerFiles.length;
    const cards = cardFiles.length;
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
        cardsOnDisk: cards,
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
        cardsDir,
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
    console.log(keyValue('Cards (on disk)', cards));
    console.log(keyValue('Coverage', progressBar(processed, totalSessions)));
    console.log(keyValue('Unindexed sessions', unindexed > 0 ? statusChip('pending') + ` (${unindexed})` : statusChip('active') + ' (0)'));
    console.log(keyValue('Failed scans', failed > 0 ? statusChip('error') + ` (${failed})` : statusChip('active') + ' (0)'));
    console.log(keyValue('Summary directory', summaryDir));
    console.log(keyValue('Cards directory', cardsDir));

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
      name: 'daemon',
      usage: 'daemon [args...]',
      description: 'Manage personal-agent daemon',
      run: daemonCommand,
    },
    {
      name: 'memory',
      usage: 'memory [list|query|search|head|cards|open|status] [args...]',
      description: 'Query memory (conversation summaries and cards)',
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
  pa gateway telegram start
  pa gateway discord start
  pa gateway service install telegram
  pa daemon start
  pa daemon status
  pa memory list
  pa memory head 5
  pa memory cards head 5
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
    program
      .command(definition.usage ?? `${definition.name} [args...]`)
      .description(definition.description)
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .action(async (...actionArgs: unknown[]) => {
        const args = normalizeActionArgs(actionArgs);
        setExitCode(await definition.run(args));
      });
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

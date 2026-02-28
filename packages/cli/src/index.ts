#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
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

  console.log(chalk.yellow('⚠ Daemon is not running.'));
  const answer = await promptUser('Would you like to start it? [Y/n] ');

  if (answer === '' || answer === 'y' || answer === 'yes') {
    await startDaemonDetached();
    console.log(chalk.green('✓ Daemon started'));
    // Give daemon a moment to initialize
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function ensureExtensionDependencies(profile: ReturnType<typeof resolveResourceProfile>): void {
  const dependencyDirs = getExtensionDependencyDirs(profile);
  const missingDirs = dependencyDirs.filter((dir) => !existsSync(join(dir, 'node_modules')));

  for (const dir of missingDirs) {
    console.log(`Installing extension dependencies in ${dir} ...`);
    const result = spawnSync('npm', ['install', '--silent', '--no-package-lock'], {
      cwd: dir,
      stdio: 'inherit',
    });

    if (result.error || result.status !== 0) {
      throw new Error(`Failed to install extension dependencies in ${dir}`);
    }
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
    console.log(chalk.yellow('No profiles found under profiles/.'));
    return;
  }

  console.log(chalk.bold('Profiles:'));
  for (const profile of profiles) {
    const isDefault = profile === config.defaultProfile;
    const marker = isDefault ? chalk.green('*') : chalk.dim(' ');
    const name = isDefault ? chalk.green(profile) : profile;
    console.log(` ${marker} ${name}`);
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

function doctorError(label: string, message: string): void {
  console.error(`${chalk.red('✗')} ${chalk.bold(label)}: ${message}`);
}

function doctorOk(label: string, value?: string | number | boolean): void {
  if (value === undefined) {
    console.log(`${chalk.green('✓')} ${chalk.bold(label)}`);
    return;
  }

  console.log(`${chalk.green('✓')} ${chalk.bold(label)}: ${value}`);
}

async function doctor(): Promise<number> {
  const profileName = resolveProfileName();

  try {
    ensurePiInstalled();
  } catch (error) {
    doctorError('pi binary', (error as Error).message);
    return 1;
  }

  const profiles = listProfiles();
  if (profiles.length === 0) {
    doctorError('profiles', 'none found');
    return 1;
  }

  let resolvedProfile: ReturnType<typeof resolveResourceProfile>;
  try {
    resolvedProfile = resolveResourceProfile(profileName);
  } catch (error) {
    doctorError('profile', (error as Error).message);
    return 1;
  }

  const statePaths = resolveStatePaths();

  try {
    validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);
  } catch (error) {
    doctorError('runtime paths', (error as Error).message);
    return 1;
  }

  try {
    await bootstrapStateOrThrow(statePaths);
  } catch (error) {
    doctorError('bootstrap', (error as Error).message);
    return 1;
  }

  const runtime = await preparePiAgentDir({ statePaths, copyLegacyAuth: true });
  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);

  const runtimeAuth = runtime.authFile;
  const legacyAuth = join(homedir(), '.pi', 'agent', 'auth.json');

  doctorOk('pi binary');
  doctorOk('profile', resolvedProfile.name);
  doctorOk('layers', resolvedProfile.layers.map((layer) => layer.name).join(' -> '));
  doctorOk('runtime root', statePaths.root);
  doctorOk('runtime agent dir', runtime.agentDir);
  doctorOk('extensions', resolvedProfile.extensionDirs.length);
  doctorOk('skills', resolvedProfile.skillDirs.length);
  doctorOk('prompts', resolvedProfile.promptDirs.length);
  doctorOk('themes', resolvedProfile.themeDirs.length);
  doctorOk('runtime auth present', existsSync(runtimeAuth));
  doctorOk('legacy auth present', existsSync(legacyAuth));

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
    console.log(`Usage: pa profile [list|show|use]

Manage profile settings

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
    console.log(`${chalk.green('✓')} ${chalk.bold('Default profile set to')}: ${chalk.cyan(value)}`);
    return 0;
  }

  throw new Error(`Unknown profile subcommand: ${subcommand}`);
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function printDaemonModules(modules: DaemonStatus['modules']): void {
  if (modules.length === 0) {
    console.log(`${chalk.bold('modules')}: ${chalk.dim('none')}`);
    return;
  }

  console.log(chalk.bold('modules:'));
  for (const module of modules) {
    const state = module.enabled ? chalk.green('enabled') : chalk.gray('disabled');
    const errorSuffix = module.lastError
      ? `${chalk.red(', error=')}${chalk.red(module.lastError)}`
      : '';

    console.log(`  ${chalk.cyan('•')} ${chalk.bold(module.name)} (${state}, handled=${module.handledEvents}${errorSuffix})`);
  }
}

async function printDaemonStatusHumanReadable(): Promise<void> {
  const config = loadDaemonConfig();
  const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
  const running = await pingDaemon(config);

  if (!running) {
    console.log(`${chalk.yellow('◉')} ${chalk.bold('personal-agentd')}: ${chalk.red('stopped')}`);
    console.log(`${chalk.dim('socket')}: ${daemonPaths.socketPath}`);
    console.log(`${chalk.dim('log')}: ${daemonPaths.logFile}`);
    console.log(`${chalk.blue('hint')}: ${chalk.cyan('pa daemon start')}`);
    return;
  }

  const status = await getDaemonStatus(config);

  console.log(`${chalk.green('◉')} ${chalk.bold('personal-agentd')}: ${chalk.green('running')}`);
  console.log(`${chalk.dim('pid')}: ${status.pid}`);
  console.log(`${chalk.dim('started')}: ${formatTimestamp(status.startedAt)}`);
  console.log(`${chalk.dim('socket')}: ${status.socketPath}`);
  console.log(`${chalk.dim('log')}: ${daemonPaths.logFile}`);
  console.log(
    `${chalk.bold('queue')}: ${status.queue.currentDepth} pending, ` +
    `${status.queue.processedEvents} processed, ${status.queue.droppedEvents} dropped`,
  );

  printDaemonModules(status.modules);
}

async function daemonCommand(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand) {
    console.log(`Usage: pa daemon [status|start|stop|restart|logs]

Manage personal-agent daemon

Commands:
  status [--json]  Show daemon status (optionally as JSON)
  start            Start the daemon
  stop             Stop the daemon
  restart          Restart the daemon
  logs             Show log file location
`);
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
    await startDaemonDetached();
    console.log(`${chalk.green('✓')} ${chalk.bold('personal-agentd')} start requested`);
    return 0;
  }

  if (subcommand === 'stop') {
    await stopDaemonGracefully();
    console.log(`${chalk.green('✓')} ${chalk.bold('personal-agentd')} stop requested`);
    return 0;
  }

  if (subcommand === 'restart') {
    await stopDaemonGracefully();
    await startDaemonDetached();
    console.log(`${chalk.green('✓')} ${chalk.bold('personal-agentd')} restart requested`);
    return 0;
  }

  if (subcommand === 'logs') {
    const config = loadDaemonConfig();
    const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
    const pid = await readDaemonPid();
    console.log(`${chalk.bold('log file')}: ${daemonPaths.logFile}`);
    console.log(`${chalk.bold('pid')}: ${pid ?? chalk.dim('unknown')}`);
    return 0;
  }

  throw new Error(`Unknown daemon subcommand: ${subcommand}`);
}

async function memoryCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    console.log(`Usage: pa memory [list|query|search|status]

Query memory (conversation summaries)

Commands:
  list              List memory collections and files
  query <text>      Semantic search with query expansion + reranking
  search <text>     Full-text keyword search (BM25)
  status            Show comprehensive memory status
`);
    return 0;
  }

  if (subcommand === 'list') {
    const result = spawnSync('qmd', ['ls'], { encoding: 'utf-8' });
    if (result.error) {
      throw new Error('Failed to run qmd. Is it installed?');
    }
    console.log(result.stdout || result.stderr);
    return result.status ?? 0;
  }

  if (subcommand === 'query' || subcommand === 'search') {
    const query = rest.join(' ');
    if (!query) {
      throw new Error(`Usage: pa memory ${subcommand} <query>`);
    }
    const result = spawnSync('qmd', [subcommand, query], { encoding: 'utf-8' });
    if (result.error) {
      throw new Error('Failed to run qmd. Is it installed?');
    }
    console.log(result.stdout || result.stderr);
    return result.status ?? 0;
  }

  if (subcommand === 'status') {
    // Get qmd status
    const qmdResult = spawnSync('qmd', ['status'], { encoding: 'utf-8' });
    if (qmdResult.error) {
      throw new Error('Failed to run qmd. Is it installed?');
    }

    // Get daemon memory module status
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
      lastQmdEmbedAt?: string;
    } | undefined;

    // Count actual session files
    const sessionDir = config.modules.memory.sessionSource;
    const sessionFiles = existsSync(sessionDir) 
      ? spawnSync('find', [sessionDir, '-name', '*.jsonl', '-type', 'f'], { encoding: 'utf-8' }).stdout.split('\n').filter(Boolean)
      : [];

    // Count summary files  
    const summaryDir = config.modules.memory.summaryDir;
    const summaryFiles = existsSync(summaryDir)
      ? spawnSync('find', [summaryDir, '-name', '*.md', '-type', 'f'], { encoding: 'utf-8' }).stdout.split('\n').filter(Boolean)
      : [];

    // Calculate unindexed
    const totalSessions = sessionFiles.length;
    const summarized = detail?.summarizedSessions ?? summaryFiles.length;
    const unindexed = Math.max(0, totalSessions - summarized);

    console.log(chalk.bold('Memory Status'));
    console.log('');

    console.log(chalk.bold('Sessions:'));
    console.log(`  Total session files: ${totalSessions}`);
    console.log(`  Summarized: ${summarized}`);
    console.log(`  Unindexed (not yet summarized): ${unindexed > 0 ? chalk.yellow(unindexed) : chalk.green(unindexed)}`);
    console.log(`  Failed: ${detail?.failedSessions ?? 0}`);
    console.log('');

    console.log(chalk.bold('Index Status:'));
    console.log(`  Needs embedding: ${detail?.needsEmbedding ? chalk.yellow('yes') : chalk.green('no')}`);
    console.log(`  Dirty (pending update): ${detail?.dirty ? chalk.yellow('yes') : chalk.green('no')}`);
    console.log(`  Last scan: ${detail?.lastScanAt ? new Date(detail.lastScanAt).toLocaleString() : chalk.dim('never')}`);
    console.log(`  Last embed: ${detail?.lastQmdEmbedAt ? new Date(detail.lastQmdEmbedAt).toLocaleString() : chalk.dim('never')}`);
    console.log('');

    console.log(chalk.bold('qmd Status:'));
    console.log(qmdResult.stdout || qmdResult.stderr);

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
      name: 'run',
      usage: 'run [args...]',
      description: 'Run pi with configured profile resources',
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

        return doctor();
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
      usage: 'memory [list|query|search|status] [args...]',
      description: 'Query memory (conversation summaries)',
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

function normalizeActionArgs(values: unknown[]): string[] {
  if (values.length === 0) {
    return [];
  }

  const positionalValues = values.slice(0, -1);

  if (positionalValues.length === 1 && Array.isArray(positionalValues[0])) {
    return positionalValues[0].map((entry) => String(entry));
  }

  return positionalValues
    .filter((entry) => entry !== undefined)
    .map((entry) => String(entry));
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
Examples:
  pa
  pa -p "hello"
  pa run -- --model kimi-coding/k2p5
  pa profile use datadog
  pa profile list
  pa doctor
  pa gateway telegram start
  pa gateway discord start
  pa daemon start
  pa daemon status
  pa memory list
  pa memory query "authentication flow"
`,
    )
    .configureOutput({
      outputError: (message, write) => {
        write(chalk.red(message));
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
  try {
    const definitions = buildCommandDefinitions();
    const knownCommands = new Set(definitions.map((definition) => definition.name));

    let exitCode = 0;
    const program = createProgram(definitions, (code) => {
      exitCode = code;
    });

    if (argv.length === 0) {
      await program.parseAsync(['--help'], { from: 'user' });
      return 0;
    }

    const firstArg = argv[0];
    const isHelpRequest = firstArg === '--help' || firstArg === '-h' || firstArg === 'help';

    if (!isHelpRequest && !knownCommands.has(firstArg)) {
      return runCommand(argv);
    }

    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed') {
        return 0;
      }

      console.error(chalk.red(error.message));
      return error.exitCode ?? 1;
    }

    console.error(chalk.red((error as Error).message));
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

#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
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
import { extractProfileFlag, hasOption, parseCommand } from './args.js';
import { readConfig, setDefaultProfile } from './config.js';

function printHelp(): void {
  console.log(`personal-agent

Commands:
  personal-agent run [--profile <name>] [pi args...]  Run pi with personal-agent profile resources
  personal-agent profile list                          List available profiles
  personal-agent profile show [name]                  Show resolved profile details
  personal-agent profile use <name>                   Set default profile
  personal-agent doctor [--profile <name>]            Validate local setup

Examples:
  personal-agent run
  personal-agent run --profile datadog
  personal-agent run --profile shared -- --model kimi-coding/k2p5
  personal-agent profile list
  personal-agent profile use datadog
  personal-agent doctor
`);
}

function ensurePiInstalled(): void {
  const result = spawnSync('pi', ['--version'], { encoding: 'utf-8' });
  if (result.error || result.status !== 0) {
    throw new Error('`pi` command not found. Install with: npm install -g @mariozechner/pi-coding-agent');
  }
}

function ensureExtensionDependencies(profile: ReturnType<typeof resolveResourceProfile>): void {
  if (process.env.PERSONAL_AGENT_SKIP_EXTENSION_INSTALL === '1') {
    return;
  }

  const dependencyDirs = getExtensionDependencyDirs(profile);
  const missingDirs = dependencyDirs.filter((dir) => !existsSync(join(dir, 'node_modules')));

  if (missingDirs.length === 0) {
    return;
  }

  const allowAutoInstall = process.env.PERSONAL_AGENT_INSTALL_EXTENSION_DEPS === '1';

  if (!allowAutoInstall) {
    throw new Error(
      `Extension dependencies are missing in: ${missingDirs.join(', ')}. ` +
      `Install them manually (trusted profiles only), or set PERSONAL_AGENT_INSTALL_EXTENSION_DEPS=1 to auto-install.`
    );
  }

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

function resolveProfileName(explicitProfile?: string): string {
  if (explicitProfile) {
    return explicitProfile;
  }

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

async function runPi(profileName: string, piArgs: string[]): Promise<number> {
  const resolvedProfile = resolveResourceProfile(profileName);
  const statePaths = resolveStatePaths();

  validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);

  ensurePiInstalled();

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

  return result.status ?? 1;
}

function printProfileList(): void {
  const profiles = listProfiles();
  const config = readConfig();

  if (profiles.length === 0) {
    console.log('No profiles found under profiles/.');
    return;
  }

  console.log('Profiles:');
  for (const profile of profiles) {
    const marker = profile === config.defaultProfile ? '*' : ' ';
    console.log(` ${marker} ${profile}`);
  }
}

function showProfile(name?: string): void {
  const profileName = resolveProfileName(name);
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

async function doctor(explicitProfile?: string): Promise<number> {
  const profileName = resolveProfileName(explicitProfile);

  try {
    ensurePiInstalled();
  } catch (error) {
    console.error(`✗ pi binary: ${(error as Error).message}`);
    return 1;
  }

  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.error('✗ profiles: none found');
    return 1;
  }

  let resolvedProfile: ReturnType<typeof resolveResourceProfile>;
  try {
    resolvedProfile = resolveResourceProfile(profileName);
  } catch (error) {
    console.error(`✗ profile: ${(error as Error).message}`);
    return 1;
  }

  const statePaths = resolveStatePaths();

  try {
    validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);
  } catch (error) {
    console.error(`✗ runtime paths: ${(error as Error).message}`);
    return 1;
  }

  try {
    await bootstrapStateOrThrow(statePaths);
  } catch (error) {
    console.error(`✗ bootstrap: ${(error as Error).message}`);
    return 1;
  }

  const runtime = await preparePiAgentDir({ statePaths, copyLegacyAuth: true });
  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);

  const runtimeAuth = runtime.authFile;
  const legacyAuth = join(homedir(), '.pi', 'agent', 'auth.json');

  console.log('✓ pi binary');
  console.log(`✓ profile: ${resolvedProfile.name}`);
  console.log(`✓ layers: ${resolvedProfile.layers.map((layer) => layer.name).join(' -> ')}`);
  console.log(`✓ runtime root: ${statePaths.root}`);
  console.log(`✓ runtime agent dir: ${runtime.agentDir}`);
  console.log(`✓ extensions: ${resolvedProfile.extensionDirs.length}`);
  console.log(`✓ skills: ${resolvedProfile.skillDirs.length}`);
  console.log(`✓ prompts: ${resolvedProfile.promptDirs.length}`);
  console.log(`✓ themes: ${resolvedProfile.themeDirs.length}`);
  console.log(`✓ runtime auth present: ${existsSync(runtimeAuth)}`);
  console.log(`✓ legacy auth present: ${existsSync(legacyAuth)}`);

  return 0;
}

async function runCommand(args: string[]): Promise<number> {
  if (hasOption(args, '--help') || hasOption(args, '-h')) {
    printHelp();
    return 0;
  }

  const profileFlag = extractProfileFlag(args);
  const profileName = resolveProfileName(profileFlag.profile);
  const passthroughArgs = profileFlag.remainingArgs[0] === '--'
    ? profileFlag.remainingArgs.slice(1)
    : profileFlag.remainingArgs;

  return runPi(profileName, passthroughArgs);
}

async function profileCommand(args: string[]): Promise<number> {
  const [subcommand, value] = args;

  if (!subcommand || subcommand === 'list') {
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
    console.log(`Default profile set to: ${value}`);
    return 0;
  }

  throw new Error(`Unknown profile subcommand: ${subcommand}`);
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseCommand(argv);

    if (parsed.command === 'help') {
      printHelp();
      return 0;
    }

    if (parsed.command === 'run') {
      return await runCommand(parsed.args);
    }

    if (parsed.command === 'profile') {
      return await profileCommand(parsed.args);
    }

    if (parsed.command === 'doctor') {
      const profileFlag = extractProfileFlag(parsed.args);
      return await doctor(profileFlag.profile);
    }

    printHelp();
    return 1;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

const entryFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
const moduleFile = resolve(fileURLToPath(import.meta.url));

if (entryFile === moduleFile) {
  runCli().then((code) => {
    process.exit(code);
  });
}

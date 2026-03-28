import {
  deleteExecutionTarget,
  getExecutionTarget,
  listExecutionTargets,
  resolveExecutionTargetsFilePath,
  saveExecutionTarget,
  type ExecutionTargetPathMapping,
  type ExecutionTargetRecord,
  type SaveExecutionTargetInput,
} from '@personal-agent/core';
import { ensureRemoteTargetInstall } from './remote-target-install.js';
import { bullet, dim, keyValue, printDenseCommandList, printDenseUsage, section, success } from './ui.js';

function targetsUsageText(): string {
  return 'Usage: pa targets [list|show|add|update|install|delete|help] [args...]';
}

function targetsListUsageText(): string {
  return 'Usage: pa targets list [--json]';
}

function targetsShowUsageText(): string {
  return 'Usage: pa targets show <id> [--json]';
}

function targetsAddUsageText(): string {
  return 'Usage: pa targets add <id> --label <label> --ssh <destination> [--description <text>] [--ssh-command <command>] [--remote-pa-command <command>] [--profile <profile>] [--default-cwd <path>] [--command-prefix <command>] [--map <local=>remote>]... [--json]';
}

function targetsUpdateUsageText(): string {
  return 'Usage: pa targets update <id> [--label <label>] [--ssh <destination>] [--description <text>] [--ssh-command <command>] [--remote-pa-command <command>] [--profile <profile>] [--default-cwd <path>] [--command-prefix <command>] [--map <local=>remote>]... [--json]';
}

function targetsInstallUsageText(): string {
  return 'Usage: pa targets install <id> [--force] [--json]';
}

function targetsDeleteUsageText(): string {
  return 'Usage: pa targets delete <id> [--json]';
}

function isTargetsHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function readOptionValue(args: string[], index: number, usage: string): { value: string; nextIndex: number } {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(usage);
  }

  return { value, nextIndex: index + 1 };
}

function parseMapSpec(spec: string, usage: string): ExecutionTargetPathMapping {
  const [localPrefix, remotePrefix, ...rest] = spec.split(/=>|=/).map((part) => part.trim());
  if (!localPrefix || !remotePrefix || rest.length > 0) {
    throw new Error(usage);
  }

  return { localPrefix, remotePrefix };
}

function formatMappings(mappings: ExecutionTargetPathMapping[]): string {
  if (mappings.length === 0) {
    return 'none';
  }

  return mappings.map((mapping) => `${mapping.localPrefix} => ${mapping.remotePrefix}`).join(', ');
}

function printTarget(target: ExecutionTargetRecord): void {
  console.log(bullet(`${target.id}: ${target.label}`));
  console.log(keyValue('Transport', target.transport, 4));
  console.log(keyValue('SSH destination', target.sshDestination, 4));
  if (target.description) console.log(keyValue('Description', target.description, 4));
  if (target.defaultRemoteCwd) console.log(keyValue('Default cwd', target.defaultRemoteCwd, 4));
  if (target.profile) console.log(keyValue('Profile', target.profile, 4));
  if (target.remotePaCommand) console.log(keyValue('Remote pa', target.remotePaCommand, 4));
  if (target.sshCommand) console.log(keyValue('SSH command', target.sshCommand, 4));
  if (target.commandPrefix) console.log(keyValue('Command prefix', target.commandPrefix, 4));
  console.log(keyValue('Mappings', formatMappings(target.cwdMappings), 4));
  console.log(keyValue('Created', target.createdAt, 4));
  console.log(keyValue('Updated', target.updatedAt, 4));
}

function printTargetsHelp(): void {
  console.log('Execution targets commands');
  console.log('');
  printDenseUsage('pa targets [list|show|add|update|install|delete|help]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'list [--json]', description: 'List configured execution targets' },
    { usage: 'show <id> [--json]', description: 'Show one configured execution target' },
    { usage: 'add <id> --label <label> --ssh <destination> [--description <text>] [--ssh-command <command>] [--remote-pa-command <command>] [--profile <profile>] [--default-cwd <path>] [--command-prefix <command>] [--map <local=>remote>]... [--json]', description: 'Create a new execution target in machine-local config' },
    { usage: 'update <id> [--label <label>] [--ssh <destination>] [--description <text>] [--ssh-command <command>] [--remote-pa-command <command>] [--profile <profile>] [--default-cwd <path>] [--command-prefix <command>] [--map <local=>remote>]... [--json]', description: 'Update an existing execution target' },
    { usage: 'install <id> [--force] [--json]', description: 'Upload or refresh the remote personal-agent runtime bundle and synced state for one target' },
    { usage: 'delete <id> [--json]', description: 'Delete one execution target' },
    { usage: 'help', description: 'Show execution target help' },
  ]);
}

interface ParsedMutationOptions {
  jsonMode: boolean;
  providedFields: Set<keyof SaveExecutionTargetInput>;
  values: Partial<SaveExecutionTargetInput>;
}

function parseMutationOptions(args: string[], usage: string): ParsedMutationOptions {
  let jsonMode = false;
  const providedFields = new Set<keyof SaveExecutionTargetInput>();
  const values: Partial<SaveExecutionTargetInput> = {};
  const mappings: ExecutionTargetPathMapping[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    if (arg === '--label') {
      const next = readOptionValue(args, index, usage);
      values.label = next.value.trim();
      providedFields.add('label');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--label=')) {
      values.label = arg.slice('--label='.length).trim();
      providedFields.add('label');
      continue;
    }

    if (arg === '--ssh') {
      const next = readOptionValue(args, index, usage);
      values.sshDestination = next.value.trim();
      providedFields.add('sshDestination');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--ssh=')) {
      values.sshDestination = arg.slice('--ssh='.length).trim();
      providedFields.add('sshDestination');
      continue;
    }

    if (arg === '--description') {
      const next = readOptionValue(args, index, usage);
      values.description = next.value.trim();
      providedFields.add('description');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--description=')) {
      values.description = arg.slice('--description='.length).trim();
      providedFields.add('description');
      continue;
    }

    if (arg === '--ssh-command') {
      const next = readOptionValue(args, index, usage);
      values.sshCommand = next.value.trim();
      providedFields.add('sshCommand');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--ssh-command=')) {
      values.sshCommand = arg.slice('--ssh-command='.length).trim();
      providedFields.add('sshCommand');
      continue;
    }

    if (arg === '--remote-pa-command') {
      const next = readOptionValue(args, index, usage);
      values.remotePaCommand = next.value.trim();
      providedFields.add('remotePaCommand');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--remote-pa-command=')) {
      values.remotePaCommand = arg.slice('--remote-pa-command='.length).trim();
      providedFields.add('remotePaCommand');
      continue;
    }

    if (arg === '--profile') {
      const next = readOptionValue(args, index, usage);
      values.profile = next.value.trim();
      providedFields.add('profile');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      values.profile = arg.slice('--profile='.length).trim();
      providedFields.add('profile');
      continue;
    }

    if (arg === '--default-cwd') {
      const next = readOptionValue(args, index, usage);
      values.defaultRemoteCwd = next.value.trim();
      providedFields.add('defaultRemoteCwd');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--default-cwd=')) {
      values.defaultRemoteCwd = arg.slice('--default-cwd='.length).trim();
      providedFields.add('defaultRemoteCwd');
      continue;
    }

    if (arg === '--command-prefix') {
      const next = readOptionValue(args, index, usage);
      values.commandPrefix = next.value.trim();
      providedFields.add('commandPrefix');
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--command-prefix=')) {
      values.commandPrefix = arg.slice('--command-prefix='.length).trim();
      providedFields.add('commandPrefix');
      continue;
    }

    if (arg === '--map') {
      const next = readOptionValue(args, index, usage);
      mappings.push(parseMapSpec(next.value, usage));
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--map=')) {
      mappings.push(parseMapSpec(arg.slice('--map='.length), usage));
      continue;
    }

    throw new Error(usage);
  }

  if (mappings.length > 0) {
    values.cwdMappings = mappings;
    providedFields.add('cwdMappings');
  }

  return {
    jsonMode,
    providedFields,
    values,
  };
}

export async function targetsCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    printTargetsHelp();
    return 0;
  }

  if (isTargetsHelpToken(subcommand)) {
    if (rest.length > 0) {
      throw new Error(targetsUsageText());
    }

    printTargetsHelp();
    return 0;
  }

  if (subcommand === 'list') {
    let jsonMode = false;

    for (const arg of rest) {
      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      throw new Error(targetsListUsageText());
    }

    const targets = listExecutionTargets();
    const payload = {
      configFile: resolveExecutionTargetsFilePath(),
      targets,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section('Execution targets'));
    console.log(keyValue('Config file', payload.configFile));

    if (targets.length === 0) {
      console.log(dim('No execution targets configured.'));
      return 0;
    }

    for (const target of targets) {
      console.log('');
      printTarget(target);
    }

    return 0;
  }

  if (subcommand === 'show') {
    const [targetId, ...optionArgs] = rest;
    const jsonMode = optionArgs.includes('--json');
    const unknownOptions = optionArgs.filter((arg) => arg.startsWith('--') && arg !== '--json');

    if (!targetId || targetId.startsWith('-') || unknownOptions.length > 0) {
      throw new Error(targetsShowUsageText());
    }

    const target = getExecutionTarget({ targetId });
    if (!target) {
      throw new Error(`Execution target not found: ${targetId}`);
    }

    if (jsonMode) {
      console.log(JSON.stringify({ configFile: resolveExecutionTargetsFilePath(), target }, null, 2));
      return 0;
    }

    console.log(section(`Execution target: ${target.id}`));
    console.log(keyValue('Config file', resolveExecutionTargetsFilePath()));
    console.log('');
    printTarget(target);
    return 0;
  }

  if (subcommand === 'add') {
    const [targetId, ...optionArgs] = rest;
    if (!targetId || targetId.startsWith('-')) {
      throw new Error(targetsAddUsageText());
    }

    const options = parseMutationOptions(optionArgs, targetsAddUsageText());
    const label = options.values.label?.trim();
    const sshDestination = options.values.sshDestination?.trim();
    if (!label || !sshDestination) {
      throw new Error(targetsAddUsageText());
    }

    const target = saveExecutionTarget({
      target: {
        id: targetId,
        label,
        sshDestination,
        ...(options.values.description ? { description: options.values.description } : {}),
        ...(options.values.sshCommand ? { sshCommand: options.values.sshCommand } : {}),
        ...(options.values.remotePaCommand ? { remotePaCommand: options.values.remotePaCommand } : {}),
        ...(options.values.profile ? { profile: options.values.profile } : {}),
        ...(options.values.defaultRemoteCwd ? { defaultRemoteCwd: options.values.defaultRemoteCwd } : {}),
        ...(options.values.commandPrefix ? { commandPrefix: options.values.commandPrefix } : {}),
        ...(options.values.cwdMappings ? { cwdMappings: options.values.cwdMappings } : {}),
      },
    });

    if (options.jsonMode) {
      console.log(JSON.stringify({ configFile: resolveExecutionTargetsFilePath(), target }, null, 2));
      return 0;
    }

    console.log(success('Saved execution target', `${target.id} → ${target.label}`));
    console.log(keyValue('Config file', resolveExecutionTargetsFilePath()));
    return 0;
  }

  if (subcommand === 'update') {
    const [targetId, ...optionArgs] = rest;
    if (!targetId || targetId.startsWith('-')) {
      throw new Error(targetsUpdateUsageText());
    }

    const existing = getExecutionTarget({ targetId });
    if (!existing) {
      throw new Error(`Execution target not found: ${targetId}`);
    }

    const options = parseMutationOptions(optionArgs, targetsUpdateUsageText());
    if (options.providedFields.size === 0) {
      throw new Error(targetsUpdateUsageText());
    }

    const target = saveExecutionTarget({
      target: {
        id: targetId,
        label: options.values.label ?? existing.label,
        sshDestination: options.values.sshDestination ?? existing.sshDestination,
        description: options.providedFields.has('description') ? options.values.description : existing.description,
        sshCommand: options.providedFields.has('sshCommand') ? options.values.sshCommand : existing.sshCommand,
        remotePaCommand: options.providedFields.has('remotePaCommand') ? options.values.remotePaCommand : existing.remotePaCommand,
        profile: options.providedFields.has('profile') ? options.values.profile : existing.profile,
        defaultRemoteCwd: options.providedFields.has('defaultRemoteCwd') ? options.values.defaultRemoteCwd : existing.defaultRemoteCwd,
        commandPrefix: options.providedFields.has('commandPrefix') ? options.values.commandPrefix : existing.commandPrefix,
        cwdMappings: options.providedFields.has('cwdMappings') ? (options.values.cwdMappings ?? []) : existing.cwdMappings,
      },
    });

    if (options.jsonMode) {
      console.log(JSON.stringify({ configFile: resolveExecutionTargetsFilePath(), target }, null, 2));
      return 0;
    }

    console.log(success('Updated execution target', `${target.id} → ${target.label}`));
    console.log(keyValue('Config file', resolveExecutionTargetsFilePath()));
    return 0;
  }

  if (subcommand === 'install') {
    const [targetId, ...optionArgs] = rest;
    const jsonMode = optionArgs.includes('--json');
    const force = optionArgs.includes('--force');
    const unknownOptions = optionArgs.filter((arg) => arg.startsWith('--') && arg !== '--json' && arg !== '--force');

    if (!targetId || targetId.startsWith('-') || unknownOptions.length > 0) {
      throw new Error(targetsInstallUsageText());
    }

    const result = await ensureRemoteTargetInstall({ targetId, force });

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    console.log(success('Installed remote target runtime', `${result.targetId} → ${result.targetLabel}`));
    console.log(keyValue('SSH destination', result.sshDestination));
    console.log(keyValue('Remote home', result.remoteHome));
    console.log(keyValue('Install root', result.installRoot));
    console.log(keyValue('State root', result.stateRoot));
    console.log(keyValue('Launcher', result.launcherPath));
    console.log(keyValue('Node', result.nodeVersion));
    console.log(keyValue('Runtime updated', result.runtimeChanged ? 'yes' : 'no'));
    console.log(keyValue('State synced', result.stateChanged ? 'yes' : 'no'));
    return 0;
  }

  if (subcommand === 'delete') {
    const [targetId, ...optionArgs] = rest;
    const jsonMode = optionArgs.includes('--json');
    const unknownOptions = optionArgs.filter((arg) => arg.startsWith('--') && arg !== '--json');

    if (!targetId || targetId.startsWith('-') || unknownOptions.length > 0) {
      throw new Error(targetsDeleteUsageText());
    }

    const deleted = deleteExecutionTarget({ targetId });
    if (!deleted) {
      throw new Error(`Execution target not found: ${targetId}`);
    }

    if (jsonMode) {
      console.log(JSON.stringify({ configFile: resolveExecutionTargetsFilePath(), deleted: targetId }, null, 2));
      return 0;
    }

    console.log(success('Deleted execution target', targetId));
    console.log(keyValue('Config file', resolveExecutionTargetsFilePath()));
    return 0;
  }

  throw new Error(targetsUsageText());
}

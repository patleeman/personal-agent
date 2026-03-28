import { existsSync } from 'fs';
import {
  cancelDurableRun,
  pingDaemon,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
  scanDurableRun,
  scanDurableRunsForRecovery,
  startBackgroundRun,
  startDaemonDetached,
  summarizeScannedDurableRuns,
  type DurableRunStatus,
} from '@personal-agent/daemon';
import { readTailLines } from './file-utils.js';
import { bullet, dim, keyValue, printDenseCommandList, printDenseUsage, section, statusChip } from './ui.js';

function runsUsageText(): string {
  return 'Usage: pa runs [list|show|logs|start|start-agent|cancel|help] [args...]';
}

function runsListUsageText(): string {
  return 'Usage: pa runs list [--json]';
}

function runsShowUsageText(): string {
  return 'Usage: pa runs show <id> [--json]';
}

function runsLogsUsageText(): string {
  return 'Usage: pa runs logs <id> [--tail <count>]';
}

function runsStartUsageText(): string {
  return 'Usage: pa runs start <task-slug> [--cwd <path>] [--] <command...>';
}

function runsStartAgentUsageText(): string {
  return 'Usage: pa runs start-agent <task-slug> [--cwd <path>] --prompt <text> [--profile <name>] [--model <ref>]';
}

function runsCancelUsageText(): string {
  return 'Usage: pa runs cancel <id>';
}

function parseTailCount(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(runsLogsUsageText());
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(runsLogsUsageText());
  }

  return Math.min(1000, parsed);
}

function toRunsRoot(): string {
  return resolveDurableRunsRoot(resolveDaemonPaths().root);
}

function formatRunStatus(status: DurableRunStatus | undefined): string {
  if (!status) {
    return dim('unknown');
  }

  if (status === 'queued' || status === 'waiting') {
    return statusChip('pending');
  }

  if (status === 'running' || status === 'recovering') {
    return statusChip('running');
  }

  if (status === 'completed') {
    return statusChip('completed');
  }

  if (status === 'cancelled') {
    return statusChip('stopped');
  }

  return statusChip('error');
}

async function ensureDaemonAvailable(): Promise<void> {
  if (await pingDaemon()) {
    return;
  }

  await startDaemonDetached();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await pingDaemon()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Daemon did not become available. Start it with: pa daemon start');
}

function readBackgroundRunSource(taskSlug: string): { type: string; id?: string; filePath?: string } {
  const conversationId = process.env.PERSONAL_AGENT_SOURCE_CONVERSATION_ID?.trim();
  const sessionFile = process.env.PERSONAL_AGENT_SOURCE_SESSION_FILE?.trim();

  if (conversationId) {
    return {
      type: 'tool',
      id: conversationId,
      ...(sessionFile ? { filePath: sessionFile } : {}),
    };
  }

  return {
    type: 'cli',
    id: taskSlug,
  };
}

function printRunsHelp(): void {
  console.log('Runs');
  console.log('');
  printDenseUsage('pa runs [list|show|logs|start|cancel|help] [args...]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'list [--json]', description: 'List durable daemon-backed runs with recovery status' },
    { usage: 'show <id> [--json]', description: 'Show one durable run record and recovery metadata' },
    { usage: 'logs <id> [--tail <n>]', description: 'Show run output log (default: 80 lines)' },
    { usage: 'start <task-slug> [--cwd <path>] [--] <command...>', description: 'Start a durable shell/background run' },
    { usage: 'start-agent <task-slug> [--cwd <path>] --prompt <text> [--profile <name>] [--model <ref>]', description: 'Start a durable background agent run' },
    { usage: 'cancel <id>', description: 'Cancel one durable background run' },
    { usage: 'help', description: 'Show runs help' },
  ]);
}

export async function runsCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  const runsRoot = toRunsRoot();

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    if (subcommand && rest.length > 0) {
      throw new Error(runsUsageText());
    }

    printRunsHelp();
    return 0;
  }

  if (subcommand === 'list') {
    const jsonMode = rest.includes('--json');
    const positional = rest.filter((arg) => !arg.startsWith('--'));
    const unknownOptions = rest.filter((arg) => arg.startsWith('--') && arg !== '--json');

    if (positional.length > 0 || unknownOptions.length > 0) {
      throw new Error(runsListUsageText());
    }

    const scannedAt = new Date().toISOString();
    const runs = scanDurableRunsForRecovery(runsRoot);
    const summary = summarizeScannedDurableRuns(runs);
    const payload = {
      scannedAt,
      runsRoot,
      summary,
      runs,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return summary.recoveryActions.invalid > 0 ? 1 : 0;
    }

    console.log(section('Durable runs'));
    console.log(keyValue('Runs root', runsRoot));
    console.log(keyValue('Total', summary.total));

    if (runs.length === 0) {
      console.log(dim('No durable runs found.'));
      return 0;
    }

    for (const run of runs) {
      console.log('');
      console.log(bullet(`${run.runId}: ${formatRunStatus(run.status?.status)}`));
      console.log(keyValue('Kind', run.manifest?.kind ?? dim('unknown'), 4));
      console.log(keyValue('Recovery', run.recoveryAction, 4));
      console.log(keyValue('Resume policy', run.manifest?.resumePolicy ?? dim('unknown'), 4));
      console.log(keyValue('Source', run.manifest?.source?.type ?? dim('unknown'), 4));
      if (run.status?.updatedAt) {
        console.log(keyValue('Updated', new Date(run.status.updatedAt).toLocaleString(), 4));
      }
      if (run.problems.length > 0) {
        console.log(keyValue('Problems', run.problems.join('; '), 4));
      }
    }

    return summary.recoveryActions.invalid > 0 ? 1 : 0;
  }

  if (subcommand === 'show') {
    const jsonMode = rest.includes('--json');
    const positional = rest.filter((arg) => !arg.startsWith('--'));
    const unknownOptions = rest.filter((arg) => arg.startsWith('--') && arg !== '--json');

    if (positional.length !== 1 || unknownOptions.length > 0) {
      throw new Error(runsShowUsageText());
    }

    const runId = positional[0] as string;
    const run = scanDurableRun(runsRoot, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const payload = {
      scannedAt: new Date().toISOString(),
      runsRoot,
      run,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return run.recoveryAction === 'invalid' ? 1 : 0;
    }

    console.log(section(`Run: ${run.runId}`));
    console.log(keyValue('Status', run.status?.status ?? dim('unknown')));
    console.log(keyValue('Recovery action', run.recoveryAction));
    console.log(keyValue('Kind', run.manifest?.kind ?? dim('unknown')));
    console.log(keyValue('Resume policy', run.manifest?.resumePolicy ?? dim('unknown')));
    console.log(keyValue('Runs root', runsRoot));
    console.log(keyValue('Run root', run.paths.root));
    console.log(keyValue('Output log', run.paths.outputLogPath));

    if (run.manifest?.source) {
      console.log('');
      console.log(section('Source'));
      console.log(keyValue('Type', run.manifest.source.type));
      if (run.manifest.source.id) {
        console.log(keyValue('Id', run.manifest.source.id));
      }
      if (run.manifest.source.filePath) {
        console.log(keyValue('File', run.manifest.source.filePath));
      }
    }

    if (run.status) {
      console.log('');
      console.log(section('Runtime'));
      console.log(keyValue('Created', new Date(run.status.createdAt).toLocaleString()));
      console.log(keyValue('Updated', new Date(run.status.updatedAt).toLocaleString()));
      console.log(keyValue('Active attempt', run.status.activeAttempt));
      if (run.status.startedAt) {
        console.log(keyValue('Started', new Date(run.status.startedAt).toLocaleString()));
      }
      if (run.status.completedAt) {
        console.log(keyValue('Completed', new Date(run.status.completedAt).toLocaleString()));
      }
      if (run.status.lastError) {
        console.log(keyValue('Last error', run.status.lastError));
      }
    }

    if (run.checkpoint) {
      console.log('');
      console.log(section('Checkpoint'));
      if (run.checkpoint.step) {
        console.log(keyValue('Step', run.checkpoint.step));
      }
      if (run.checkpoint.cursor) {
        console.log(keyValue('Cursor', run.checkpoint.cursor));
      }
      console.log(keyValue('Updated', new Date(run.checkpoint.updatedAt).toLocaleString()));
    }

    if (run.problems.length > 0) {
      console.log('');
      console.log(section('Problems'));
      for (const problem of run.problems) {
        console.log(bullet(problem));
      }
    }

    return run.recoveryAction === 'invalid' ? 1 : 0;
  }

  if (subcommand === 'logs') {
    let tail = 80;
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--tail') {
        const value = rest[index + 1];
        if (!value) {
          throw new Error(runsLogsUsageText());
        }

        tail = parseTailCount(value);
        index += 1;
        continue;
      }

      if (arg.startsWith('--')) {
        throw new Error(runsLogsUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(runsLogsUsageText());
    }

    const runId = positional[0] as string;
    const run = scanDurableRun(runsRoot, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const source = run.paths.outputLogPath;
    const output = existsSync(source)
      ? readTailLines(source, tail)
      : '';

    console.log(section(`Run logs: ${run.runId}`));
    console.log(keyValue('Source', source));
    console.log('');
    console.log(output.length > 0 ? output : dim('(empty output)'));
    return 0;
  }

  if (subcommand === 'start') {
    let cwd = process.cwd();
    const positional: string[] = [];
    const commandIndex = rest.indexOf('--');
    const head = commandIndex === -1 ? rest : rest.slice(0, commandIndex);
    let commandArgs = commandIndex === -1 ? [] : rest.slice(commandIndex + 1);

    for (let index = 0; index < head.length; index += 1) {
      const arg = head[index] as string;

      if (arg === '--cwd') {
        const value = head[index + 1];
        if (!value) {
          throw new Error(runsStartUsageText());
        }

        cwd = value;
        index += 1;
        continue;
      }

      if (arg.startsWith('--')) {
        throw new Error(runsStartUsageText());
      }

      positional.push(arg);
    }

    if (commandArgs.length === 0 && positional.length > 1) {
      commandArgs = positional.slice(1);
      positional.splice(1);
    }

    if (positional.length !== 1 || commandArgs.length === 0) {
      throw new Error(runsStartUsageText());
    }

    await ensureDaemonAvailable();
    const taskSlug = positional[0] as string;
    const result = await startBackgroundRun({
      taskSlug,
      cwd,
      argv: commandArgs,
      source: readBackgroundRunSource(taskSlug),
    });

    if (!result.accepted) {
      throw new Error(result.reason ?? `Failed to start run ${result.runId}`);
    }

    console.log(section('Durable run started'));
    console.log(keyValue('Run', result.runId));
    if (result.logPath) {
      console.log(keyValue('Log', result.logPath));
    }
    console.log(keyValue('Inspect', `pa runs show ${result.runId}`));
    return 0;
  }

  if (subcommand === 'start-agent') {
    let cwd = process.cwd();
    let prompt: string | undefined;
    let profile: string | undefined;
    let model: string | undefined;
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--cwd' || arg === '--prompt' || arg === '--profile' || arg === '--model') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(runsStartAgentUsageText());
        }

        if (arg === '--cwd') {
          cwd = value;
        } else if (arg === '--prompt') {
          prompt = value;
        } else if (arg === '--profile') {
          profile = value;
        } else {
          model = value;
        }

        index += 1;
        continue;
      }

      if (arg.startsWith('--')) {
        throw new Error(runsStartAgentUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1 || !prompt) {
      throw new Error(runsStartAgentUsageText());
    }

    await ensureDaemonAvailable();
    const taskSlug = positional[0] as string;
    const result = await startBackgroundRun({
      taskSlug,
      cwd,
      agent: {
        prompt,
        ...(profile ? { profile } : {}),
        ...(model ? { model } : {}),
      },
      source: readBackgroundRunSource(taskSlug),
    });

    if (!result.accepted) {
      throw new Error(result.reason ?? `Failed to start run ${result.runId}`);
    }

    console.log(section('Durable agent run started'));
    console.log(keyValue('Run', result.runId));
    if (result.logPath) {
      console.log(keyValue('Log', result.logPath));
    }
    console.log(keyValue('Inspect', `pa runs show ${result.runId}`));
    return 0;
  }

  if (subcommand === 'cancel') {
    const positional = rest.filter((arg) => !arg.startsWith('--'));
    const unknownOptions = rest.filter((arg) => arg.startsWith('--'));
    if (positional.length !== 1 || unknownOptions.length > 0) {
      throw new Error(runsCancelUsageText());
    }

    await ensureDaemonAvailable();
    const result = await cancelDurableRun(positional[0] as string);
    if (!result.cancelled) {
      throw new Error(result.reason ?? `Could not cancel run ${positional[0] as string}`);
    }

    console.log(section('Durable run cancelled'));
    console.log(keyValue('Run', result.runId));
    return 0;
  }

  throw new Error(`${runsUsageText()}\nUnknown runs subcommand: ${subcommand}`);
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

interface ParsedArgs {
  port: number;
  profile: string;
  runIds: string[];
}

interface RecoverConversationMemoryDistillRunsOptions {
  fetchImpl?: typeof fetch;
}

function readArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  return args[index + 1];
}

function readArgValues(args: string[], flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) {
      continue;
    }

    const value = args[index + 1]?.trim();
    if (value) {
      values.push(value);
    }
  }

  return values;
}

export function parseRecoverConversationMemoryDistillRunsArgs(argv: string[]): ParsedArgs {
  const portRaw = readArgValue(argv, '--port');
  const profile = readArgValue(argv, '--profile')?.trim();
  const runIds = [...new Set(readArgValues(argv, '--run-id'))];

  if (!portRaw || !profile || runIds.length === 0) {
    throw new Error('Usage: recoverConversationMemoryDistillRuns --port <port> --profile <profile> --run-id <run-id> [--run-id <run-id> ...]');
  }

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid --port value: ${portRaw}`);
  }

  return {
    port,
    profile,
    runIds,
  };
}

async function recoverRun(
  origin: string,
  profile: string,
  runId: string,
  fetchImpl: typeof fetch,
): Promise<'recovered' | 'already-completed'> {
  const response = await fetchImpl(`${origin}/api/runs/${encodeURIComponent(runId)}/node-distill/recover-now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({ profile }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Recovery request failed for ${runId} (${response.status}): ${responseText}`);
  }

  let parsed: {
    resolved?: 'recovered' | 'already-completed';
    conversationId?: string;
    memoryId?: string;
    referencePath?: string;
  } | null = null;

  try {
    parsed = JSON.parse(responseText) as {
      resolved?: 'recovered' | 'already-completed';
      conversationId?: string;
      memoryId?: string;
      referencePath?: string;
    };
  } catch {
    parsed = null;
  }

  const resolved = parsed?.resolved === 'already-completed' ? 'already-completed' : 'recovered';
  const conversationId = parsed?.conversationId ?? '(unknown)';
  const memoryId = parsed?.memoryId ?? '(unknown)';
  const referencePath = parsed?.referencePath ?? '(unknown)';

  if (resolved === 'already-completed') {
    console.log(`already resolved runId=${runId} conversationId=${conversationId} memoryId=${memoryId} reference=${referencePath}`);
    return resolved;
  }

  console.log(`recovered runId=${runId} conversationId=${conversationId} memoryId=${memoryId} reference=${referencePath}`);
  return resolved;
}

export async function runRecoverConversationMemoryDistillRunsCli(
  argv: string[] = process.argv.slice(2),
  options: RecoverConversationMemoryDistillRunsOptions = {},
): Promise<number> {
  const args = parseRecoverConversationMemoryDistillRunsArgs(argv);
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = `http://127.0.0.1:${args.port}`;

  let recoveredCount = 0;
  let alreadyCompletedCount = 0;
  let failedCount = 0;

  for (const runId of args.runIds) {
    console.log(`recovering runId=${runId}`);
    try {
      const resolved = await recoverRun(origin, args.profile, runId, fetchImpl);
      if (resolved === 'already-completed') {
        alreadyCompletedCount += 1;
      } else {
        recoveredCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  console.log(
    `recovery summary total=${args.runIds.length} recovered=${recoveredCount} alreadyCompleted=${alreadyCompletedCount} failed=${failedCount}`,
  );

  if (failedCount > 0) {
    throw new Error(`Failed to recover ${failedCount} of ${args.runIds.length} node distillation runs.`);
  }

  return 0;
}

const entryFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
const moduleFile = resolve(fileURLToPath(import.meta.url));

if (entryFile === moduleFile) {
  runRecoverConversationMemoryDistillRunsCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

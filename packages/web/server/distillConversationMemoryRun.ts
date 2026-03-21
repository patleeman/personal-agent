import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

interface DistillConversationMemoryRunPayload {
  conversationId: string;
  anchorMessageId?: string;
  checkpointId?: string;
  title?: string;
  summary?: string;
  tags?: string[];
  mode?: 'manual' | 'auto';
  trigger?: 'manual' | 'turn_end' | 'auto_compaction_end';
  emitActivity?: boolean;
}

interface ParsedArgs {
  port: number;
  profile: string;
  payload: DistillConversationMemoryRunPayload;
}

function readArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  return args[index + 1];
}

function parseArgs(argv: string[]): ParsedArgs {
  const portRaw = readArgValue(argv, '--port');
  const profile = readArgValue(argv, '--profile')?.trim();
  const payloadBase64 = readArgValue(argv, '--payload');

  if (!portRaw || !profile || !payloadBase64) {
    throw new Error('Usage: distillConversationMemoryRun --port <port> --profile <profile> --payload <base64url-json>');
  }

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid --port value: ${portRaw}`);
  }

  const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
  const payload = JSON.parse(payloadJson) as DistillConversationMemoryRunPayload;

  if (!payload || typeof payload !== 'object' || typeof payload.conversationId !== 'string' || payload.conversationId.trim().length === 0) {
    throw new Error('Invalid distillation payload. conversationId is required.');
  }

  return {
    port,
    profile,
    payload: {
      conversationId: payload.conversationId.trim(),
      ...(typeof payload.anchorMessageId === 'string' && payload.anchorMessageId.trim().length > 0 ? { anchorMessageId: payload.anchorMessageId.trim() } : {}),
      ...(typeof payload.checkpointId === 'string' && payload.checkpointId.trim().length > 0 ? { checkpointId: payload.checkpointId.trim() } : {}),
      ...(typeof payload.title === 'string' && payload.title.trim().length > 0 ? { title: payload.title.trim() } : {}),
      ...(typeof payload.summary === 'string' && payload.summary.trim().length > 0 ? { summary: payload.summary.trim() } : {}),
      ...(payload.mode === 'manual' ? { mode: 'manual' as const } : payload.mode === 'auto' ? { mode: 'auto' as const } : {}),
      ...(payload.trigger === 'manual' || payload.trigger === 'turn_end' || payload.trigger === 'auto_compaction_end'
        ? { trigger: payload.trigger }
        : {}),
      ...(typeof payload.emitActivity === 'boolean' ? { emitActivity: payload.emitActivity } : {}),
      ...(Array.isArray(payload.tags)
        ? {
            tags: payload.tags
              .filter((tag): tag is string => typeof tag === 'string')
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0),
          }
        : {}),
    },
  };
}

async function runDistillation(args: ParsedArgs): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${args.port}/api/conversations/${encodeURIComponent(args.payload.conversationId)}/memories/distill-now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profile: args.profile,
      title: args.payload.title,
      summary: args.payload.summary,
      anchorMessageId: args.payload.anchorMessageId,
      checkpointId: args.payload.checkpointId,
      tags: args.payload.tags,
      mode: args.payload.mode,
      trigger: args.payload.trigger,
      emitActivity: args.payload.emitActivity ?? true,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Distillation request failed (${response.status}): ${responseText}`);
  }

  let parsed: { memory?: { id?: string; title?: string }; disposition?: string } | null = null;
  try {
    parsed = JSON.parse(responseText) as { memory?: { id?: string; title?: string }; disposition?: string };
  } catch {
    parsed = null;
  }

  const disposition = parsed?.disposition ?? 'unknown';
  const memoryId = parsed?.memory?.id ?? '(unknown)';
  const memoryTitle = parsed?.memory?.title ?? '(untitled)';
  console.log(`distill completed disposition=${disposition} memoryId=${memoryId} title=${memoryTitle}`);
}

export async function runDistillConversationMemoryCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  await runDistillation(args);
  return 0;
}

const entryFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
const moduleFile = resolve(fileURLToPath(import.meta.url));

if (entryFile === moduleFile) {
  runDistillConversationMemoryCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

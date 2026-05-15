import { resolve } from 'node:path';

import type { MethodHandler } from '../codexJsonRpcServer.js';
import { broadcastToThread, subscribeConnectionToThread, unsubscribeConnectionFromThread } from '../codexJsonRpcServer.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function epochSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.floor(Date.now() / 1000);
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function absoluteCwd(value: unknown): string {
  return resolve(typeof value === 'string' && value.trim() ? value : process.cwd());
}

function threadStatus(detail?: Record<string, unknown>) {
  return detail?.running ? { type: 'active', activeFlags: [] } : { type: 'idle' };
}

function toThreadResponse(id: string, detail?: Record<string, unknown>, turns: unknown[] = []) {
  const name = (detail?.title as string) || null;
  const preview = (detail?.preview as string) || name || '';
  const cwd = absoluteCwd(detail?.cwd);

  return {
    id,
    sessionId: (detail?.sessionId as string) || id,
    forkedFromId: (detail?.forkedFromId as string) || null,
    preview,
    ephemeral: false,
    modelProvider: (detail?.modelProvider as string) || 'personal-agent',
    createdAt: epochSeconds(detail?.createdAt),
    updatedAt: epochSeconds(detail?.updatedAt),
    status: detail?.status && typeof detail.status === 'object' ? detail.status : threadStatus(detail),
    path: null,
    cwd,
    cliVersion: '0.125.0',
    source: 'appServer',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: detail?.gitInfo ?? null,
    name,
    turns,

    // Legacy PA compatibility field. Upstream Codex clients ignore it.
    title: name ?? '',
  };
}

function threadSessionFields(thread: ReturnType<typeof toThreadResponse>) {
  return {
    model: 'personal-agent',
    modelProvider: thread.modelProvider,
    serviceTier: null,
    cwd: thread.cwd,
    instructionSources: [],
    approvalPolicy: 'on-failure',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' },
    permissionProfile: null,
    activePermissionProfile: null,
    reasoningEffort: null,
  };
}

function toThreadSessionResponse(thread: ReturnType<typeof toThreadResponse>) {
  return { thread, ...threadSessionFields(thread) };
}

// ── Goal storage key helper ─────────────────────────────────────────────────

function goalKey(threadId: string): string {
  return `goal-${threadId}`;
}

function metaKey(threadId: string): string {
  return `meta-${threadId}`;
}

// ── Method handlers ─────────────────────────────────────────────────────────

export const thread = {
  /** `thread/start` */
  start: (async (params, ctx, conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const created = await ctx.conversations.create({
      cwd: p?.cwd as string | undefined,
      model: p?.model as string | undefined,
      prompt: p?.prompt as string | undefined,
    });
    const meta = await ctx.conversations.getMeta(created.id);
    const detail = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
    const threadId = created.id;

    subscribeConnectionToThread(threadId, notify, ctx, conn);

    const thread = toThreadResponse(threadId, detail);
    notify('thread/started', { thread });
    broadcastToThread(threadId, 'thread/status/changed', {
      threadId,
      status: { type: 'idle' },
    });

    return toThreadSessionResponse(thread);
  }) as MethodHandler,

  /** `thread/resume` */
  resume: (async (params, ctx, conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    const meta = await ctx.conversations.getMeta(threadId).catch(() => null);
    const detail = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};

    subscribeConnectionToThread(threadId, notify, ctx, conn);

    const thread = toThreadResponse(threadId, detail);
    notify('thread/started', { thread });
    broadcastToThread(threadId, 'thread/status/changed', {
      threadId,
      status: { type: 'idle' },
    });

    return toThreadSessionResponse(thread);
  }) as MethodHandler,

  /** `thread/fork` — fork a thread into a new one with full history */
  fork: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const sourceId = p?.threadId as string | undefined;
    if (!sourceId) throw new Error('threadId is required');

    const result = await ctx.conversations.fork(sourceId, p?.cwd as string | undefined);
    const meta = await ctx.conversations.getMeta(result.id).catch(() => null);
    const detail = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
    const thread = toThreadResponse(result.id, { ...detail, forkedFromId: sourceId });
    return toThreadSessionResponse(thread);
  }) as MethodHandler,

  /** `thread/list` */
  list: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const limit = typeof p?.limit === 'number' ? Math.min(p.limit, 100) : 25;

    const sessions = await ctx.conversations.list();
    const data = Array.isArray(sessions)
      ? sessions.slice(0, limit).map((s: unknown) => {
          const session = s as Record<string, unknown>;
          const id = String(session.id ?? session.sessionId ?? '');
          return toThreadResponse(id, {
            ...session,
            title: (session.title as string) ?? '',
            status: { type: 'notLoaded' },
          });
        })
      : [];

    return { data, nextCursor: null, backwardsCursor: null };
  }) as MethodHandler,

  /** `thread/loaded/list` — list currently loaded (live) thread ids */
  loadedList: (async (_params, ctx) => {
    const sessions = await ctx.conversations.list();
    const loaded = Array.isArray(sessions)
      ? sessions
          .filter((s: unknown) => {
            const session = s as Record<string, unknown>;
            return session.running === true || session.id != null;
          })
          .map((s: unknown) => (s as Record<string, unknown>).id as string)
      : [];
    return { data: loaded, nextCursor: null };
  }) as MethodHandler,

  /** `thread/read` */
  read: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    const includeTurns = p?.includeTurns === true;
    const meta = await ctx.conversations.getMeta(threadId).catch(() => null);
    const detail = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};

    const turns: unknown[] = includeTurns
      ? [
          {
            id: `turn-${threadId}-0`,
            items: [],
            itemsView: 'full',
            status: 'completed',
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
          },
        ]
      : [];

    // Attach stored metadata
    const storedMeta = await ctx.storage.get<Record<string, unknown>>(metaKey(threadId)).catch(() => null);
    const gitInfo = storedMeta?.gitInfo ?? null;

    return {
      thread: toThreadResponse(threadId, { ...detail, gitInfo }, turns),
    };
  }) as MethodHandler,

  /** `thread/archive` */
  archive: (async (params) => {
    const threadId = (params as Record<string, unknown> | undefined)?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');
    return {};
  }) as MethodHandler,

  /** `thread/unarchive` */
  unarchive: (async (params) => {
    const threadId = (params as Record<string, unknown> | undefined)?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');
    return { thread: toThreadResponse(threadId) };
  }) as MethodHandler,

  /** `thread/name/set` */
  nameSet: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    const name = p?.name as string | undefined;
    if (!threadId) throw new Error('threadId is required');
    if (!name) throw new Error('name is required');

    await ctx.conversations.setTitle(threadId, name);
    broadcastToThread(threadId, 'thread/name/updated', { threadId, name });
    return {};
  }) as MethodHandler,

  /** `thread/metadata/update` — patch stored thread metadata */
  metadataUpdate: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    const existing = (await ctx.storage.get<Record<string, unknown>>(metaKey(threadId)).catch(() => null)) ?? {};
    const gitInfo = p?.gitInfo as Record<string, unknown> | undefined;
    const merged = { ...existing, ...(gitInfo ? { gitInfo } : {}) };
    await ctx.storage.put(metaKey(threadId), merged);

    return { thread: { id: threadId, gitInfo: merged.gitInfo ?? null } };
  }) as MethodHandler,

  /** `thread/compact/start` — trigger compaction on a thread */
  compactStart: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    const options = p?.options as Record<string, unknown> | undefined;
    const customInstructions = options?.customInstructions as string | undefined;

    await ctx.conversations.compact(threadId, customInstructions);
    broadcastToThread(threadId, 'thread/status/changed', {
      threadId,
      status: { type: 'idle' },
    });

    return {};
  }) as MethodHandler,

  /** `thread/unsubscribe` */
  unsubscribe: (async (params, _ctx, conn, notify) => {
    const threadId = (params as Record<string, unknown> | undefined)?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');
    unsubscribeConnectionFromThread(threadId, notify);
    conn.subscribedThreads.delete(threadId);
    return { status: 'unsubscribed' };
  }) as MethodHandler,

  /** `thread/goal/set` — create, replace, or update a thread goal */
  goalSet: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    const existing = (await ctx.storage.get<Record<string, unknown>>(goalKey(threadId)).catch(() => null)) ?? {};
    const now = Date.now();

    const objective = p?.objective as string | undefined;
    const status = (p?.status as string) ?? existing.status ?? 'active';

    const goal = {
      threadId,
      objective: objective ?? existing.objective ?? '',
      status: existing.objective && !objective ? (status as string) : 'active',
      tokenBudget: (p?.tokenBudget as number) ?? existing.tokenBudget ?? 0,
      tokensUsed: existing.objective && !objective ? (existing.tokensUsed ?? 0) : 0,
      timeUsedSeconds: existing.objective && !objective ? (existing.timeUsedSeconds ?? 0) : 0,
      createdAt: existing.objective && !objective ? (existing.createdAt ?? now) : now,
      updatedAt: now,
    };

    await ctx.storage.put(goalKey(threadId), goal);
    broadcastToThread(threadId, 'thread/goal/updated', { threadId, goal });

    return { goal };
  }) as MethodHandler,

  /** `thread/goal/get` — fetch the current goal */
  goalGet: (async (params, ctx) => {
    const threadId = (params as Record<string, unknown> | undefined)?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    const goal = await ctx.storage.get<Record<string, unknown>>(goalKey(threadId)).catch(() => null);
    return { goal: goal ?? null };
  }) as MethodHandler,

  /** `thread/goal/clear` — clear the current goal */
  goalClear: (async (params, ctx) => {
    const threadId = (params as Record<string, unknown> | undefined)?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    const existing = await ctx.storage.get<Record<string, unknown>>(goalKey(threadId)).catch(() => null);
    await ctx.storage.delete(goalKey(threadId));

    const cleared = existing != null;
    broadcastToThread(threadId, 'thread/goal/cleared', { threadId });

    return { cleared };
  }) as MethodHandler,

  /** `thread/rollback` — drop the last N turns */
  rollback: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');
    const count = typeof p?.count === 'number' ? Math.max(1, p.count) : 1;

    const result = await ctx.conversations.rollback(threadId, count);
    broadcastToThread(threadId, 'thread/status/changed', {
      threadId,
      status: { type: 'idle' },
    });

    return { thread: { id: threadId }, rolledBackTo: result.rolledBackTo };
  }) as MethodHandler,

  /** `thread/inject_items` — inject raw items into the conversation history */
  injectItems: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    const items = p?.items as unknown[] | undefined;
    if (!threadId) throw new Error('threadId is required');

    if (items && items.length > 0) {
      const itemText = items
        .map((item: unknown) => {
          const i = item as Record<string, unknown>;
          if (i.type === 'message') return (i.content as string) ?? '';
          if (i.type === 'text') return (i.text as string) ?? '';
          return JSON.stringify(item);
        })
        .join('\n');

      if (itemText.trim()) {
        try {
          await ctx.conversations.sendMessage(threadId, `[injected context]\n${itemText}`);
        } catch {
          /* ok */
        }
      }
    }

    return {};
  }) as MethodHandler,

  /** `thread/shellCommand` — run a shell command and inject output into thread */
  shellCommand: (async (params, ctx, _conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    const command = p?.command as string | undefined;
    if (!threadId) throw new Error('threadId is required');
    if (!command) throw new Error('command is required');

    const result = await ctx.shell.exec({ command: 'sh', args: ['-c', command], cwd: (p?.cwd as string) ?? process.cwd() });
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    try {
      await ctx.conversations.sendMessage(
        threadId,
        `[shell command]\n$ ${command}\n${output ? `\`\`\`\n${output}\n\`\`\`` : ''}\n[exited with code 0]`,
      );
    } catch {
      /* ok */
    }
    notify('turn/completed', {
      threadId,
      turn: { id: `shell-${Date.now()}`, status: 'completed', error: null },
    });
    return { exitCode: 0, output, executionWrappers: result.executionWrappers };
  }) as MethodHandler,
};

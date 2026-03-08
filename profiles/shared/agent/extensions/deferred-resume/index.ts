import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATUS_KEY = 'deferred-resume';
const STATUS_REFRESH_MS = 3_000;

interface DeferredResumeEntry {
  sessionFile: string;
}

function resolveStateRoot(): string {
  if (process.env.PERSONAL_AGENT_STATE_ROOT) {
    return process.env.PERSONAL_AGENT_STATE_ROOT;
  }

  if (process.env.XDG_STATE_HOME) {
    return join(process.env.XDG_STATE_HOME, 'personal-agent');
  }

  return join(homedir(), '.local', 'state', 'personal-agent');
}

function resolveDeferredResumeStateFile(): string {
  return join(resolveStateRoot(), 'daemon', 'deferred-followups-state.json');
}

export function loadDeferredResumeEntries(stateFile = resolveDeferredResumeStateFile()): DeferredResumeEntry[] {
  if (!existsSync(stateFile)) {
    return [];
  }

  try {
    const raw = readFileSync(stateFile, 'utf-8').trim();
    if (raw.length === 0) {
      return [];
    }

    const parsed = JSON.parse(raw) as { followUps?: Record<string, Record<string, unknown>> };
    if (!parsed.followUps || typeof parsed.followUps !== 'object') {
      return [];
    }

    const entries: DeferredResumeEntry[] = [];
    for (const value of Object.values(parsed.followUps)) {
      const sessionFile = typeof value.sessionFile === 'string' ? value.sessionFile.trim() : '';
      if (!sessionFile) {
        continue;
      }

      entries.push({ sessionFile });
    }

    return entries;
  } catch {
    return [];
  }
}

export function buildDeferredResumeStatusText(input: {
  totalCount: number;
  currentSessionCount: number;
  theme: { fg: (tone: string, text: string) => string };
}): string {
  const { totalCount, currentSessionCount, theme } = input;

  if (currentSessionCount > 0) {
    return theme.fg('warning', '⏰') + theme.fg('warning', ` resume:${currentSessionCount}*`);
  }

  if (totalCount > 0) {
    return theme.fg('accent', '⏰') + theme.fg('dim', ` resume:${totalCount}`);
  }

  return theme.fg('dim', '⏰ resume:0');
}

async function refreshStatus(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const entries = loadDeferredResumeEntries();
  const currentSessionFile = ctx.sessionManager.getSessionFile();
  const currentSessionCount = currentSessionFile
    ? entries.filter((entry) => entry.sessionFile === currentSessionFile).length
    : 0;

  ctx.ui.setStatus(STATUS_KEY, buildDeferredResumeStatusText({
    totalCount: entries.length,
    currentSessionCount,
    theme: ctx.ui.theme,
  }));
}

export default function deferredResumeStatusExtension(pi: ExtensionAPI): void {
  let statusTimer: ReturnType<typeof setInterval> | null = null;

  const startStatusTimer = async (ctx: ExtensionContext): Promise<void> => {
    await refreshStatus(ctx);

    if (statusTimer) {
      clearInterval(statusTimer);
    }

    statusTimer = setInterval(() => {
      void refreshStatus(ctx);
    }, STATUS_REFRESH_MS);
  };

  pi.on('session_start', async (_event, ctx) => {
    await startStatusTimer(ctx);
  });

  pi.on('session_switch', async (_event, ctx) => {
    await startStatusTimer(ctx);
  });

  pi.on('turn_end', async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }

    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });
}

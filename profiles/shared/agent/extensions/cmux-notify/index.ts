import { existsSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';

type DeliveryBackend = 'cmux-cli' | 'osc99' | 'osc777';

interface NotificationPayload {
  title: string;
  subtitle: string;
  body: string;
}

const DEFAULT_CMUX_SOCKET_PATH = '/tmp/cmux.sock';
const MAX_TITLE_LENGTH = 80;
const MAX_SUBTITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 220;
const CMUX_NOTIFY_TIMEOUT_MS = 1500;
const AGENT_END_SETTLE_DELAY_MS = 150;

let cachedBackend: DeliveryBackend | undefined;
let lastNotificationKey: string | undefined;
let notificationCounter = 0;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function sanitizeForNotification(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/[\u0007\u001b]/g, ' ')
      .replace(/[;\r\n]+/g, ' '),
  );
}

function sanitizeAndTruncate(value: string, maxLength: number, fallback: string): string {
  const sanitized = truncate(sanitizeForNotification(value), maxLength);
  return sanitized.length > 0 ? sanitized : fallback;
}

function toDisplayPath(targetPath: string): string {
  const resolvedTarget = resolve(targetPath);
  const home = process.env.HOME?.trim();

  if (!home) {
    return resolvedTarget.replace(/\\/g, '/');
  }

  const resolvedHome = resolve(home);
  if (resolvedTarget === resolvedHome) {
    return '~';
  }

  if (resolvedTarget.startsWith(`${resolvedHome}${sep}`)) {
    const relativeFromHome = relative(resolvedHome, resolvedTarget).replace(/\\/g, '/');
    return relativeFromHome.length > 0 ? `~/${relativeFromHome}` : '~';
  }

  return resolvedTarget.replace(/\\/g, '/');
}

function sessionLabel(ctx: ExtensionContext): string {
  const namedSession = ctx.sessionManager.getSessionName()?.trim();
  if (namedSession && namedSession.length > 0) {
    return namedSession;
  }

  const base = basename(ctx.cwd);
  if (base.length > 0) {
    return base;
  }

  return toDisplayPath(ctx.cwd);
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type !== 'text' || typeof typedBlock.text !== 'string') {
      continue;
    }

    const text = normalizeWhitespace(typedBlock.text);
    if (text.length > 0) {
      parts.push(text);
    }
  }

  return parts.join(' ');
}

function lastAssistantPreview(event: AgentEndEvent): string | undefined {
  for (let i = event.messages.length - 1; i >= 0; i -= 1) {
    const message = event.messages[i] as { role?: unknown; content?: unknown } | undefined;
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const text = normalizeWhitespace(extractTextContent(message.content));
    if (text.length > 0) {
      return text;
    }
  }

  return undefined;
}

function buildNotificationPayload(ctx: ExtensionContext, event: AgentEndEvent): NotificationPayload {
  const title = sanitizeAndTruncate(`Pi · ${sessionLabel(ctx)}`, MAX_TITLE_LENGTH, 'Pi');
  const subtitle = sanitizeAndTruncate(toDisplayPath(ctx.cwd), MAX_SUBTITLE_LENGTH, 'Current workspace');
  const preview = lastAssistantPreview(event);
  const bodyText = preview ? `Ready for input — ${preview}` : 'Ready for input';
  const body = sanitizeAndTruncate(bodyText, MAX_BODY_LENGTH, 'Ready for input');

  return { title, subtitle, body };
}

function shouldNotify(ctx: ExtensionContext): boolean {
  if (!process.stdout.isTTY) {
    return false;
  }

  if (!ctx.hasUI) {
    return false;
  }

  if (!ctx.isIdle()) {
    return false;
  }

  if (ctx.hasPendingMessages()) {
    return false;
  }

  return true;
}

function notificationKey(ctx: ExtensionContext): string {
  const sessionId = ctx.sessionManager.getSessionId();
  const leafId = ctx.sessionManager.getLeafId() ?? 'no-leaf';
  return `${sessionId}:${leafId}`;
}

function hasCmuxSocket(): boolean {
  const socketPath = process.env.CMUX_SOCKET_PATH?.trim() || DEFAULT_CMUX_SOCKET_PATH;
  return socketPath.length > 0 && existsSync(socketPath);
}

function shouldTryCmuxCli(): boolean {
  if (process.env.CMUX_WORKSPACE_ID?.trim()) {
    return true;
  }

  return hasCmuxSocket();
}

async function tryCmuxCli(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  payload: NotificationPayload,
): Promise<boolean> {
  if (!shouldTryCmuxCli()) {
    return false;
  }

  const args = ['notify', '--title', payload.title, '--subtitle', payload.subtitle, '--body', payload.body];
  const result = await pi.exec('cmux', args, {
    cwd: ctx.cwd,
    timeout: CMUX_NOTIFY_TIMEOUT_MS,
  });

  return result.code === 0;
}

function escapeForTmux(sequence: string): string {
  return sequence.replace(/\x1b/g, '\x1b\x1b');
}

function wrapForTmux(sequence: string): string {
  if (!process.env.TMUX) {
    return sequence;
  }

  return `\x1bPtmux;${escapeForTmux(sequence)}\x1b\\`;
}

function writeSequence(sequence: string): void {
  process.stdout.write(wrapForTmux(sequence));
}

function nextNotificationId(): number {
  notificationCounter += 1;
  return notificationCounter;
}

function sendOsc777(payload: NotificationPayload): void {
  const title = payload.subtitle.length > 0
    ? `${payload.title} — ${payload.subtitle}`
    : payload.title;

  writeSequence(`\x1b]777;notify;${title};${payload.body}\x07`);
}

function sendOsc99(payload: NotificationPayload): void {
  const notificationId = nextNotificationId();
  const sequences = [
    `\x1b]99;i=${notificationId};e=1;d=0;p=title:${payload.title}\x1b\\`,
    `\x1b]99;i=${notificationId};e=1;d=0;p=subtitle:${payload.subtitle}\x1b\\`,
    `\x1b]99;i=${notificationId};e=1;d=1;p=body:${payload.body}\x1b\\`,
  ];

  for (const sequence of sequences) {
    writeSequence(sequence);
  }
}

function fallbackBackend(): DeliveryBackend {
  return process.env.KITTY_WINDOW_ID ? 'osc99' : 'osc777';
}

async function deliverNotification(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  payload: NotificationPayload,
): Promise<DeliveryBackend> {
  if (!cachedBackend || cachedBackend === 'cmux-cli') {
    const deliveredViaCmux = await tryCmuxCli(pi, ctx, payload);
    if (deliveredViaCmux) {
      cachedBackend = 'cmux-cli';
      return 'cmux-cli';
    }
  }

  const backend = cachedBackend === 'osc99' || cachedBackend === 'osc777'
    ? cachedBackend
    : fallbackBackend();

  if (backend === 'osc99') {
    sendOsc99(payload);
  } else {
    sendOsc777(payload);
  }

  cachedBackend = backend;
  return backend;
}

async function notifyAgentReady(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  event: AgentEndEvent,
  force: boolean,
): Promise<DeliveryBackend | undefined> {
  if (!force && !shouldNotify(ctx)) {
    return undefined;
  }

  const key = notificationKey(ctx);
  if (!force && lastNotificationKey === key) {
    return undefined;
  }

  const payload = buildNotificationPayload(ctx, event);
  const backend = await deliverNotification(pi, ctx, payload);
  lastNotificationKey = key;
  return backend;
}

function parseDelaySeconds(args: string): number {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(parsed, 30);
}

function scheduleAgentEndNotification(pi: ExtensionAPI, ctx: ExtensionContext, event: AgentEndEvent): void {
  setTimeout(() => {
    void notifyAgentReady(pi, ctx, event, false);
  }, AGENT_END_SETTLE_DELAY_MS);
}

export default function cmuxNotifyExtension(pi: ExtensionAPI): void {
  pi.on('agent_end', async (event, ctx) => {
    scheduleAgentEndNotification(pi, ctx, event);
  });

  pi.registerCommand('cmux-notify-test', {
    description: 'Send a test attention notification through cmux or terminal OSC; pass seconds to delay it',
    handler: async (args, ctx) => {
      if (!process.stdout.isTTY) {
        if (ctx.hasUI) {
          ctx.ui.notify('cmux-notify: stdout is not a TTY', 'warning');
        }
        return;
      }

      const sendTest = async (): Promise<DeliveryBackend> => deliverNotification(pi, ctx, {
        title: sanitizeAndTruncate(`Pi · ${sessionLabel(ctx)}`, MAX_TITLE_LENGTH, 'Pi'),
        subtitle: sanitizeAndTruncate(toDisplayPath(ctx.cwd), MAX_SUBTITLE_LENGTH, 'Current workspace'),
        body: sanitizeAndTruncate('Ready for input — Test notification from Pi.', MAX_BODY_LENGTH, 'Ready for input'),
      });

      const delaySeconds = parseDelaySeconds(args);
      if (delaySeconds > 0) {
        setTimeout(() => {
          void sendTest();
        }, delaySeconds * 1000);

        if (ctx.hasUI) {
          ctx.ui.notify(`cmux-notify: scheduled test for ${delaySeconds}s from now`, 'info');
        }
        return;
      }

      const backend = await sendTest();

      if (!ctx.hasUI) {
        return;
      }

      const tmuxHint = process.env.TMUX && backend !== 'cmux-cli'
        ? ' (tmux passthrough mode)'
        : '';
      ctx.ui.notify(`cmux-notify: sent via ${backend}${tmuxHint}`, 'info');
    },
  });
}

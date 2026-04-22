import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { mkdir, stat } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { getPiAgentRuntimeDir } from '@personal-agent/core';

export type ComputerUseAction =
  | 'observe'
  | 'click'
  | 'double_click'
  | 'move'
  | 'drag'
  | 'scroll'
  | 'type'
  | 'keypress'
  | 'wait'
  | 'set_value'
  | 'secondary_action';

export interface ComputerUseElement {
  elementId: string;
  depth?: number;
  role?: string;
  subrole?: string;
  title?: string;
  description?: string;
  value?: string;
  enabled?: boolean;
  focused?: boolean;
  settable?: boolean;
  actions?: string[];
  frame?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ComputerUseInput {
  action: ComputerUseAction;
  app?: string;
  windowTitle?: string;
  x?: number;
  y?: number;
  elementId?: string;
  button?: 'left' | 'right' | 'wheel' | 'back' | 'forward';
  path?: Array<{ x: number; y: number }>;
  scrollX?: number;
  scrollY?: number;
  text?: string;
  accessibilityAction?: string;
  keys?: string[];
  ms?: number;
  captureId?: string;
}

export interface ComputerUseDetails {
  tool: 'computer_use';
  action: ComputerUseAction;
  target: {
    app: string;
    bundleId?: string;
    pid: number;
    windowTitle: string;
    windowId: number;
  };
  capture: {
    captureId: string;
    width: number;
    height: number;
    timestamp: number;
    coordinateSpace: 'window-relative-screenshot-pixels';
  };
  ui?: {
    focusedElementId?: string;
    elements: ComputerUseElement[];
  };
}

interface PermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
}

interface CurrentTarget {
  appName: string;
  bundleId?: string;
  pid: number;
  windowTitle: string;
  windowId: number;
}

interface CurrentCapture {
  captureId: string;
  width: number;
  height: number;
  timestamp: number;
  snapshotId?: string;
  focusedElementId?: string;
  elements?: ComputerUseElement[];
}

interface HelperApp {
  appName: string;
  bundleId?: string;
  pid: number;
  isFrontmost: boolean;
}

interface HelperWindow {
  windowId: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isOnscreen: boolean;
}

interface HelperCaptureState {
  pngBase64: string;
  width: number;
  height: number;
  snapshotId?: string;
  focusedElementId?: string;
  elements?: ComputerUseElement[];
}

interface FrontmostResult {
  appName: string;
  bundleId?: string;
  pid: number;
  windowTitle?: string;
  windowId?: number;
}

interface PendingRequest {
  cmd: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
}

interface RuntimeState {
  currentTarget?: CurrentTarget;
  currentCapture?: CurrentCapture;
  helper?: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  pending: Map<string, PendingRequest>;
  requestSequence: number;
  queueTail: Promise<void>;
  helperBuilt: boolean;
  permissionStatus?: PermissionStatus;
  permissionCheckedAt?: number;
}

const TOOL_NAME = 'computer_use';
const DEFAULT_WAIT_MS = 1000;
const ACTION_SETTLE_MS = 120;
const COMMAND_TIMEOUT_MS = 15_000;
const CAPTURE_TIMEOUT_MS = 20_000;
const BUILD_TIMEOUT_MS = 120_000;
const PERMISSION_CACHE_MS = 15_000;
const HELPER_PATH = join(getPiAgentRuntimeDir(), 'helpers', 'computer-use', 'bridge');
const HELPER_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'native', 'bridge.swift');

const MISSING_TARGET_ERROR = "No current controlled window. Use computer_use with action='observe' first.";
const STALE_CAPTURE_ERROR = "The requested action used an older screenshot. Use computer_use with action='observe' to refresh the current window state.";
const TARGET_GONE_ERROR = "The current controlled window is no longer available. Use computer_use with action='observe' to choose a new target window.";
const MISSING_ELEMENTS_ERROR = "No current accessibility element map. Use computer_use with action='observe' to refresh element IDs before targeting elements.";
const STALE_ELEMENT_ERROR = "The requested accessibility element is stale. Use computer_use with action='observe' to refresh element IDs before targeting elements.";
const ACCESSIBILITY_ERROR = 'computer_use needs Accessibility. Grant it to the app or terminal running personal-agent, then retry.';
const SCREEN_RECORDING_ERROR = 'computer_use needs Screen Recording. Grant it to Personal Agent or the terminal running personal-agent, then retry.';

const runtimeState: RuntimeState = {
  stdoutBuffer: '',
  pending: new Map(),
  requestSequence: 0,
  queueTail: Promise.resolve(),
  helperBuilt: false,
};

class HelperTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HelperTransportError';
  }
}

class HelperCommandError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'HelperCommandError';
    this.code = code;
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Operation aborted.');
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error('Operation aborted.'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function withRuntimeLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = runtimeState.queueTail;
  let release!: () => void;
  runtimeState.queueTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

export function normalizeComputerUseAction(rawAction: string): ComputerUseAction {
  const normalized = rawAction.trim().toLowerCase();
  switch (normalized) {
    case 'observe':
    case 'screenshot':
      return 'observe';
    case 'click':
      return 'click';
    case 'double_click':
    case 'double-click':
    case 'doubleclick':
      return 'double_click';
    case 'move':
    case 'move_mouse':
    case 'move-mouse':
      return 'move';
    case 'drag':
      return 'drag';
    case 'scroll':
      return 'scroll';
    case 'type':
    case 'type_text':
    case 'type-text':
      return 'type';
    case 'keypress':
    case 'key_press':
    case 'key-press':
      return 'keypress';
    case 'wait':
      return 'wait';
    case 'set_value':
    case 'set-value':
    case 'setvalue':
      return 'set_value';
    case 'secondary_action':
    case 'secondary-action':
    case 'secondaryaction':
    case 'perform_accessibility_action':
    case 'perform-accessibility-action':
      return 'secondary_action';
    default:
      throw new Error(`Unsupported computer_use action '${rawAction}'.`);
  }
}

function normalizeKeyToken(token: string): string {
  const normalized = token.trim().toUpperCase();
  switch (normalized) {
    case 'COMMAND':
    case 'CMD':
    case 'META':
      return 'CMD';
    case 'CONTROL':
    case 'CTRL':
      return 'CTRL';
    case 'OPTION':
    case 'OPT':
    case 'ALT':
      return 'ALT';
    case 'RETURN':
      return 'ENTER';
    case 'ESC':
      return 'ESCAPE';
    default:
      return normalized;
  }
}

function splitShortcut(text: string): string[] {
  return text
    .split(/[+,]/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function normalizeKeysInput(input: string[] | string): string[] {
  const tokens: string[] = [];
  if (typeof input === 'string') {
    tokens.push(...splitShortcut(input));
  } else {
    for (const part of input) {
      if (typeof part !== 'string') {
        continue;
      }

      if (part.includes('+') || part.includes(',')) {
        tokens.push(...splitShortcut(part));
      } else {
        tokens.push(part.trim());
      }
    }
  }

  const normalized = tokens.map(normalizeKeyToken).filter((value) => value.length > 0);
  if (normalized.length === 0) {
    throw new Error('computer_use keypress actions need at least one key token.');
  }

  return normalized;
}

export function prepareComputerUseArguments(args: unknown): ComputerUseInput {
  if (!args || typeof args !== 'object') {
    throw new Error('computer_use expects an object argument.');
  }

  const input = args as Record<string, unknown>;
  const rawAction = typeof input.action === 'string'
    ? input.action
    : typeof input.kind === 'string'
      ? input.kind
      : undefined;

  if (!rawAction) {
    throw new Error('computer_use requires an action field.');
  }

  const prepared: ComputerUseInput = {
    action: normalizeComputerUseAction(rawAction),
  };

  if (typeof input.app === 'string') {
    prepared.app = input.app;
  }
  if (typeof input.windowTitle === 'string') {
    prepared.windowTitle = input.windowTitle;
  }
  if (typeof input.x === 'number') {
    prepared.x = input.x;
  }
  if (typeof input.y === 'number') {
    prepared.y = input.y;
  }
  if (typeof input.elementId === 'string') {
    prepared.elementId = input.elementId;
  }
  if (typeof input.button === 'string') {
    prepared.button = input.button as ComputerUseInput['button'];
  }
  if (typeof input.scrollX === 'number') {
    prepared.scrollX = input.scrollX;
  }
  if (typeof input.scrollY === 'number') {
    prepared.scrollY = input.scrollY;
  }
  if (typeof input.text === 'string') {
    prepared.text = input.text;
  }
  if (typeof input.accessibilityAction === 'string') {
    prepared.accessibilityAction = input.accessibilityAction;
  }
  if (typeof input.ms === 'number') {
    prepared.ms = input.ms;
  }
  if (typeof input.captureId === 'string') {
    prepared.captureId = input.captureId;
  }
  if (Array.isArray(input.path)) {
    prepared.path = input.path
      .filter((value): value is { x: number; y: number } => (
        !!value
        && typeof value === 'object'
        && Number.isFinite((value as { x?: unknown }).x)
        && Number.isFinite((value as { y?: unknown }).y)
      ))
      .map((value) => ({
        x: Number((value as { x: number }).x),
        y: Number((value as { y: number }).y),
      }));
  }

  const rawKeys = input.keys;
  if (Array.isArray(rawKeys)) {
    prepared.keys = normalizeKeysInput(rawKeys.filter((value): value is string => typeof value === 'string'));
  } else if (typeof rawKeys === 'string') {
    prepared.keys = normalizeKeysInput(rawKeys);
  }

  return prepared;
}

export function chooseAppByQuery(apps: HelperApp[], appQuery: string): HelperApp {
  const query = normalizeText(appQuery);
  const exactMatches = apps.filter((app) => normalizeText(app.appName) === query);
  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }
  if (exactMatches.length > 1) {
    return exactMatches.find((app) => app.isFrontmost) ?? exactMatches[0]!;
  }

  const partialMatches = apps.filter((app) => normalizeText(app.appName).includes(query));
  if (partialMatches.length === 1) {
    return partialMatches[0]!;
  }
  if (partialMatches.length > 1) {
    const names = partialMatches.map((app) => app.appName).join(', ');
    throw new Error(`App '${appQuery}' is ambiguous (${names}). Use a more specific app name.`);
  }

  throw new Error(`App '${appQuery}' is not running.`);
}

export function chooseWindowByTitle(windows: HelperWindow[], titleQuery: string, appName: string): HelperWindow {
  const query = normalizeText(titleQuery);
  const exactMatches = windows.filter((window) => normalizeText(window.title) === query);
  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }
  if (exactMatches.length > 1) {
    const names = exactMatches.map((window) => window.title || '(untitled)').join(', ');
    throw new Error(`Window title '${titleQuery}' is ambiguous in app '${appName}' (${names}).`);
  }

  const partialMatches = windows.filter((window) => normalizeText(window.title).includes(query));
  if (partialMatches.length === 1) {
    return partialMatches[0]!;
  }
  if (partialMatches.length > 1) {
    const names = partialMatches.map((window) => window.title || '(untitled)').join(', ');
    throw new Error(`Window title '${titleQuery}' is ambiguous in app '${appName}' (${names}).`);
  }

  throw new Error(`Window '${titleQuery}' was not found in app '${appName}'.`);
}

function scoreWindow(window: HelperWindow): number {
  let score = 0;
  if (window.isOnscreen) {
    score += 100;
  }
  if (window.title.trim().length > 0) {
    score += 30;
  }
  score += Math.round((window.width * window.height) / 10_000);
  return score;
}

function choosePreferredWindow(windows: HelperWindow[], appName: string): HelperWindow {
  const candidates = windows.filter((window) => window.width > 40 && window.height > 40);
  if (candidates.length === 0) {
    throw new Error(`No controllable window was found in app '${appName}'.`);
  }

  return [...candidates].sort((left, right) => scoreWindow(right) - scoreWindow(left))[0]!;
}

function currentTargetOrThrow(): CurrentTarget {
  const current = runtimeState.currentTarget;
  if (!current) {
    throw new Error(MISSING_TARGET_ERROR);
  }
  return current;
}

function normalizeHelperActionError(error: unknown): Error {
  if (error instanceof HelperCommandError) {
    switch (error.code) {
      case 'window_not_found':
        return new Error(TARGET_GONE_ERROR);
      case 'invalid_snapshot':
        return new Error(MISSING_ELEMENTS_ERROR);
      case 'invalid_element_id':
        return new Error(STALE_ELEMENT_ERROR);
      default:
        return error;
    }
  }

  return normalizeError(error);
}

function sanitizeSummaryText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length <= 80) {
    return trimmed;
  }

  return `${trimmed.slice(0, 77)}...`;
}

function formatElementSummary(element: ComputerUseElement): string {
  const role = element.role ?? 'AXElement';
  const parts = [`- ${element.elementId} ${role}`];
  if (element.subrole) {
    parts.push(`/${element.subrole}`);
  }

  const labels = [
    sanitizeSummaryText(element.title),
    sanitizeSummaryText(element.description),
    sanitizeSummaryText(element.value),
  ].filter((value): value is string => Boolean(value));

  if (labels.length > 0) {
    parts.push(` ${JSON.stringify(labels.join(' — '))}`);
  }
  if (element.focused) {
    parts.push(' [focused]');
  }
  if (element.settable) {
    parts.push(' [settable]');
  }
  if (element.frame) {
    parts.push(` @ (${Math.round(element.frame.x)},${Math.round(element.frame.y)}) ${Math.round(element.frame.width)}x${Math.round(element.frame.height)}`);
  }
  if (Array.isArray(element.actions) && element.actions.length > 0) {
    parts.push(` actions=${element.actions.slice(0, 3).join(',')}`);
  }

  return parts.join('');
}

function buildObserveText(target: CurrentTarget, elements: ComputerUseElement[], focusedElementId?: string): string {
  const header = `Captured ${target.appName} — ${target.windowTitle}. Coordinates are window-relative screenshot pixels.`;
  if (elements.length === 0) {
    return `${header}\nNo accessibility elements were found. Fall back to coordinates in this screenshot if needed.`;
  }

  const visibleLimit = 40;
  const shown = elements.slice(0, visibleLimit).map(formatElementSummary).join('\n');
  const focusedLine = focusedElementId ? `Focused element: ${focusedElementId}.\n` : '';
  const moreLine = elements.length > visibleLimit
    ? `\n… ${elements.length - visibleLimit} more accessibility elements not shown.`
    : '';

  return `${header}\n${focusedLine}Accessibility elements (${Math.min(elements.length, visibleLimit)} shown of ${elements.length}):\n${shown}${moreLine}`;
}

function rejectAllPending(error: Error): void {
  for (const [id, pending] of runtimeState.pending) {
    clearTimeout(pending.timer);
    pending.abortListener?.();
    runtimeState.pending.delete(id);
    pending.reject(error);
  }
}

function handleHelperStdoutChunk(chunk: string): void {
  runtimeState.stdoutBuffer += chunk;

  for (;;) {
    const newlineIndex = runtimeState.stdoutBuffer.indexOf('\n');
    if (newlineIndex < 0) {
      break;
    }

    const line = runtimeState.stdoutBuffer.slice(0, newlineIndex).trim();
    runtimeState.stdoutBuffer = runtimeState.stdoutBuffer.slice(newlineIndex + 1);
    if (!line) {
      continue;
    }

    let parsed: Record<string, unknown> | undefined;
    try {
      const candidate = JSON.parse(line) as unknown;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      continue;
    }

    const id = typeof parsed?.id === 'string' ? parsed.id : undefined;
    if (!id) {
      continue;
    }

    const pending = runtimeState.pending.get(id);
    if (!pending) {
      continue;
    }

    runtimeState.pending.delete(id);
    clearTimeout(pending.timer);
    pending.abortListener?.();

    if (parsed.ok === true) {
      pending.resolve(parsed.result);
    } else {
      const message = typeof parsed?.error?.message === 'string'
        ? parsed.error.message
        : `Helper command '${pending.cmd}' failed.`;
      const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : undefined;
      pending.reject(new HelperCommandError(message, code));
    }
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      cleanup();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    const onAbort = () => {
      child.kill('SIGTERM');
      cleanup();
      reject(new Error('Operation aborted.'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error((stderr.trim() || `Command failed (${code}): ${command} ${args.join(' ')}`).trim()));
    });

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function ensureHelperBuilt(signal?: AbortSignal): Promise<void> {
  if (runtimeState.helperBuilt) {
    return;
  }

  const helperExists = await isExecutable(HELPER_PATH);
  let needsBuild = !helperExists;

  if (!needsBuild) {
    try {
      const [helperStats, sourceStats] = await Promise.all([stat(HELPER_PATH), stat(HELPER_SOURCE_PATH)]);
      needsBuild = helperStats.mtimeMs < sourceStats.mtimeMs;
    } catch {
      needsBuild = true;
    }
  }

  if (needsBuild) {
    await mkdir(dirname(HELPER_PATH), { recursive: true });
    await runProcess('xcrun', [
      'swiftc',
      '-O',
      '-framework',
      'Foundation',
      '-framework',
      'AppKit',
      '-framework',
      'ApplicationServices',
      '-framework',
      'ImageIO',
      '-framework',
      'ScreenCaptureKit',
      HELPER_SOURCE_PATH,
      '-o',
      HELPER_PATH,
    ], BUILD_TIMEOUT_MS, signal);

    if (!(await isExecutable(HELPER_PATH))) {
      throw new Error(`Failed to build computer_use helper at ${HELPER_PATH}.`);
    }
  }

  runtimeState.helperBuilt = true;
}

async function startHelper(): Promise<ChildProcessWithoutNullStreams> {
  if (!(await isExecutable(HELPER_PATH))) {
    throw new HelperTransportError(`computer_use helper is missing at ${HELPER_PATH}.`);
  }

  const child = spawn(HELPER_PATH, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stdin.setDefaultEncoding('utf8');

  child.stdout.on('data', (chunk: string) => {
    handleHelperStdoutChunk(chunk);
  });

  child.stderr.on('data', () => {
    // Intentionally keep helper stderr out of tool output.
  });

  child.on('error', (error) => {
    if (runtimeState.helper === child) {
      runtimeState.helper = undefined;
    }
    rejectAllPending(new HelperTransportError(`computer_use helper crashed: ${error.message}`));
  });

  child.on('exit', (code, signal) => {
    if (runtimeState.helper === child) {
      runtimeState.helper = undefined;
    }
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
    rejectAllPending(new HelperTransportError(`computer_use helper exited (${reason}).`));
  });

  runtimeState.helper = child;
  runtimeState.stdoutBuffer = '';
  return child;
}

async function ensureHelperProcess(): Promise<ChildProcessWithoutNullStreams> {
  if (runtimeState.helper && runtimeState.helper.exitCode === null && !runtimeState.helper.killed) {
    return runtimeState.helper;
  }

  return await startHelper();
}

async function helperCommand<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(options?.signal);
    const helper = await ensureHelperProcess();
    const id = `req_${++runtimeState.requestSequence}`;

    try {
      const result = await new Promise<T>((resolve, reject) => {
        const payload = `${JSON.stringify({ id, cmd, ...args })}\n`;
        const timer = setTimeout(() => {
          runtimeState.pending.delete(id);
          reject(new HelperTransportError(`Helper command '${cmd}' timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        const pending: PendingRequest = {
          cmd,
          resolve,
          reject,
          timer,
        };

        const abortListener = () => {
          if (runtimeState.pending.delete(id)) {
            clearTimeout(timer);
            reject(new Error('Operation aborted.'));
          }
        };

        if (options?.signal) {
          options.signal.addEventListener('abort', abortListener, { once: true });
          pending.abortListener = () => options.signal?.removeEventListener('abort', abortListener);
        }

        runtimeState.pending.set(id, pending);

        helper.stdin.write(payload, (error) => {
          if (!error) {
            return;
          }

          const saved = runtimeState.pending.get(id);
          if (!saved) {
            return;
          }

          runtimeState.pending.delete(id);
          clearTimeout(saved.timer);
          saved.abortListener?.();
          reject(new HelperTransportError(`Failed to send helper command '${cmd}': ${error.message}`));
        });
      });

      return result;
    } catch (error) {
      if (error instanceof HelperTransportError && attempt === 0) {
        stopComputerUseHelper();
        continue;
      }

      throw normalizeError(error);
    }
  }

  throw new Error(`Helper command '${cmd}' failed.`);
}

async function checkPermissions(signal?: AbortSignal): Promise<PermissionStatus> {
  return await helperCommand<PermissionStatus>('check_permissions', {}, { signal });
}

async function ensureReady(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await ensureHelperBuilt(signal);
  await ensureHelperProcess();

  const now = Date.now();
  if (!runtimeState.permissionStatus || !runtimeState.permissionCheckedAt || now - runtimeState.permissionCheckedAt > PERMISSION_CACHE_MS) {
    runtimeState.permissionStatus = await checkPermissions(signal);
    runtimeState.permissionCheckedAt = now;
  }

  if (!runtimeState.permissionStatus.accessibility) {
    throw new Error(ACCESSIBILITY_ERROR);
  }
}

async function listApps(signal?: AbortSignal): Promise<HelperApp[]> {
  const result = await helperCommand<unknown>('list_apps', {}, { signal });
  const array = Array.isArray(result) ? result : [];
  return array
    .map((item) => {
      const pid = Math.trunc(toFiniteNumber((item as { pid?: unknown }).pid, NaN));
      if (!Number.isFinite(pid) || pid <= 0) {
        return undefined;
      }

      return {
        appName: typeof (item as { appName?: unknown }).appName === 'string' ? (item as { appName: string }).appName : 'Unknown App',
        bundleId: typeof (item as { bundleId?: unknown }).bundleId === 'string' ? (item as { bundleId: string }).bundleId : undefined,
        pid,
        isFrontmost: (item as { isFrontmost?: unknown }).isFrontmost === true,
      } satisfies HelperApp;
    })
    .filter((item): item is HelperApp => Boolean(item));
}

async function listWindows(pid: number, signal?: AbortSignal): Promise<HelperWindow[]> {
  const result = await helperCommand<unknown>('list_windows', { pid }, { signal });
  const array = Array.isArray(result) ? result : [];
  return array
    .map((item) => {
      const windowId = Math.trunc(toFiniteNumber((item as { windowId?: unknown }).windowId, NaN));
      if (!Number.isFinite(windowId) || windowId <= 0) {
        return undefined;
      }

      return {
        windowId,
        title: typeof (item as { title?: unknown }).title === 'string' ? (item as { title: string }).title : '',
        x: toFiniteNumber((item as { x?: unknown }).x, 0),
        y: toFiniteNumber((item as { y?: unknown }).y, 0),
        width: Math.max(1, toFiniteNumber((item as { width?: unknown }).width, 1)),
        height: Math.max(1, toFiniteNumber((item as { height?: unknown }).height, 1)),
        isOnscreen: (item as { isOnscreen?: unknown }).isOnscreen !== false,
      } satisfies HelperWindow;
    })
    .filter((item): item is HelperWindow => Boolean(item));
}

async function getFrontmost(signal?: AbortSignal): Promise<FrontmostResult> {
  return await helperCommand<FrontmostResult>('get_frontmost', {}, { signal });
}

function normalizeHelperElement(value: unknown): ComputerUseElement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const elementId = typeof record.elementId === 'string' ? record.elementId : undefined;
  if (!elementId) {
    return undefined;
  }

  const normalized: ComputerUseElement = {
    elementId,
  };

  if (typeof record.depth === 'number' && Number.isFinite(record.depth)) {
    normalized.depth = Math.max(0, Math.trunc(record.depth));
  }
  if (typeof record.role === 'string') {
    normalized.role = record.role;
  }
  if (typeof record.subrole === 'string') {
    normalized.subrole = record.subrole;
  }
  if (typeof record.title === 'string') {
    normalized.title = record.title;
  }
  if (typeof record.description === 'string') {
    normalized.description = record.description;
  }
  if (typeof record.value === 'string') {
    normalized.value = record.value;
  }
  if (typeof record.enabled === 'boolean') {
    normalized.enabled = record.enabled;
  }
  if (record.focused === true) {
    normalized.focused = true;
  }
  if (typeof record.settable === 'boolean') {
    normalized.settable = record.settable;
  }
  if (Array.isArray(record.actions)) {
    normalized.actions = record.actions
      .filter((item): item is string => typeof item === 'string')
      .map((item) => sanitizeSummaryText(item) ?? item);
  }
  if (record.frame && typeof record.frame === 'object' && !Array.isArray(record.frame)) {
    const frame = record.frame as Record<string, unknown>;
    if (typeof frame.x === 'number' && typeof frame.y === 'number' && typeof frame.width === 'number' && typeof frame.height === 'number') {
      normalized.frame = {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      };
    }
  }

  return normalized;
}

async function captureWindowState(target: CurrentTarget, includeAccessibility: boolean, signal?: AbortSignal): Promise<HelperCaptureState> {
  const result = await helperCommand<unknown>('capture_window_state', {
    pid: target.pid,
    windowId: target.windowId,
    includeAccessibility,
  }, {
    signal,
    timeoutMs: CAPTURE_TIMEOUT_MS,
  });

  const record = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : {};

  const pngBase64 = typeof record.pngBase64 === 'string' ? record.pngBase64 : undefined;
  const width = Math.max(1, Math.trunc(toFiniteNumber(record.width, 1)));
  const height = Math.max(1, Math.trunc(toFiniteNumber(record.height, 1)));
  if (!pngBase64) {
    throw new Error('computer_use helper returned an invalid screenshot payload.');
  }

  return {
    pngBase64,
    width,
    height,
    snapshotId: typeof record.snapshotId === 'string' ? record.snapshotId : undefined,
    focusedElementId: typeof record.focusedElementId === 'string' ? record.focusedElementId : undefined,
    elements: Array.isArray(record.elements)
      ? record.elements.map(normalizeHelperElement).filter((item): item is ComputerUseElement => Boolean(item))
      : undefined,
  };
}

function updateCurrentState(target: CurrentTarget, capture: CurrentCapture): void {
  runtimeState.currentTarget = target;
  runtimeState.currentCapture = capture;
}

async function resolveCurrentTarget(signal?: AbortSignal): Promise<CurrentTarget> {
  const current = runtimeState.currentTarget;
  if (!current) {
    throw new Error(MISSING_TARGET_ERROR);
  }

  const windows = await listWindows(current.pid, signal);
  if (windows.length === 0) {
    throw new Error(TARGET_GONE_ERROR);
  }

  const exactWindow = windows.find((window) => window.windowId === current.windowId);
  const exactTitle = windows.find((window) => normalizeText(window.title) === normalizeText(current.windowTitle));
  const candidate = exactWindow ?? exactTitle ?? choosePreferredWindow(windows, current.appName);

  const resolved: CurrentTarget = {
    appName: current.appName,
    bundleId: current.bundleId,
    pid: current.pid,
    windowTitle: candidate.title || '(untitled)',
    windowId: candidate.windowId,
  };

  runtimeState.currentTarget = resolved;
  return resolved;
}

async function resolveFrontmostTarget(signal?: AbortSignal): Promise<CurrentTarget> {
  const frontmost = await getFrontmost(signal);
  const apps = await listApps(signal);
  const app = apps.find((item) => item.pid === frontmost.pid) ?? {
    appName: frontmost.appName,
    bundleId: frontmost.bundleId,
    pid: frontmost.pid,
    isFrontmost: true,
  } satisfies HelperApp;

  const windows = await listWindows(frontmost.pid, signal);
  if (windows.length === 0) {
    throw new Error(`No controllable window was found in app '${app.appName}'.`);
  }

  const byId = typeof frontmost.windowId === 'number'
    ? windows.find((window) => window.windowId === frontmost.windowId)
    : undefined;
  const byTitle = frontmost.windowTitle
    ? windows.find((window) => normalizeText(window.title) === normalizeText(frontmost.windowTitle))
    : undefined;
  const selected = byId ?? byTitle ?? choosePreferredWindow(windows, app.appName);

  const target: CurrentTarget = {
    appName: app.appName,
    bundleId: app.bundleId,
    pid: app.pid,
    windowTitle: selected.title || '(untitled)',
    windowId: selected.windowId,
  };

  runtimeState.currentTarget = target;
  return target;
}

async function resolveObserveTarget(input: ComputerUseInput, signal?: AbortSignal): Promise<CurrentTarget> {
  const appQuery = trimOrUndefined(input.app);
  const windowTitleQuery = trimOrUndefined(input.windowTitle);

  if (!appQuery && !windowTitleQuery) {
    if (runtimeState.currentTarget) {
      return await resolveCurrentTarget(signal);
    }

    return await resolveFrontmostTarget(signal);
  }

  const apps = await listApps(signal);

  if (appQuery) {
    const app = chooseAppByQuery(apps, appQuery);
    const windows = await listWindows(app.pid, signal);
    if (windows.length === 0) {
      throw new Error(`No controllable window was found in app '${app.appName}'.`);
    }

    const window = windowTitleQuery
      ? chooseWindowByTitle(windows, windowTitleQuery, app.appName)
      : choosePreferredWindow(windows, app.appName);

    const target: CurrentTarget = {
      appName: app.appName,
      bundleId: app.bundleId,
      pid: app.pid,
      windowTitle: window.title || '(untitled)',
      windowId: window.windowId,
    };
    runtimeState.currentTarget = target;
    return target;
  }

  const query = windowTitleQuery!;
  const matches: Array<{ app: HelperApp; window: HelperWindow }> = [];
  for (const app of apps) {
    const windows = await listWindows(app.pid, signal);
    for (const window of windows) {
      if (normalizeText(window.title).includes(normalizeText(query))) {
        matches.push({ app, window });
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`Window '${query}' was not found in any running app.`);
  }
  if (matches.length > 1) {
    const options = matches.slice(0, 6).map((match) => `${match.app.appName} — ${match.window.title || '(untitled)'}`).join(', ');
    throw new Error(`Window title '${query}' is ambiguous (${options}). Specify app as well.`);
  }

  const match = matches[0]!;
  const target: CurrentTarget = {
    appName: match.app.appName,
    bundleId: match.app.bundleId,
    pid: match.app.pid,
    windowTitle: match.window.title || '(untitled)',
    windowId: match.window.windowId,
  };
  runtimeState.currentTarget = target;
  return target;
}

function randomCaptureId(): string {
  try {
    return randomUUID();
  } catch {
    return `cap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

async function captureTarget(
  target: CurrentTarget,
  action: ComputerUseAction,
  signal: AbortSignal | undefined,
  options?: { includeAccessibility?: boolean },
): Promise<AgentToolResult<ComputerUseDetails>> {
  let image: HelperCaptureState;

  try {
    image = await captureWindowState(target, options?.includeAccessibility === true, signal);
  } catch (error) {
    if (error instanceof HelperCommandError && error.code === 'capture_failed') {
      const permissions = await checkPermissions(signal).catch(() => undefined);
      runtimeState.permissionStatus = permissions;
      runtimeState.permissionCheckedAt = Date.now();
      if (permissions?.screenRecording === false) {
        throw new Error(SCREEN_RECORDING_ERROR);
      }
    }

    throw normalizeHelperActionError(error);
  }

  const capture: CurrentCapture = {
    captureId: randomCaptureId(),
    width: image.width,
    height: image.height,
    timestamp: Date.now(),
    snapshotId: image.snapshotId,
    focusedElementId: image.focusedElementId,
    elements: image.elements,
  };
  updateCurrentState(target, capture);

  const details: ComputerUseDetails = {
    tool: TOOL_NAME,
    action,
    target: {
      app: target.appName,
      bundleId: target.bundleId,
      pid: target.pid,
      windowTitle: target.windowTitle,
      windowId: target.windowId,
    },
    capture: {
      captureId: capture.captureId,
      width: capture.width,
      height: capture.height,
      timestamp: capture.timestamp,
      coordinateSpace: 'window-relative-screenshot-pixels',
    },
  };

  const text = options?.includeAccessibility === true
    ? buildObserveText(target, capture.elements ?? [], capture.focusedElementId)
    : `Updated ${target.appName} — ${target.windowTitle}. Coordinates are window-relative screenshot pixels. Use action='observe' for fresh accessibility element IDs.`;

  if (options?.includeAccessibility === true) {
    details.ui = {
      focusedElementId: capture.focusedElementId,
      elements: capture.elements ?? [],
    };
  }

  return {
    content: [
      { type: 'text', text },
      { type: 'image', data: image.pngBase64, mimeType: 'image/png' },
    ],
    details,
  };
}

function validateCapture(captureId?: string): CurrentCapture {
  const capture = runtimeState.currentCapture;
  if (!runtimeState.currentTarget || !capture) {
    throw new Error(MISSING_TARGET_ERROR);
  }

  if (captureId && capture.captureId !== captureId) {
    throw new Error(STALE_CAPTURE_ERROR);
  }

  return capture;
}

function validateElementTarget(input: ComputerUseInput): { capture: CurrentCapture; snapshotId: string; elementId: string } {
  const capture = validateCapture(input.captureId);
  const elementId = typeof input.elementId === 'string' ? input.elementId.trim() : '';
  if (elementId.length === 0) {
    throw new Error('computer_use element-targeted actions require a non-empty elementId from the latest observe result.');
  }

  if (!capture.snapshotId) {
    throw new Error(MISSING_ELEMENTS_ERROR);
  }

  return {
    capture,
    snapshotId: capture.snapshotId,
    elementId,
  };
}

function ensurePointInCapture(x: number, y: number, capture: CurrentCapture, prefix = 'Coordinates'): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${prefix} must be finite numbers.`);
  }
  if (x < 0 || y < 0 || x >= capture.width || y >= capture.height) {
    throw new Error(`${prefix} (${Math.round(x)},${Math.round(y)}) are outside the latest screenshot bounds (${capture.width}x${capture.height}). Use computer_use with action='observe' to refresh.`);
  }
}

async function runCoordinateAction(
  action: ComputerUseAction,
  capture: CurrentCapture,
  signal: AbortSignal | undefined,
  dispatch: (target: CurrentTarget) => Promise<void>,
): Promise<AgentToolResult<ComputerUseDetails>> {
  const target = currentTargetOrThrow();
  await dispatch(target);
  await sleep(ACTION_SETTLE_MS, signal);
  return await captureTarget(target, action, signal);
}

async function performObserve(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const target = await resolveObserveTarget(input, signal);
  return await captureTarget(target, 'observe', signal, { includeAccessibility: true });
}

async function performClick(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const capture = validateCapture(input.captureId);

  if (input.elementId) {
    const { snapshotId, elementId } = validateElementTarget(input);
    const target = currentTargetOrThrow();
    try {
      await helperCommand('click_element', {
        snapshotId,
        elementId,
        button: input.button ?? 'left',
        clicks: 1,
      }, { signal });
    } catch (error) {
      throw normalizeHelperActionError(error);
    }
    await sleep(ACTION_SETTLE_MS, signal);
    return await captureTarget(target, 'click', signal);
  }

  if (typeof input.x !== 'number' || typeof input.y !== 'number') {
    throw new Error('computer_use click actions require either elementId or numeric x and y.');
  }
  ensurePointInCapture(input.x, input.y, capture);

  return await runCoordinateAction('click', capture, signal, async (target) => {
    await helperCommand('click_window', {
      pid: target.pid,
      windowId: target.windowId,
      x: input.x,
      y: input.y,
      captureWidth: capture.width,
      captureHeight: capture.height,
      button: input.button ?? 'left',
      clicks: 1,
    }, { signal });
  });
}

async function performDoubleClick(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const capture = validateCapture(input.captureId);

  if (input.elementId) {
    const { snapshotId, elementId } = validateElementTarget(input);
    const target = currentTargetOrThrow();
    try {
      await helperCommand('click_element', {
        snapshotId,
        elementId,
        button: 'left',
        clicks: 2,
      }, { signal });
    } catch (error) {
      throw normalizeHelperActionError(error);
    }
    await sleep(ACTION_SETTLE_MS, signal);
    return await captureTarget(target, 'double_click', signal);
  }

  if (typeof input.x !== 'number' || typeof input.y !== 'number') {
    throw new Error('computer_use double_click actions require either elementId or numeric x and y.');
  }
  ensurePointInCapture(input.x, input.y, capture);

  return await runCoordinateAction('double_click', capture, signal, async (target) => {
    await helperCommand('click_window', {
      pid: target.pid,
      windowId: target.windowId,
      x: input.x,
      y: input.y,
      captureWidth: capture.width,
      captureHeight: capture.height,
      button: 'left',
      clicks: 2,
    }, { signal });
  });
}

async function performMove(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const capture = validateCapture(input.captureId);
  if (typeof input.x !== 'number' || typeof input.y !== 'number') {
    throw new Error('computer_use move actions require numeric x and y.');
  }
  ensurePointInCapture(input.x, input.y, capture);

  return await runCoordinateAction('move', capture, signal, async (target) => {
    await helperCommand('move_window_mouse', {
      pid: target.pid,
      windowId: target.windowId,
      x: input.x,
      y: input.y,
      captureWidth: capture.width,
      captureHeight: capture.height,
    }, { signal });
  });
}

async function performDrag(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const capture = validateCapture(input.captureId);
  if (!Array.isArray(input.path) || input.path.length < 2) {
    throw new Error('computer_use drag actions require a path with at least two points.');
  }

  for (const [index, point] of input.path.entries()) {
    ensurePointInCapture(point.x, point.y, capture, `Drag point ${index + 1}`);
  }

  return await runCoordinateAction('drag', capture, signal, async (target) => {
    await helperCommand('drag_window_mouse', {
      pid: target.pid,
      windowId: target.windowId,
      path: input.path,
      captureWidth: capture.width,
      captureHeight: capture.height,
    }, { signal, timeoutMs: Math.max(COMMAND_TIMEOUT_MS, input.path!.length * 150) });
  });
}

async function performScroll(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const capture = validateCapture(input.captureId);
  if (typeof input.x !== 'number' || typeof input.y !== 'number') {
    throw new Error('computer_use scroll actions require numeric x and y.');
  }
  if (typeof input.scrollX !== 'number' || typeof input.scrollY !== 'number') {
    throw new Error('computer_use scroll actions require numeric scrollX and scrollY.');
  }
  ensurePointInCapture(input.x, input.y, capture);

  return await runCoordinateAction('scroll', capture, signal, async (target) => {
    await helperCommand('scroll_window_mouse', {
      pid: target.pid,
      windowId: target.windowId,
      x: input.x,
      y: input.y,
      scrollX: input.scrollX,
      scrollY: input.scrollY,
      captureWidth: capture.width,
      captureHeight: capture.height,
    }, { signal });
  });
}

async function performType(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const text = typeof input.text === 'string' ? input.text : '';
  if (text.length === 0) {
    throw new Error('computer_use type actions require a non-empty text string.');
  }

  const target = currentTargetOrThrow();
  if (input.elementId) {
    const { snapshotId, elementId } = validateElementTarget(input);
    try {
      await helperCommand('set_element_value', {
        snapshotId,
        elementId,
        text,
      }, { signal });
    } catch (error) {
      if (!(error instanceof HelperCommandError) || error.code !== 'value_not_settable') {
        throw normalizeHelperActionError(error);
      }

      try {
        await helperCommand('click_element', {
          snapshotId,
          elementId,
          button: 'left',
          clicks: 1,
        }, { signal });
        await helperCommand('type_text', {
          pid: target.pid,
          text,
        }, { signal, timeoutMs: Math.max(COMMAND_TIMEOUT_MS, text.length * 30 + 2_000) });
      } catch (fallbackError) {
        throw normalizeHelperActionError(fallbackError);
      }
    }
  } else {
    await helperCommand('type_text', {
      pid: target.pid,
      text,
    }, { signal, timeoutMs: Math.max(COMMAND_TIMEOUT_MS, text.length * 30 + 2_000) });
  }

  await sleep(ACTION_SETTLE_MS, signal);
  return await captureTarget(target, 'type', signal);
}

async function performSetValue(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const text = typeof input.text === 'string' ? input.text : '';
  if (text.length === 0) {
    throw new Error('computer_use set_value actions require a non-empty text string.');
  }

  const { snapshotId, elementId } = validateElementTarget(input);
  const target = currentTargetOrThrow();
  try {
    await helperCommand('set_element_value', {
      snapshotId,
      elementId,
      text,
    }, { signal });
  } catch (error) {
    throw normalizeHelperActionError(error);
  }

  await sleep(ACTION_SETTLE_MS, signal);
  return await captureTarget(target, 'set_value', signal);
}

async function performSecondaryAction(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const { snapshotId, elementId } = validateElementTarget(input);
  const target = currentTargetOrThrow();
  try {
    await helperCommand('perform_element_action', {
      snapshotId,
      elementId,
      accessibilityAction: input.accessibilityAction,
    }, { signal });
  } catch (error) {
    throw normalizeHelperActionError(error);
  }

  await sleep(ACTION_SETTLE_MS, signal);
  return await captureTarget(target, 'secondary_action', signal);
}

async function performKeypress(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  const keys = input.keys ?? [];
  if (keys.length === 0) {
    throw new Error('computer_use keypress actions require a non-empty keys array.');
  }

  const target = currentTargetOrThrow();
  await helperCommand('keypress', {
    pid: target.pid,
    keys,
  }, { signal });

  await sleep(ACTION_SETTLE_MS, signal);
  return await captureTarget(target, 'keypress', signal);
}

async function performWait(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  currentTargetOrThrow();

  const ms = typeof input.ms === 'number' && Number.isFinite(input.ms)
    ? Math.max(0, Math.min(60_000, Math.round(input.ms)))
    : DEFAULT_WAIT_MS;

  await sleep(ms, signal);
  const target = currentTargetOrThrow();
  return await captureTarget(target, 'wait', signal);
}

async function performAction(input: ComputerUseInput, signal?: AbortSignal): Promise<AgentToolResult<ComputerUseDetails>> {
  switch (input.action) {
    case 'observe':
      return await performObserve(input, signal);
    case 'click':
      return await performClick(input, signal);
    case 'double_click':
      return await performDoubleClick(input, signal);
    case 'move':
      return await performMove(input, signal);
    case 'drag':
      return await performDrag(input, signal);
    case 'scroll':
      return await performScroll(input, signal);
    case 'type':
      return await performType(input, signal);
    case 'keypress':
      return await performKeypress(input, signal);
    case 'wait':
      return await performWait(input, signal);
    case 'set_value':
      return await performSetValue(input, signal);
    case 'secondary_action':
      return await performSecondaryAction(input, signal);
    default:
      throw new Error(`Unsupported computer_use action '${input.action satisfies never}'.`);
  }
}

function extractStateFromToolResult(details: unknown): { target: CurrentTarget; capture: CurrentCapture } | undefined {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const record = details as Partial<ComputerUseDetails>;
  if (record.tool !== TOOL_NAME || !record.target || !record.capture) {
    return undefined;
  }

  const app = typeof record.target.app === 'string' ? record.target.app : undefined;
  const pid = typeof record.target.pid === 'number' ? Math.trunc(record.target.pid) : NaN;
  const windowId = typeof record.target.windowId === 'number' ? Math.trunc(record.target.windowId) : NaN;
  if (!app || !Number.isFinite(pid) || !Number.isFinite(windowId)) {
    return undefined;
  }
  if (typeof record.capture.captureId !== 'string') {
    return undefined;
  }

  return {
    target: {
      appName: app,
      bundleId: record.target.bundleId,
      pid,
      windowTitle: record.target.windowTitle || '(untitled)',
      windowId,
    },
    capture: {
      captureId: record.capture.captureId,
      width: Math.max(1, Math.trunc(toFiniteNumber(record.capture.width, 1))),
      height: Math.max(1, Math.trunc(toFiniteNumber(record.capture.height, 1))),
      timestamp: Number.isFinite(record.capture.timestamp) ? record.capture.timestamp : Date.now(),
    },
  };
}

export function reconstructStateFromBranch(ctx: Pick<ExtensionContext, 'sessionManager'>): void {
  runtimeState.currentTarget = undefined;
  runtimeState.currentCapture = undefined;

  const branchEntries = ctx.sessionManager.getBranch();
  for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
    const entry = branchEntries[index] as {
      type?: string;
      message?: {
        role?: string;
        toolName?: string;
        details?: unknown;
      };
    };
    if (entry.type !== 'message' || entry.message?.role !== 'toolResult' || entry.message.toolName !== TOOL_NAME) {
      continue;
    }

    const restored = extractStateFromToolResult(entry.message.details);
    if (!restored) {
      continue;
    }

    runtimeState.currentTarget = restored.target;
    runtimeState.currentCapture = restored.capture;
    return;
  }
}

export async function executeComputerUse(
  _toolCallId: string,
  params: ComputerUseInput,
  signal: AbortSignal | undefined,
  _onUpdate: AgentToolUpdateCallback<ComputerUseDetails> | undefined,
  _ctx: ExtensionContext | undefined,
): Promise<AgentToolResult<ComputerUseDetails>> {
  return await withRuntimeLock(async () => {
    await ensureReady(signal);
    throwIfAborted(signal);
    return await performAction(params, signal);
  });
}

export function stopComputerUseHelper(): void {
  rejectAllPending(new HelperTransportError('computer_use helper stopped.'));

  const helper = runtimeState.helper;
  runtimeState.helper = undefined;
  runtimeState.stdoutBuffer = '';
  runtimeState.permissionStatus = undefined;
  runtimeState.permissionCheckedAt = undefined;

  if (helper && helper.exitCode === null && !helper.killed) {
    helper.kill('SIGTERM');
  }
}

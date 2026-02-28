import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import type { Dirent } from 'fs';
import { dirname, join } from 'path';
import type { ModuleLogger } from './types.js';
import type { ResolvedMemoryConfig, SessionScanRecord, SessionScanState } from './memory-types.js';

const SESSION_SCAN_STATE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }

  return `${value.slice(0, maxChars - 3)}...`;
}

function sanitizeFileStem(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (cleaned.length === 0) {
    return 'session';
  }

  return clipText(cleaned, 120);
}

function removeIfExists(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  rmSync(path, { force: true });
  return true;
}

function pruneEmptyDirectories(root: string): void {
  if (!existsSync(root)) {
    return;
  }

  const directories: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    directories.push(current);

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
      }
    }
  }

  directories.sort((a, b) => b.length - a.length);

  for (const directory of directories) {
    if (directory === root) {
      continue;
    }

    try {
      const entries = readdirSync(directory);
      if (entries.length === 0) {
        rmSync(directory, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup failures.
    }
  }
}

export function createEmptyScanState(): SessionScanState {
  return {
    version: SESSION_SCAN_STATE_VERSION,
    sessions: {},
  };
}

export function loadScanState(path: string, logger: ModuleLogger): SessionScanState {
  if (!existsSync(path)) {
    return createEmptyScanState();
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;

    if (!isRecord(parsed)) {
      logger.warn(`memory scan state invalid root at ${path}; rebuilding state`);
      return createEmptyScanState();
    }

    const version = typeof parsed.version === 'number' ? parsed.version : 0;
    const sessionsRaw = isRecord(parsed.sessions) ? parsed.sessions : {};

    if (version !== SESSION_SCAN_STATE_VERSION) {
      logger.warn(`memory scan state version mismatch at ${path}; rebuilding state`);
      return createEmptyScanState();
    }

    const sessions: Record<string, SessionScanRecord> = {};

    for (const [key, value] of Object.entries(sessionsRaw)) {
      if (!isRecord(value)) {
        continue;
      }

      const fingerprint = typeof value.fingerprint === 'string' ? value.fingerprint : undefined;
      const summaryPath = typeof value.summaryPath === 'string' ? value.summaryPath : undefined;
      const workspaceKey = typeof value.workspaceKey === 'string' ? value.workspaceKey : undefined;
      const sessionId = typeof value.sessionId === 'string' ? value.sessionId : undefined;
      const summarizedAt = typeof value.summarizedAt === 'string' ? value.summarizedAt : undefined;

      if (!fingerprint || !summaryPath || !workspaceKey || !sessionId || !summarizedAt) {
        continue;
      }

      sessions[key] = {
        fingerprint,
        summaryPath,
        workspaceKey,
        sessionId,
        summarizedAt,
      };
    }

    return {
      version: SESSION_SCAN_STATE_VERSION,
      sessions,
    };
  } catch (error) {
    logger.warn(`memory scan state read failed at ${path}: ${(error as Error).message}`);
    return createEmptyScanState();
  }
}

export function saveScanState(path: string, state: SessionScanState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function collectFilesRecursive(root: string, extension: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(entryPath);
      }
    }
  }

  files.sort();
  return files;
}

export function toWorkspaceKey(cwd: string): string {
  const normalized = cwd
    .replace(/^[A-Za-z]:/, '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  if (normalized.length === 0) {
    return 'root-workspace';
  }

  const slug = normalized
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  if (slug.length === 0) {
    return 'unknown-workspace';
  }

  return clipText(slug, 120);
}

export function toSummaryPath(summaryDir: string, workspaceKey: string, sessionId: string): string {
  return join(summaryDir, workspaceKey, `${sanitizeFileStem(sessionId)}.md`);
}

export function toFingerprint(size: number, mtimeMs: number): string {
  return `${size}:${Math.floor(mtimeMs)}`;
}

export function writeSummaryFile(path: string, markdown: string): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const normalized = markdown.trimEnd();

  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf-8').trimEnd();
    if (existing === normalized) {
      return false;
    }
  }

  writeFileSync(path, `${normalized}\n`);
  return true;
}

export function cleanupRetention(
  config: ResolvedMemoryConfig,
  scanState: SessionScanState,
  nowMs: number,
): number {
  if (config.retentionDays <= 0) {
    return 0;
  }

  const cutoffMs = nowMs - config.retentionDays * DAY_MS;
  let removedFiles = 0;

  const markdownFiles = collectFilesRecursive(config.summaryDir, '.md');

  for (const file of markdownFiles) {
    let mtimeMs = 0;

    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      continue;
    }

    if (mtimeMs > cutoffMs) {
      continue;
    }

    if (removeIfExists(file)) {
      removedFiles += 1;
    }
  }

  for (const [sessionFile, record] of Object.entries(scanState.sessions)) {
    const summaryPath = record.summaryPath;

    if (!existsSync(summaryPath)) {
      delete scanState.sessions[sessionFile];
      continue;
    }

    let mtimeMs = 0;

    try {
      mtimeMs = statSync(summaryPath).mtimeMs;
    } catch {
      delete scanState.sessions[sessionFile];
      continue;
    }

    if (mtimeMs > cutoffMs) {
      continue;
    }

    if (removeIfExists(summaryPath)) {
      removedFiles += 1;
    }

    delete scanState.sessions[sessionFile];
  }

  pruneEmptyDirectories(config.summaryDir);
  return removedFiles;
}

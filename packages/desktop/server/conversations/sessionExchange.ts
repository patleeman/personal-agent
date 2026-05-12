import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

import { getDurableSessionsDir, getStateRoot } from '@personal-agent/core';

import { invalidateAppTopics } from '../shared/appEvents.js';
import { clearSessionCaches, listSessions, readSessionMeta } from './sessions.js';

interface RawSessionHeader {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
}

export interface ExportConversationSessionResult {
  ok: true;
  conversationId: string;
  exportPath: string;
}

export interface ImportConversationSessionResult {
  ok: true;
  conversationId: string;
  sessionFile: string;
  importedAsNewId: boolean;
}

function createSafeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sanitizeFileStem(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'session';
}

function cwdToSlug(cwd: string): string {
  return `--${cwd.replace(/^[\\/]/, '').replace(/[\\/:]/g, '-')}--`;
}

function readSessionHeader(filePath: string): RawSessionHeader {
  const firstLine = readFileSync(filePath, 'utf-8').split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) {
    throw new Error('Session file is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    throw new Error('Session file does not start with valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Session file header is not an object.');
  }

  const header = parsed as RawSessionHeader;
  if (header.type !== 'session' || typeof header.id !== 'string' || header.id.trim().length === 0) {
    throw new Error('Session file must start with a session record.');
  }

  return header;
}

function rewriteSessionId(content: string, nextSessionId: string): string {
  const [firstLine = '', ...rest] = content.split(/\r?\n/);
  const header = JSON.parse(firstLine) as Record<string, unknown>;
  header.id = nextSessionId;
  return `${[JSON.stringify(header), ...rest].join('\n').replace(/\n*$/, '')}\n`;
}

function readExistingSessionIds(): Set<string> {
  clearSessionCaches();
  return new Set(listSessions().map((session) => session.id));
}

export function exportConversationSession(input: { conversationId?: unknown; sessionTitle?: unknown }): ExportConversationSessionResult {
  const conversationId = typeof input.conversationId === 'string' ? input.conversationId.trim() : '';
  if (!conversationId) {
    throw new Error('Conversation id is required.');
  }

  const meta = readSessionMeta(conversationId);
  if (!meta) {
    throw new Error(`Conversation ${conversationId} not found.`);
  }

  const exportDir = join(getStateRoot(), 'exports', 'sessions');
  mkdirSync(exportDir, { recursive: true });

  const title = typeof input.sessionTitle === 'string' && input.sessionTitle.trim() ? input.sessionTitle : meta.title;
  const exportPath = join(exportDir, `${sanitizeFileStem(title)}-${conversationId}-${createSafeTimestamp()}.jsonl`);
  copyFileSync(meta.file, exportPath);

  return { ok: true, conversationId, exportPath };
}

export function importConversationSession(input: { filePath?: unknown }): ImportConversationSessionResult {
  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : '';
  if (!filePath) {
    throw new Error('Session file path is required.');
  }
  if (!existsSync(filePath)) {
    throw new Error(`Session file does not exist: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (ext !== '.jsonl') {
    throw new Error('Session import currently expects a .jsonl session file.');
  }

  const header = readSessionHeader(filePath);
  const originalSessionId = String(header.id).trim();
  const existingIds = readExistingSessionIds();
  const importedAsNewId = existingIds.has(originalSessionId);
  const conversationId = importedAsNewId ? randomUUID() : originalSessionId;
  const cwd = typeof header.cwd === 'string' && header.cwd.trim().length > 0 ? header.cwd.trim() : process.cwd();

  const destinationDir = join(getDurableSessionsDir(), cwdToSlug(cwd));
  mkdirSync(destinationDir, { recursive: true });

  const sourceStem = sanitizeFileStem(basename(filePath, ext));
  let destinationPath = join(destinationDir, `${sourceStem}.jsonl`);
  if (existsSync(destinationPath)) {
    destinationPath = join(destinationDir, `${sourceStem}-${createSafeTimestamp()}.jsonl`);
  }

  if (importedAsNewId) {
    const rewritten = rewriteSessionId(readFileSync(filePath, 'utf-8'), conversationId);
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, rewritten, 'utf-8');
  } else {
    copyFileSync(filePath, destinationPath);
  }

  clearSessionCaches();
  invalidateAppTopics('sessions');

  return { ok: true, conversationId, sessionFile: destinationPath, importedAsNewId };
}

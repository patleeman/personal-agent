import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import { getDurableSessionsDir, getPiAgentRuntimeDir } from './runtime/paths.js';

export interface StoredSessionMeta {
  id: string;
  file: string;
  timestamp: string;
  cwd: string;
  workspaceCwd?: string | null;
  cwdSlug: string;
  model: string;
  title: string;
  messageCount: number;
  lastActivityAt: string;
  remoteHostId?: string;
  remoteHostLabel?: string;
  remoteConversationId?: string;
}

interface RawSessionRecord {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
  remoteHostId?: string;
  remoteHostLabel?: string;
  remoteConversationId?: string;
}

interface RawModelChange {
  type: 'model_change';
  modelId?: string;
}

interface RawSessionInfo {
  type: 'session_info';
  name?: string;
}

interface RawCustomEntry {
  type: 'custom';
  customType?: string;
  data?: unknown;
}

interface RawContentBlock {
  type: 'text' | 'image';
  text?: string;
}

interface RawMessage {
  type: 'message';
  timestamp: string;
  message: {
    role: 'user' | 'assistant' | 'toolResult';
    content: string | RawContentBlock[];
  };
}

type RawLine = RawSessionRecord | RawModelChange | RawSessionInfo | RawCustomEntry | RawMessage | { type: string };

const CONVERSATION_WORKSPACE_METADATA_CUSTOM_TYPE = 'personal_agent_conversation_workspace';

interface ConversationWorkspaceMetadata {
  cwd?: string;
  workspaceCwd?: string | null;
}

function resolveDefaultSessionsDir(): string {
  return getDurableSessionsDir();
}

function parseJsonLine(rawLine: string): RawLine | null {
  try {
    return JSON.parse(rawLine) as RawLine;
  } catch {
    return null;
  }
}

function normalizeContent(content: unknown): RawContentBlock[] {
  if (Array.isArray(content)) {
    return content as RawContentBlock[];
  }

  if (typeof content === 'string' && content.length > 0) {
    return [{ type: 'text', text: content }];
  }

  return [];
}

function extractUserTitle(content: unknown): string | null {
  const blocks = normalizeContent(content);
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();

  if (text.length > 0) {
    return text.slice(0, 80).replace(/\n/g, ' ').trim();
  }

  const imageCount = blocks.filter((block) => block.type === 'image').length;
  if (imageCount > 0) {
    return imageCount === 1 ? '(image attachment)' : `(${imageCount} image attachments)`;
  }

  return null;
}

function normalizeSessionName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }

  const normalized = name.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function isNeutralChatWorkspaceCwd(cwd: string): boolean {
  const normalized = cwd.trim();
  if (!normalized) {
    return false;
  }

  const chatWorkspacesRoot = join(getPiAgentRuntimeDir(), 'chat-workspaces');
  return normalized === chatWorkspacesRoot || normalized.startsWith(`${chatWorkspacesRoot}${sep}`);
}

function normalizeWorkspaceCwdValue(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readConversationWorkspaceMetadata(line: RawCustomEntry): ConversationWorkspaceMetadata | null {
  if (line.customType !== CONVERSATION_WORKSPACE_METADATA_CUSTOM_TYPE || !line.data || typeof line.data !== 'object') {
    return null;
  }

  const data = line.data as Record<string, unknown>;
  const cwd = typeof data.cwd === 'string' && data.cwd.trim().length > 0 ? data.cwd.trim() : undefined;
  const workspaceCwd = normalizeWorkspaceCwdValue(data.workspaceCwd);

  if (cwd === undefined && workspaceCwd === undefined) {
    return null;
  }

  return {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(workspaceCwd !== undefined ? { workspaceCwd } : {}),
  };
}

function slugToCwd(slug: string): string {
  return slug
    .replace(/^--/, '')
    .replace(/--$/, '')
    .replace(/-/g, '/');
}

function normalizeIsoTimestamp(timestamp: string | undefined, fallback: string): string {
  if (timestamp && Number.isFinite(Date.parse(timestamp))) {
    return new Date(Date.parse(timestamp)).toISOString();
  }

  return fallback;
}

function listSessionFiles(sessionsDir: string): Array<{ filePath: string; cwdSlug: string }> {
  if (!existsSync(sessionsDir)) {
    return [];
  }

  const files: Array<{ filePath: string; cwdSlug: string }> = [];

  for (const entryName of readdirSync(sessionsDir)) {
    const entryPath = join(sessionsDir, entryName);

    try {
      const stats = statSync(entryPath);
      if (stats.isFile()) {
        if (entryName.endsWith('.jsonl')) {
          files.push({ filePath: entryPath, cwdSlug: '' });
        }
        continue;
      }

      if (!stats.isDirectory()) {
        continue;
      }

      for (const fileName of readdirSync(entryPath)) {
        if (!fileName.endsWith('.jsonl')) {
          continue;
        }

        files.push({ filePath: join(entryPath, fileName), cwdSlug: entryName });
      }
    } catch {
      continue;
    }
  }

  return files;
}

function readSessionMetaFromFile(filePath: string, cwdSlug: string): StoredSessionMeta | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    let sessionRecord: RawSessionRecord | null = null;
    let model = 'unknown';
    let fallbackTitle: string | null = null;
    let namedTitle: string | null = null;
    let sawSessionInfo = false;
    let messageCount = 0;
    let lastMessageTimestamp: string | undefined;
    let workspaceMetadata: ConversationWorkspaceMetadata | null = null;

    for (const rawLine of raw.split('\n')) {
      if (!rawLine.trim()) {
        continue;
      }

      const line = parseJsonLine(rawLine);
      if (!line) {
        continue;
      }

      if (line.type === 'session') {
        sessionRecord = line as RawSessionRecord;
        continue;
      }

      if (line.type === 'model_change' && model === 'unknown') {
        model = (line as RawModelChange).modelId ?? 'unknown';
        continue;
      }

      if (line.type === 'session_info') {
        sawSessionInfo = true;
        namedTitle = normalizeSessionName((line as RawSessionInfo).name);
        continue;
      }

      if (line.type === 'custom') {
        workspaceMetadata = readConversationWorkspaceMetadata(line as RawCustomEntry) ?? workspaceMetadata;
        continue;
      }

      if (line.type !== 'message') {
        continue;
      }

      const message = line as RawMessage;
      messageCount += 1;
      lastMessageTimestamp = message.timestamp;

      if (fallbackTitle === null && message.message.role === 'user') {
        fallbackTitle = extractUserTitle(message.message.content);
      }
    }

    if (!sessionRecord) {
      return null;
    }

    const fallbackTimestamp = normalizeIsoTimestamp(sessionRecord.timestamp, new Date(statSync(filePath).mtimeMs).toISOString());
    const remoteHostId = typeof sessionRecord.remoteHostId === 'string' && sessionRecord.remoteHostId.trim().length > 0
      ? sessionRecord.remoteHostId.trim()
      : null;
    const remoteHostLabel = typeof sessionRecord.remoteHostLabel === 'string' && sessionRecord.remoteHostLabel.trim().length > 0
      ? sessionRecord.remoteHostLabel.trim()
      : null;
    const remoteConversationId = typeof sessionRecord.remoteConversationId === 'string' && sessionRecord.remoteConversationId.trim().length > 0
      ? sessionRecord.remoteConversationId.trim()
      : null;

    const headerCwd = sessionRecord.cwd ?? slugToCwd(cwdSlug);
    const cwd = workspaceMetadata?.cwd ?? headerCwd;
    const workspaceCwd = workspaceMetadata && 'workspaceCwd' in workspaceMetadata
      ? workspaceMetadata.workspaceCwd ?? null
      : isNeutralChatWorkspaceCwd(cwd)
        ? null
        : undefined;

    return {
      id: sessionRecord.id,
      file: filePath,
      timestamp: fallbackTimestamp,
      cwd,
      ...(workspaceCwd !== undefined ? { workspaceCwd } : {}),
      cwdSlug,
      model,
      title: (sawSessionInfo ? namedTitle : null) ?? fallbackTitle ?? 'New Conversation',
      messageCount,
      lastActivityAt: normalizeIsoTimestamp(lastMessageTimestamp, fallbackTimestamp),
      ...(remoteHostId ? { remoteHostId } : {}),
      ...(remoteHostLabel ? { remoteHostLabel } : {}),
      ...(remoteConversationId ? { remoteConversationId } : {}),
    };
  } catch {
    return null;
  }
}

export function listStoredSessions(options: { sessionsDir?: string } = {}): StoredSessionMeta[] {
  const sessionsDir = options.sessionsDir ?? resolveDefaultSessionsDir();
  const metas = listSessionFiles(sessionsDir)
    .map(({ filePath, cwdSlug }) => readSessionMetaFromFile(filePath, cwdSlug))
    .filter((meta): meta is StoredSessionMeta => meta !== null);

  metas.sort((left, right) => {
    const timestampCompare = right.lastActivityAt.localeCompare(left.lastActivityAt);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }

    return right.id.localeCompare(left.id);
  });

  return metas;
}

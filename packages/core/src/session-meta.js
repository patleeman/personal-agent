import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import { getDurableSessionsDir, getPiAgentRuntimeDir } from './runtime/paths.js';
const CONVERSATION_WORKSPACE_METADATA_CUSTOM_TYPE = 'personal_agent_conversation_workspace';
function resolveDefaultSessionsDir() {
  return getDurableSessionsDir();
}
function parseJsonLine(rawLine) {
  try {
    return JSON.parse(rawLine);
  } catch {
    return null;
  }
}
function normalizeContent(content) {
  if (Array.isArray(content)) {
    return content;
  }
  if (typeof content === 'string' && content.length > 0) {
    return [{ type: 'text', text: content }];
  }
  return [];
}
function extractUserTitle(content) {
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
function normalizeSessionName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}
function isNeutralChatWorkspaceCwd(cwd) {
  const normalized = cwd.trim();
  if (!normalized) {
    return false;
  }
  const chatWorkspacesRoot = join(getPiAgentRuntimeDir(), 'chat-workspaces');
  return normalized === chatWorkspacesRoot || normalized.startsWith(`${chatWorkspacesRoot}${sep}`);
}
function normalizeWorkspaceCwdValue(value) {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
function readConversationWorkspaceMetadata(line) {
  if (line.customType !== CONVERSATION_WORKSPACE_METADATA_CUSTOM_TYPE || !line.data || typeof line.data !== 'object') {
    return null;
  }
  const data = line.data;
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
function slugToCwd(slug) {
  return slug.replace(/^--/, '').replace(/--$/, '').replace(/-/g, '/');
}
function normalizeIsoTimestamp(timestamp, fallback) {
  if (timestamp && Number.isFinite(Date.parse(timestamp))) {
    return new Date(Date.parse(timestamp)).toISOString();
  }
  return fallback;
}
function listSessionFiles(sessionsDir) {
  if (!existsSync(sessionsDir)) {
    return [];
  }
  const files = [];
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
function readSessionMetaFromFile(filePath, cwdSlug) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    let sessionRecord = null;
    let model = 'unknown';
    let fallbackTitle = null;
    let namedTitle = null;
    let sawSessionInfo = false;
    let messageCount = 0;
    let lastMessageTimestamp;
    let workspaceMetadata = null;
    for (const rawLine of raw.split('\n')) {
      if (!rawLine.trim()) {
        continue;
      }
      const line = parseJsonLine(rawLine);
      if (!line) {
        continue;
      }
      if (line.type === 'session') {
        sessionRecord = line;
        continue;
      }
      if (line.type === 'model_change' && model === 'unknown') {
        model = line.modelId ?? 'unknown';
        continue;
      }
      if (line.type === 'session_info') {
        sawSessionInfo = true;
        namedTitle = normalizeSessionName(line.name);
        continue;
      }
      if (line.type === 'custom') {
        workspaceMetadata = readConversationWorkspaceMetadata(line) ?? workspaceMetadata;
        continue;
      }
      if (line.type !== 'message') {
        continue;
      }
      const message = line;
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
    const headerCwd = sessionRecord.cwd ?? slugToCwd(cwdSlug);
    const cwd = workspaceMetadata?.cwd ?? headerCwd;
    const workspaceCwd =
      workspaceMetadata && 'workspaceCwd' in workspaceMetadata
        ? (workspaceMetadata.workspaceCwd ?? null)
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
    };
  } catch {
    return null;
  }
}
export function listStoredSessions(options = {}) {
  const sessionsDir = options.sessionsDir ?? resolveDefaultSessionsDir();
  const metas = listSessionFiles(sessionsDir)
    .map(({ filePath, cwdSlug }) => readSessionMetaFromFile(filePath, cwdSlug))
    .filter((meta) => meta !== null);
  metas.sort((left, right) => {
    const timestampCompare = right.lastActivityAt.localeCompare(left.lastActivityAt);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }
    return right.id.localeCompare(left.id);
  });
  return metas;
}

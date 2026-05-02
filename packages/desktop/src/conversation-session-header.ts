import { readFileSync, writeFileSync } from 'node:fs';

export interface SessionHeaderRecord {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
  version?: number;
  parentSession?: string;
  remoteHostId?: string;
  remoteHostLabel?: string;
  remoteConversationId?: string;
}

export function readSessionHeader(filePath: string): { lines: string[]; headerIndex: number; header: SessionHeaderRecord } {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) {
    throw new Error(`Conversation header missing in ${filePath}`);
  }

  const parsed = JSON.parse(lines[headerIndex] ?? '') as Partial<SessionHeaderRecord>;
  if (
    parsed.type !== 'session' ||
    typeof parsed.id !== 'string' ||
    typeof parsed.timestamp !== 'string' ||
    typeof parsed.cwd !== 'string'
  ) {
    throw new Error(`Conversation header missing in ${filePath}`);
  }

  return {
    lines,
    headerIndex,
    header: parsed as SessionHeaderRecord,
  };
}

export function writeSessionHeader(filePath: string, header: SessionHeaderRecord, lines: string[], headerIndex: number): void {
  lines[headerIndex] = JSON.stringify(header);
  writeFileSync(filePath, `${lines.filter((line) => line.length > 0).join('\n')}\n`, 'utf-8');
}

export function setSessionRemoteTarget(
  filePath: string,
  input: {
    remoteHostId: string;
    remoteHostLabel?: string;
    remoteConversationId: string;
  },
): void {
  const { lines, headerIndex, header } = readSessionHeader(filePath);
  writeSessionHeader(
    filePath,
    {
      ...header,
      remoteHostId: input.remoteHostId,
      ...(input.remoteHostLabel ? { remoteHostLabel: input.remoteHostLabel } : {}),
      remoteConversationId: input.remoteConversationId,
    },
    lines,
    headerIndex,
  );
}

export function clearSessionRemoteTarget(filePath: string): void {
  const { lines, headerIndex, header } = readSessionHeader(filePath);
  const nextHeader = { ...header };
  delete nextHeader.remoteHostId;
  delete nextHeader.remoteHostLabel;
  delete nextHeader.remoteConversationId;
  writeSessionHeader(filePath, nextHeader, lines, headerIndex);
}

export function setSessionCwd(filePath: string, cwd: string): void {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) {
    return;
  }

  const { lines, headerIndex, header } = readSessionHeader(filePath);
  if (header.cwd === normalizedCwd) {
    return;
  }

  writeSessionHeader(
    filePath,
    {
      ...header,
      cwd: normalizedCwd,
    },
    lines,
    headerIndex,
  );
}

export function stripRemoteMetadataFromSessionContent(content: string): string {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) {
    return content;
  }

  try {
    const parsed = JSON.parse(lines[headerIndex] ?? '') as Partial<SessionHeaderRecord>;
    if (parsed.type !== 'session') {
      return content;
    }

    delete parsed.remoteHostId;
    delete parsed.remoteHostLabel;
    delete parsed.remoteConversationId;
    lines[headerIndex] = JSON.stringify(parsed);
    return `${lines.filter((line) => line.length > 0).join('\n')}\n`;
  } catch {
    return content;
  }
}

export function applyRemoteMetadataToSessionContent(
  content: string,
  input: {
    remoteHostId: string;
    remoteHostLabel?: string;
    remoteConversationId: string;
    overrideConversationId?: string;
    overrideCwd?: string;
  },
): string {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) {
    return content;
  }

  try {
    const parsed = JSON.parse(lines[headerIndex] ?? '') as Partial<SessionHeaderRecord>;
    if (parsed.type !== 'session') {
      return content;
    }

    const nextHeader: Partial<SessionHeaderRecord> = {
      ...parsed,
      ...(input.overrideConversationId ? { id: input.overrideConversationId } : {}),
      ...(input.overrideCwd ? { cwd: input.overrideCwd } : {}),
      remoteHostId: input.remoteHostId,
      ...(input.remoteHostLabel ? { remoteHostLabel: input.remoteHostLabel } : {}),
      remoteConversationId: input.remoteConversationId,
    };
    lines[headerIndex] = JSON.stringify(nextHeader);
    return `${lines.filter((line) => line.length > 0).join('\n')}\n`;
  } catch {
    return content;
  }
}

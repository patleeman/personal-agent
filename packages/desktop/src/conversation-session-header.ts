interface SessionHeaderRecord {
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

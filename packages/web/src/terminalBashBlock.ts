import type { MessageBlock } from './types';

export const TERMINAL_BASH_DISPLAY_MODE = 'terminal';

export interface TerminalBashToolPresentation {
  command: string;
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  excludeFromContext: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTerminalDisplayMode(value: Record<string, unknown> | null): boolean {
  return value?.displayMode === TERMINAL_BASH_DISPLAY_MODE;
}

function readTrimmedString(value: Record<string, unknown> | null, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

function readNumber(value: Record<string, unknown> | null, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

function readBoolean(value: Record<string, unknown> | null, key: string): boolean {
  return value?.[key] === true;
}

export function readTerminalBashToolPresentation(
  block: MessageBlock | null | undefined,
): TerminalBashToolPresentation | null {
  if (!block || block.type !== 'tool_use' || block.tool !== 'bash') {
    return null;
  }

  const input = isRecord(block.input) ? block.input : null;
  const details = isRecord(block.details) ? block.details : null;
  if (!hasTerminalDisplayMode(details) && !hasTerminalDisplayMode(input)) {
    return null;
  }

  const command = readTrimmedString(input, 'command') ?? readTrimmedString(details, 'command');
  if (!command) {
    return null;
  }

  return {
    command,
    exitCode: readNumber(details, 'exitCode'),
    cancelled: readBoolean(details, 'cancelled'),
    truncated: readBoolean(details, 'truncated'),
    fullOutputPath: readTrimmedString(details, 'fullOutputPath'),
    excludeFromContext: readBoolean(details, 'excludeFromContext') || readBoolean(input, 'excludeFromContext'),
  };
}

export function isTerminalBashToolBlock(
  block: MessageBlock | null | undefined,
): block is Extract<MessageBlock, { type: 'tool_use' }> {
  return readTerminalBashToolPresentation(block) !== null;
}

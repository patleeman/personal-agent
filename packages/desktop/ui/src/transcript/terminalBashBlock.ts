import type { MessageBlock } from '../shared/types';

const TERMINAL_BASH_DISPLAY_MODE = 'terminal';

interface TerminalBashToolPresentation {
  command: string;
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  excludeFromContext: boolean;
  executionWrappers: Array<{ id: string; label?: string }>;
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

function readInteger(value: Record<string, unknown> | null, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) ? candidate : undefined;
}

function readBoolean(value: Record<string, unknown> | null, key: string): boolean {
  return value?.[key] === true;
}

function readExecutionWrappers(value: Record<string, unknown> | null): Array<{ id: string; label?: string }> {
  const candidate = value?.executionWrappers;
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = readTrimmedString(item, 'id');
    if (!id) return [];
    const label = readTrimmedString(item, 'label');
    return [{ id, ...(label ? { label } : {}) }];
  });
}

export function readTerminalBashToolPresentation(block: MessageBlock | null | undefined): TerminalBashToolPresentation | null {
  if (!block || block.type !== 'tool_use' || (block.tool !== 'bash' && block.tool !== 'background_command')) {
    return null;
  }

  const input = isRecord(block.input) ? block.input : null;
  const details = isRecord(block.details) ? block.details : null;
  const isBackgroundCommandStart = block.tool === 'background_command' && (details?.action === 'start' || input?.action === 'start');
  if (!hasTerminalDisplayMode(details) && !hasTerminalDisplayMode(input) && !isBackgroundCommandStart) {
    return null;
  }

  const command = readTrimmedString(input, 'command') ?? readTrimmedString(details, 'command');
  if (!command) {
    return null;
  }

  return {
    command,
    exitCode: readInteger(details, 'exitCode'),
    cancelled: readBoolean(details, 'cancelled'),
    truncated: readBoolean(details, 'truncated'),
    fullOutputPath: readTrimmedString(details, 'fullOutputPath'),
    excludeFromContext: readBoolean(details, 'excludeFromContext') || readBoolean(input, 'excludeFromContext'),
    executionWrappers: readExecutionWrappers(details).concat(
      readExecutionWrappers(input).filter((wrapper) => !readExecutionWrappers(details).some((item) => item.id === wrapper.id)),
    ),
  };
}

export function isTerminalBashToolBlock(block: MessageBlock | null | undefined): block is Extract<MessageBlock, { type: 'tool_use' }> {
  return readTerminalBashToolPresentation(block) !== null;
}

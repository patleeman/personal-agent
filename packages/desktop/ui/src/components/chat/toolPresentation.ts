import type { MessageBlock } from '../../shared/types';

// ── Tool icon & color ─────────────────────────────────────────────────────────

const TOOL_META: Record<
  string,
  { icon: string; label: string; color: string; tone: 'steel' | 'teal' | 'accent' | 'success' | 'warning' | 'muted' }
> = {
  bash: { icon: '$', label: 'bash', color: 'text-steel bg-steel/5', tone: 'steel' },
  read: { icon: '≡', label: 'read', color: 'text-teal bg-teal/5', tone: 'teal' },
  write: { icon: '✎', label: 'write', color: 'text-accent bg-accent/5', tone: 'accent' },
  edit: { icon: '✎', label: 'edit', color: 'text-accent bg-accent/5', tone: 'accent' },
  web_fetch: { icon: '⌕', label: 'web_fetch', color: 'text-success bg-success/5', tone: 'success' },
  exa_search: { icon: '⌕', label: 'exa_search', color: 'text-success bg-success/5', tone: 'success' },
  duckduckgo_search: { icon: '⌕', label: 'duckduckgo_search', color: 'text-success bg-success/5', tone: 'success' },
  image: { icon: '◌', label: 'image', color: 'text-accent bg-accent/5', tone: 'accent' },
  screenshot: { icon: '⊡', label: 'screenshot', color: 'text-secondary bg-elevated', tone: 'muted' },
  artifact: { icon: '◫', label: 'artifact', color: 'text-accent bg-accent/5', tone: 'accent' },
  checkpoint: { icon: '✓', label: 'checkpoint', color: 'text-success bg-success/5', tone: 'success' },
  ask_user_question: { icon: '?', label: 'question', color: 'text-warning bg-warning/5', tone: 'warning' },
  change_working_directory: { icon: '↗', label: 'cwd', color: 'text-teal bg-teal/5', tone: 'teal' },
  deferred_resume: { icon: '⏰', label: 'deferred_resume', color: 'text-warning bg-warning/5', tone: 'warning' },
};
export function toolMeta(t: string) {
  return TOOL_META[t] ?? { icon: '⚙', label: t, color: 'text-secondary bg-elevated', tone: 'muted' as const };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isBackgroundShellStart(block: Extract<MessageBlock, { type: 'tool_use' }>): boolean {
  const input = isRecord(block.input) ? block.input : null;
  const details = isRecord(block.details) ? block.details : null;

  if (block.tool === 'bash') {
    return input?.background === true || details?.background === true;
  }

  return block.tool === 'background_command' && (input?.action === 'start' || details?.action === 'start');
}

export type DisclosurePreference = 'auto' | 'open' | 'closed';

export function resolveDisclosureOpen(autoOpen: boolean, preference: DisclosurePreference): boolean {
  if (preference === 'open') return true;
  if (preference === 'closed') return false;
  return autoOpen;
}

export function toggleDisclosurePreference(autoOpen: boolean, preference: DisclosurePreference): DisclosurePreference {
  // When autoOpen opened the item and the user clicks without having
  // expressed a preference, make the open preference explicit instead of
  // toggling to closed. This way clicking on an auto-opened tool/thinking
  // block to "look at it" keeps it open, and the user can still close it
  // with a second click.
  if (preference === 'auto' && autoOpen) {
    return 'open';
  }

  return resolveDisclosureOpen(autoOpen, preference) ? 'closed' : 'open';
}

export function shouldAutoOpenTraceCluster(live: boolean, hasRunning: boolean): boolean {
  return live || hasRunning;
}

export function shouldAutoOpenConversationBlock(block: MessageBlock, index: number, total: number, isStreaming: boolean): boolean {
  if (block.type === 'tool_use') {
    return block.status === 'running' || !!block.running;
  }

  if (block.type === 'thinking') {
    return isStreaming && index === total - 1;
  }

  return false;
}

export function getStreamingStatusLabel(messages: MessageBlock[], isStreaming: boolean): string | null {
  if (!isStreaming) {
    return null;
  }

  const last = messages[messages.length - 1];
  if (!last) {
    return 'Working…';
  }

  switch (last.type) {
    case 'thinking':
      return 'Thinking…';
    case 'tool_use':
      return last.status === 'running' || !!last.running ? `Running ${toolMeta(last.tool).label}…` : 'Working…';
    case 'subagent':
      return last.status === 'running' ? `Running ${last.name}…` : 'Working…';
    case 'text':
      return 'Responding…';
    default:
      return 'Working…';
  }
}

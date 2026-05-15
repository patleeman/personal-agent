import type { NavigateFunction } from 'react-router-dom';

import { recordRendererTelemetry } from '../telemetry/appTelemetry';
import type { ExtensionCommandRegistration } from './types';

export type ExtensionCommandArgs = Record<string, unknown> | undefined;
export type ExtensionCommandContextValue = string | number | boolean | null | undefined;
export type ExtensionCommandContext = Record<string, ExtensionCommandContextValue>;

export interface HostCommandDefinition {
  id: string;
  title: string;
  category?: string;
  argsSchema?: Record<string, unknown>;
  execute(args: ExtensionCommandArgs): boolean | Promise<boolean>;
  canExecute?(args: ExtensionCommandArgs, context: ExtensionCommandContext): boolean;
}

export interface ExtensionCommandExecutorOptions {
  navigate: NavigateFunction;
  openCommandPalette(scope?: string): void;
  openRightRail(target: string): boolean;
  setLayout(mode: 'compact' | 'workbench'): void;
  focusComposer?(): void;
  focusSidebar?(): void;
  focusNext?(): void;
  focusPrevious?(): void;
  activateSelection?(): void;
  navigateConversation?(direction: 'next' | 'previous'): boolean;
  activeConversationId?: string | null;
  extensionCommands?: ExtensionCommandRegistration[];
  invokeExtensionCommand?(command: ExtensionCommandRegistration, args: unknown): Promise<unknown>;
  context?: ExtensionCommandContext;
}

const extensionCommandContext = new Map<string, ExtensionCommandContextValue>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringArg(args: ExtensionCommandArgs, key: string): string | null {
  const value = asRecord(args)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readContextValue(context: ExtensionCommandContext, key: string): ExtensionCommandContextValue {
  return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : extensionCommandContext.get(key);
}

export function setExtensionCommandContext(key: string, value: ExtensionCommandContextValue): void {
  if (!key.trim()) return;
  if (value === undefined || value === null) extensionCommandContext.delete(key);
  else extensionCommandContext.set(key, value);
  window.dispatchEvent(new CustomEvent('pa-extension-command-context-changed', { detail: { key, value } }));
}

export function getExtensionCommandContext(): ExtensionCommandContext {
  return Object.fromEntries(extensionCommandContext.entries());
}

export function evaluateCommandEnablement(expression: string | undefined, context: ExtensionCommandContext = {}): boolean {
  const trimmed = expression?.trim();
  if (!trimmed) return true;
  const negated = trimmed.startsWith('!');
  const body = negated ? trimmed.slice(1).trim() : trimmed;
  const comparison = body.match(/^([A-Za-z0-9_.:-]+)\s*([!=]=)\s*(.+)$/);
  const result = comparison
    ? compareContextValue(readContextValue(context, comparison[1]), comparison[2], comparison[3])
    : Boolean(readContextValue(context, body));
  return negated ? !result : result;
}

function compareContextValue(value: ExtensionCommandContextValue, operator: string, expected: string): boolean {
  const matches = String(value ?? '') === expected.replace(/^[']|[']$/g, '');
  return operator === '!=' ? !matches : matches;
}

export function listHostCommands(): Array<{ id: string; title: string; category?: string; argsSchema?: Record<string, unknown> }> {
  return [
    { id: 'app.navigate', title: 'Navigate', category: 'App', argsSchema: { type: 'object', properties: { to: { type: 'string' } } } },
    {
      id: 'palette.open',
      title: 'Open Command Palette',
      category: 'App',
      argsSchema: { type: 'object', properties: { scope: { type: 'string' } } },
    },
    {
      id: 'rail.open',
      title: 'Open Right Rail',
      category: 'App',
      argsSchema: { type: 'object', properties: { extensionId: { type: 'string' }, surfaceId: { type: 'string' } } },
    },
    {
      id: 'layout.set',
      title: 'Set Layout',
      category: 'App',
      argsSchema: { type: 'object', properties: { mode: { enum: ['compact', 'workbench'] } } },
    },
    { id: 'conversation.new', title: 'New Conversation', category: 'Conversation' },
    {
      id: 'conversation.open',
      title: 'Open Conversation',
      category: 'Conversation',
      argsSchema: { type: 'object', properties: { conversationId: { type: 'string' } } },
    },
    { id: 'conversation.next', title: 'Next Conversation', category: 'Conversation' },
    { id: 'conversation.previous', title: 'Previous Conversation', category: 'Conversation' },
    { id: 'composer.focus', title: 'Focus Composer', category: 'Conversation' },
    { id: 'sidebar.focus', title: 'Focus Sidebar', category: 'Focus' },
    { id: 'focus.next', title: 'Focus Next', category: 'Focus' },
    { id: 'focus.previous', title: 'Focus Previous', category: 'Focus' },
    { id: 'selection.activate', title: 'Activate Selection', category: 'Focus' },
  ];
}

export function createHostCommands(options: ExtensionCommandExecutorOptions): HostCommandDefinition[] {
  return [
    {
      id: 'app.navigate',
      title: 'Navigate',
      category: 'App',
      execute(args) {
        const to = readStringArg(args, 'to');
        if (!to) return false;
        options.navigate(to);
        return true;
      },
    },
    {
      id: 'palette.open',
      title: 'Open Command Palette',
      category: 'App',
      execute(args) {
        options.openCommandPalette(readStringArg(args, 'scope') ?? undefined);
        return true;
      },
    },
    {
      id: 'rail.open',
      title: 'Open Right Rail',
      category: 'App',
      execute(args) {
        const target = readStringArg(args, 'target');
        if (target) return options.openRightRail(target);
        const extensionId = readStringArg(args, 'extensionId');
        const surfaceId = readStringArg(args, 'surfaceId');
        return extensionId && surfaceId ? options.openRightRail(`${extensionId}/${surfaceId}`) : false;
      },
    },
    {
      id: 'layout.set',
      title: 'Set Layout',
      category: 'App',
      execute(args) {
        const mode = readStringArg(args, 'mode');
        if (mode !== 'compact' && mode !== 'workbench') return false;
        options.setLayout(mode);
        return true;
      },
    },
    {
      id: 'conversation.new',
      title: 'New Conversation',
      category: 'Conversation',
      execute() {
        options.navigate('/conversations/new');
        return true;
      },
    },
    {
      id: 'conversation.open',
      title: 'Open Conversation',
      category: 'Conversation',
      execute(args) {
        const conversationId = readStringArg(args, 'conversationId') ?? options.activeConversationId;
        if (!conversationId) return false;
        options.navigate(`/conversations/${encodeURIComponent(conversationId)}`);
        return true;
      },
      canExecute(args) {
        return Boolean(readStringArg(args, 'conversationId') ?? options.activeConversationId);
      },
    },
    {
      id: 'conversation.next',
      title: 'Next Conversation',
      category: 'Conversation',
      execute() {
        return options.navigateConversation?.('next') ?? false;
      },
      canExecute() {
        return Boolean(options.activeConversationId);
      },
    },
    {
      id: 'conversation.previous',
      title: 'Previous Conversation',
      category: 'Conversation',
      execute() {
        return options.navigateConversation?.('previous') ?? false;
      },
      canExecute() {
        return Boolean(options.activeConversationId);
      },
    },
    {
      id: 'composer.focus',
      title: 'Focus Composer',
      category: 'Conversation',
      execute() {
        options.focusComposer?.();
        return true;
      },
    },
    {
      id: 'sidebar.focus',
      title: 'Focus Sidebar',
      category: 'Focus',
      execute() {
        options.focusSidebar?.();
        return true;
      },
    },
    {
      id: 'focus.next',
      title: 'Focus Next',
      category: 'Focus',
      execute() {
        options.focusNext?.();
        return true;
      },
    },
    {
      id: 'focus.previous',
      title: 'Focus Previous',
      category: 'Focus',
      execute() {
        options.focusPrevious?.();
        return true;
      },
    },
    {
      id: 'selection.activate',
      title: 'Activate Selection',
      category: 'Focus',
      execute() {
        options.activateSelection?.();
        return true;
      },
    },
  ];
}

export function normalizeLegacyCommand(command: string): { command: string; args?: Record<string, unknown> } {
  if (command.startsWith('navigate:')) return { command: 'app.navigate', args: { to: command.slice('navigate:'.length) } };
  if (command.startsWith('commandPalette:')) return { command: 'palette.open', args: { scope: command.slice('commandPalette:'.length) } };
  if (command.startsWith('rightRail:')) {
    const [extensionId, surfaceId] = command.slice('rightRail:'.length).split('/');
    return { command: 'rail.open', args: { extensionId, surfaceId } };
  }
  if (command.startsWith('layout:')) return { command: 'layout.set', args: { mode: command.slice('layout:'.length) } };
  return { command };
}

function isHostCommandString(command: string): boolean {
  const normalized = normalizeLegacyCommand(command).command;
  return listHostCommands().some((candidate) => candidate.id === normalized);
}

export async function executeExtensionCommand(command: string, args: unknown, options: ExtensionCommandExecutorOptions): Promise<boolean> {
  const startedAt = performance.now();
  const invocation = normalizeLegacyCommand(command);
  const commandArgs = (args ?? invocation.args) as ExtensionCommandArgs;
  let handled = false;
  try {
    const hostCommand = createHostCommands(options).find((candidate) => candidate.id === invocation.command);
    if (hostCommand) {
      if (hostCommand.canExecute && !hostCommand.canExecute(commandArgs, options.context ?? {})) return false;
      handled = Boolean(await hostCommand.execute(commandArgs));
      return handled;
    }
    const extensionCommand = options.extensionCommands?.find(
      (candidate) => candidate.surfaceId === invocation.command || `${candidate.extensionId}.${candidate.surfaceId}` === invocation.command,
    );
    if (!extensionCommand) return false;
    if (!evaluateCommandEnablement(extensionCommand.enablement, options.context)) return false;
    const effectiveArgs = commandArgs ?? (extensionCommand.args as ExtensionCommandArgs);
    if (isHostCommandString(extensionCommand.action)) {
      handled = await executeExtensionCommand(extensionCommand.action, effectiveArgs, options);
      return handled;
    }
    await options.invokeExtensionCommand?.(extensionCommand, effectiveArgs ?? {});
    handled = true;
    return true;
  } finally {
    recordRendererTelemetry({
      category: 'commands',
      name: 'execute',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      metadata: { command: invocation.command, originalCommand: command, handled },
    });
  }
}

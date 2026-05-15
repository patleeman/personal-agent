import type { NavigateFunction } from 'react-router-dom';

import type { ExtensionCommandRegistration } from './types';

export type ExtensionCommandArgs = Record<string, unknown> | undefined;
export type ExtensionCommandContextValue = string | number | boolean | null | undefined;
export type ExtensionCommandContext = Record<string, ExtensionCommandContextValue>;

export interface HostCommandDefinition {
  id: string;
  title: string;
  category?: string;
  execute(args: ExtensionCommandArgs): boolean | Promise<boolean>;
  canExecute?(args: ExtensionCommandArgs, context: ExtensionCommandContext): boolean;
}

export interface ExtensionCommandExecutorOptions {
  navigate: NavigateFunction;
  openCommandPalette(scope?: string): void;
  openRightRail(target: string): boolean;
  setLayout(mode: 'compact' | 'workbench'): void;
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
  const equality = body.match(/^([A-Za-z0-9_.:-]+)\s*==\s*(.+)$/);
  const result = equality
    ? String(readContextValue(context, equality[1]) ?? '') === equality[2].replace(/^['"]|['"]$/g, '')
    : Boolean(readContextValue(context, body));
  return negated ? !result : result;
}

export function listHostCommands(): Array<{ id: string; title: string; category?: string }> {
  return [
    { id: 'app.navigate', title: 'Navigate', category: 'App' },
    { id: 'palette.open', title: 'Open Command Palette', category: 'App' },
    { id: 'rail.open', title: 'Open Right Rail', category: 'App' },
    { id: 'layout.set', title: 'Set Layout', category: 'App' },
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
  ];
}

function legacyCommandToInvocation(command: string): { id: string; args?: Record<string, unknown> } {
  if (command.startsWith('navigate:')) return { id: 'app.navigate', args: { to: command.slice('navigate:'.length) } };
  if (command.startsWith('commandPalette:')) return { id: 'palette.open', args: { scope: command.slice('commandPalette:'.length) } };
  if (command.startsWith('rightRail:')) return { id: 'rail.open', args: { target: command.slice('rightRail:'.length) } };
  if (command.startsWith('layout:')) return { id: 'layout.set', args: { mode: command.slice('layout:'.length) } };
  return { id: command };
}

export async function executeExtensionCommand(command: string, args: unknown, options: ExtensionCommandExecutorOptions): Promise<boolean> {
  const invocation = legacyCommandToInvocation(command);
  const commandArgs = (args ?? invocation.args) as ExtensionCommandArgs;
  const hostCommand = createHostCommands(options).find((candidate) => candidate.id === invocation.id);
  if (hostCommand) {
    if (hostCommand.canExecute && !hostCommand.canExecute(commandArgs, options.context ?? {})) return false;
    return Boolean(await hostCommand.execute(commandArgs));
  }
  const extensionCommand = options.extensionCommands?.find(
    (candidate) => candidate.surfaceId === invocation.id || `${candidate.extensionId}.${candidate.surfaceId}` === invocation.id,
  );
  if (!extensionCommand) return false;
  if (!evaluateCommandEnablement(extensionCommand.enablement, options.context)) return false;
  await options.invokeExtensionCommand?.(extensionCommand, commandArgs ?? {});
  return true;
}

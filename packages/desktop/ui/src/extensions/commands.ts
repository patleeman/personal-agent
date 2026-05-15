import { api } from '../client/api';
import type { ExtensionCommandRegistration } from './types';

export type ExtensionCommandArgs = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined;
export type ExtensionCommandHandler = (args?: ExtensionCommandArgs) => boolean | void | Promise<boolean | void>;
export type ExtensionCommandContextValue = string | number | boolean | null | undefined;
export type ExtensionCommandContext = Record<string, ExtensionCommandContextValue>;

export interface HostCommandRegistration {
  id: string;
  title: string;
  category?: string;
  description?: string;
  enablement?: string;
  handler: ExtensionCommandHandler;
}

const extensionContext: ExtensionCommandContext = {};
const hostCommands = new Map<string, HostCommandRegistration>();

export function setExtensionCommandContext(key: string, value: ExtensionCommandContextValue): void {
  if (!key.trim()) return;
  if (value === undefined || value === null) {
    delete extensionContext[key];
  } else {
    extensionContext[key] = value;
  }
  window.dispatchEvent(new CustomEvent('pa-extension-command-context-changed', { detail: { key, value } }));
}

export function getExtensionCommandContext(overrides: ExtensionCommandContext = {}): ExtensionCommandContext {
  return { ...extensionContext, ...overrides };
}

export function registerHostCommand(command: HostCommandRegistration): () => void {
  hostCommands.set(command.id, command);
  window.dispatchEvent(new CustomEvent('pa-extension-commands-changed'));
  return () => {
    if (hostCommands.get(command.id) === command) {
      hostCommands.delete(command.id);
      window.dispatchEvent(new CustomEvent('pa-extension-commands-changed'));
    }
  };
}

export function listHostCommands(): HostCommandRegistration[] {
  return [...hostCommands.values()];
}

function parseLiteral(raw: string): ExtensionCommandContextValue {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && value !== '' ? numberValue : value;
}

export function evaluateCommandEnablement(
  expression: string | undefined,
  context: ExtensionCommandContext = getExtensionCommandContext(),
): boolean {
  const trimmed = expression?.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('!') && !trimmed.includes('==') && !trimmed.includes('!=')) {
    return !context[trimmed.slice(1).trim()];
  }
  const notEqual = trimmed.match(/^([\w.:-]+)\s*!=\s*(.+)$/);
  if (notEqual) return context[notEqual[1]] !== parseLiteral(notEqual[2]);
  const equal = trimmed.match(/^([\w.:-]+)\s*==\s*(.+)$/);
  if (equal) return context[equal[1]] === parseLiteral(equal[2]);
  return Boolean(context[trimmed]);
}

export function normalizeLegacyCommand(command: string, args?: ExtensionCommandArgs): { command: string; args?: ExtensionCommandArgs } {
  if (command.startsWith('navigate:')) return { command: 'app.navigate', args: { to: command.slice('navigate:'.length) } };
  if (command.startsWith('commandPalette:')) return { command: 'palette.open', args: { scope: command.slice('commandPalette:'.length) } };
  if (command.startsWith('layout:')) return { command: 'layout.set', args: { mode: command.slice('layout:'.length) } };
  if (command.startsWith('rightRail:')) {
    const [extensionId, surfaceId] = command.slice('rightRail:'.length).split('/');
    return { command: 'rail.open', args: { extensionId, surfaceId } };
  }
  return args === undefined ? { command } : { command, args };
}

export async function executeExtensionCommand(
  command: string,
  args?: ExtensionCommandArgs,
  extensionCommands: ExtensionCommandRegistration[] = [],
): Promise<boolean> {
  const normalized = normalizeLegacyCommand(command, args);
  const host = hostCommands.get(normalized.command);
  if (host) {
    if (!evaluateCommandEnablement(host.enablement)) return false;
    const result = await host.handler(normalized.args);
    return result !== false;
  }
  const commandRegistrations = extensionCommands.length ? extensionCommands : await api.extensionCommands();
  const extensionCommand = commandRegistrations.find(
    (candidate) => `${candidate.extensionId}.${candidate.surfaceId}` === normalized.command || candidate.surfaceId === normalized.command,
  );
  if (!extensionCommand || !evaluateCommandEnablement(extensionCommand.enablement)) return false;
  if (/^(navigate|commandPalette|layout|rightRail):/.test(extensionCommand.action)) {
    return executeExtensionCommand(extensionCommand.action, normalized.args, commandRegistrations);
  }
  const response = await api.executeExtensionCommand(
    `${extensionCommand.extensionId}.${extensionCommand.surfaceId}`,
    normalized.args ?? {},
  );
  return response.ok;
}

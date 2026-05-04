export type SlackMcpGatewayCommand =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'stop' }
  | { kind: 'new' }
  | { kind: 'model'; model?: string }
  | { kind: 'compact' }
  | { kind: 'detach' };

export function parseSlackMcpGatewayCommand(text: string): SlackMcpGatewayCommand | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith('!agent')) {
    return null;
  }

  const rest = trimmed.slice('!agent'.length).trim();
  if (!rest) {
    return { kind: 'help' };
  }

  const [rawCommand, ...args] = rest.split(/\s+/);
  const command = rawCommand?.toLowerCase();
  const argumentText = args.join(' ').trim();

  switch (command) {
    case 'help':
      return { kind: 'help' };
    case 'status':
      return { kind: 'status' };
    case 'stop':
      return { kind: 'stop' };
    case 'new':
      return { kind: 'new' };
    case 'model':
      return argumentText ? { kind: 'model', model: argumentText } : { kind: 'model' };
    case 'compact':
      return { kind: 'compact' };
    case 'detach':
      return { kind: 'detach' };
    default:
      return null;
  }
}

export function formatSlackMcpGatewayHelp(): string {
  return [
    'Personal Agent Slack commands:',
    '!agent help — show commands',
    '!agent status — show gateway status',
    '!agent stop — stop the current agent turn',
    '!agent new — start a fresh bound conversation',
    '!agent model [model] — show or set model',
    '!agent compact — compact the current conversation',
    '!agent detach — detach this Slack channel',
  ].join('\n');
}

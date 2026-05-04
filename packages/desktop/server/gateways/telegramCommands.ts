export type TelegramGatewayCommand =
  | { kind: 'start' }
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'stop' }
  | { kind: 'resume' }
  | { kind: 'new' }
  | { kind: 'attach' }
  | { kind: 'detach' }
  | { kind: 'model'; model?: string }
  | { kind: 'compact' }
  | { kind: 'rename'; title: string }
  | { kind: 'archive' };

export function parseTelegramGatewayCommand(text: string): TelegramGatewayCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const [rawCommand = '', ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.split('@')[0]?.toLowerCase();
  const arg = rest.join(' ').trim();

  switch (command) {
    case '/start':
      return { kind: 'start' };
    case '/help':
      return { kind: 'help' };
    case '/status':
      return { kind: 'status' };
    case '/stop':
    case '/pause':
      return { kind: 'stop' };
    case '/resume':
      return { kind: 'resume' };
    case '/new':
      return { kind: 'new' };
    case '/attach':
      return { kind: 'attach' };
    case '/detach':
      return { kind: 'detach' };
    case '/model':
      return arg ? { kind: 'model', model: arg } : { kind: 'model' };
    case '/compact':
      return { kind: 'compact' };
    case '/rename':
      return arg ? { kind: 'rename', title: arg } : null;
    case '/archive':
      return { kind: 'archive' };
    default:
      return null;
  }
}

export function formatTelegramGatewayHelp(): string {
  return [
    'Personal Agent Telegram commands:',
    '/status — show gateway status',
    '/new — start a new conversation',
    '/attach — attach this chat as the main gateway thread',
    '/detach — detach this chat',
    '/stop or /pause — stop replies',
    '/resume — resume replies',
    '/model [name] — show or change model',
    '/compact — compact the thread',
    '/rename <title> — rename the thread',
    '/archive — archive and detach the thread',
  ].join('\n');
}

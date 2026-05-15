import { randomUUID } from 'node:crypto';

import { publishAppEvent } from '../shared/appEvents.js';

interface PendingCommandAck {
  resolve: (handled: boolean) => void;
  timer: NodeJS.Timeout;
}

const pendingAcks = new Map<string, PendingCommandAck>();
const ACK_TIMEOUT_MS = 2_000;

export function executeHostCommandInRenderer(input: { command: string; args?: unknown; sourceExtensionId?: string }): Promise<boolean> {
  const requestId = randomUUID();
  publishAppEvent({
    type: 'extension_command',
    command: input.command,
    args: input.args,
    sourceExtensionId: input.sourceExtensionId,
    requestId,
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(requestId);
      resolve(false);
    }, ACK_TIMEOUT_MS);
    timer.unref?.();
    pendingAcks.set(requestId, { resolve, timer });
  });
}

export function acknowledgeHostCommand(requestId: string, handled: boolean): boolean {
  const pending = pendingAcks.get(requestId);
  if (!pending) return false;
  pendingAcks.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(handled);
  return true;
}

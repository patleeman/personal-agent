import type { DurableRunRecord, MessageBlock } from './types';

export interface ConversationResumeState {
  canResume: boolean;
  mode: 'replay' | 'continue' | null;
  reason: 'interrupted' | 'failed' | 'queued' | 'error' | null;
  title: string | null;
  actionLabel: 'resume' | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasPendingConversationOperation(run: DurableRunRecord | null | undefined): boolean {
  const payload = isRecord(run?.checkpoint?.payload) ? run.checkpoint.payload : undefined;
  const pendingOperation = payload?.pendingOperation;

  return isRecord(pendingOperation)
    && pendingOperation.type === 'prompt'
    && typeof pendingOperation.text === 'string'
    && pendingOperation.text.trim().length > 0;
}

export function didConversationStopWithError(message: MessageBlock | null | undefined): boolean {
  if (!message) {
    return false;
  }

  switch (message.type) {
    case 'error':
      return true;
    case 'tool_use':
      return message.status === 'error' || Boolean(message.error);
    case 'subagent':
      return message.status === 'failed';
    default:
      return false;
  }
}

export function didConversationStopMidTurn(message: MessageBlock | null | undefined): boolean {
  if (!message) {
    return false;
  }

  switch (message.type) {
    case 'thinking':
      return true;
    case 'tool_use':
      return true;
    case 'subagent':
      return true;
    case 'error':
      return true;
    default:
      return false;
  }
}

export function getConversationResumeState(input: {
  run?: DurableRunRecord | null;
  isLiveSession: boolean;
  lastMessage?: MessageBlock | null;
}): ConversationResumeState {
  if (input.isLiveSession) {
    if (didConversationStopWithError(input.lastMessage)) {
      return {
        canResume: true,
        mode: 'continue',
        reason: 'error',
        title: 'Resume this conversation after the last error.',
        actionLabel: 'resume',
      };
    }

    return {
      canResume: false,
      mode: null,
      reason: null,
      title: null,
      actionLabel: null,
    };
  }

  const status = input.run?.status?.status;
  const hasPendingOperation = hasPendingConversationOperation(input.run);

  if (status === 'interrupted' || status === 'running') {
    return {
      canResume: true,
      mode: hasPendingOperation ? 'replay' : 'continue',
      reason: 'interrupted',
      title: hasPendingOperation
        ? 'Resume the interrupted turn.'
        : 'Resume this interrupted conversation. The previous turn cannot be replayed exactly.',
      actionLabel: 'resume',
    };
  }

  if (status === 'failed') {
    return {
      canResume: true,
      mode: hasPendingOperation ? 'replay' : 'continue',
      reason: 'failed',
      title: hasPendingOperation
        ? 'Retry the failed turn.'
        : 'Resume this failed conversation. The previous turn cannot be replayed exactly.',
      actionLabel: 'resume',
    };
  }

  if (status === 'waiting' && hasPendingOperation) {
    return {
      canResume: true,
      mode: 'replay',
      reason: 'queued',
      title: 'Finish the pending turn.',
      actionLabel: 'resume',
    };
  }

  if (didConversationStopWithError(input.lastMessage)) {
    return {
      canResume: true,
      mode: 'continue',
      reason: 'error',
      title: 'Resume this conversation after the last error. The previous turn cannot be replayed exactly.',
      actionLabel: 'resume',
    };
  }

  if (didConversationStopMidTurn(input.lastMessage)) {
    return {
      canResume: true,
      mode: 'continue',
      reason: 'interrupted',
      title: 'Resume this unfinished conversation. The previous turn cannot be replayed exactly.',
      actionLabel: 'resume',
    };
  }

  return {
    canResume: false,
    mode: null,
    reason: null,
    title: null,
    actionLabel: null,
  };
}

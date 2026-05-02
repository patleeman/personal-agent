import { type AgentSession, type SessionEntry, type SessionManager } from '@mariozechner/pi-coding-agent';

import { getAssistantErrorDisplayMessage } from './sessions.js';

function isHiddenSessionBranchEntry(entry: SessionEntry | undefined): boolean {
  return entry?.type === 'custom_message' && entry.display === false;
}

function resolveDanglingToolCallRepairLeafId(sessionManager: Pick<SessionManager, 'getBranch' | 'getEntry'>): string | null | undefined {
  const branch = sessionManager.getBranch();
  if (branch.length === 0) {
    return undefined;
  }

  const pendingToolCalls = new Map<string, { index: number; parentId: string | null }>();

  for (const [index, entry] of branch.entries()) {
    if (entry.type !== 'message') {
      continue;
    }

    const { message } = entry;
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type !== 'toolCall') {
          continue;
        }

        const toolCallId = part.id?.trim();
        if (!toolCallId) {
          continue;
        }

        pendingToolCalls.set(toolCallId, {
          index,
          parentId: entry.parentId ?? null,
        });
      }
      continue;
    }

    if (message.role === 'toolResult') {
      const toolCallId = message.toolCallId?.trim();
      if (toolCallId) {
        pendingToolCalls.delete(toolCallId);
      }
    }
  }

  let repairLeafId: string | null | undefined;
  let earliestPendingIndex = Number.POSITIVE_INFINITY;
  for (const pending of pendingToolCalls.values()) {
    if (pending.index < earliestPendingIndex) {
      earliestPendingIndex = pending.index;
      repairLeafId = pending.parentId;
    }
  }

  if (repairLeafId === undefined) {
    return undefined;
  }

  while (repairLeafId) {
    const parentEntry = sessionManager.getEntry(repairLeafId);
    if (!isHiddenSessionBranchEntry(parentEntry) || !parentEntry) {
      break;
    }
    repairLeafId = parentEntry.parentId ?? null;
  }

  return repairLeafId;
}

export function repairDanglingToolCallContext(session: Pick<AgentSession, 'sessionManager' | 'state'>): boolean {
  const sessionManager = session.sessionManager as
    | Partial<Pick<SessionManager, 'getBranch' | 'getEntry' | 'branch' | 'resetLeaf' | 'buildSessionContext'>>
    | undefined;
  if (
    !sessionManager ||
    typeof sessionManager.getBranch !== 'function' ||
    typeof sessionManager.getEntry !== 'function' ||
    typeof sessionManager.branch !== 'function' ||
    typeof sessionManager.resetLeaf !== 'function' ||
    typeof sessionManager.buildSessionContext !== 'function'
  ) {
    return false;
  }

  const repairLeafId = resolveDanglingToolCallRepairLeafId(sessionManager as Pick<SessionManager, 'getBranch' | 'getEntry'>);
  if (repairLeafId === undefined) {
    return false;
  }

  if (repairLeafId === null) {
    sessionManager.resetLeaf();
  } else {
    sessionManager.branch(repairLeafId);
  }
  session.state.messages = sessionManager.buildSessionContext().messages;
  return true;
}

export type TranscriptTailRecoveryReason = 'assistant_error' | 'dangling_tool_call';

export interface TranscriptTailRecoveryPlan {
  targetEntryId: string | null;
  reason: TranscriptTailRecoveryReason;
  summary: string;
  details?: unknown;
}

function resolveVisibleSessionBranchTargetId(
  sessionManager: Pick<SessionManager, 'getEntry'>,
  entryId: string | null | undefined,
): string | null {
  let targetEntryId = entryId ?? null;
  while (targetEntryId) {
    const targetEntry = sessionManager.getEntry(targetEntryId);
    if (!targetEntry || !isHiddenSessionBranchEntry(targetEntry)) {
      break;
    }
    targetEntryId = targetEntry.parentId ?? null;
  }
  return targetEntryId;
}

function buildTranscriptTailRecoveryPlan(input: {
  targetEntryId: string | null;
  reason: TranscriptTailRecoveryReason;
  errorMessage?: string;
}): TranscriptTailRecoveryPlan {
  const summaryLines =
    input.reason === 'assistant_error'
      ? ['Recovered from a failed tail so the conversation can continue from the last stable point.']
      : ['Recovered from an unfinished tool-use tail so the conversation can continue from the last stable point.'];

  const errorMessage = input.errorMessage?.trim();
  if (errorMessage) {
    summaryLines.push(`Error: ${errorMessage}`);
  }

  return {
    targetEntryId: input.targetEntryId,
    reason: input.reason,
    summary: summaryLines.join('\n'),
    details: {
      source: 'conversation-recovery',
      reason: input.reason,
      ...(errorMessage ? { errorMessage } : {}),
    },
  };
}

export function resolveTranscriptTailRecoveryPlan(
  sessionManager: Pick<SessionManager, 'getBranch' | 'getEntry'>,
): TranscriptTailRecoveryPlan | null {
  const branch = sessionManager.getBranch();
  if (branch.length === 0) {
    return null;
  }

  const leafEntry = branch[branch.length - 1];
  if (leafEntry?.type === 'message' && leafEntry.message.role === 'assistant') {
    const errorMessage = getAssistantErrorDisplayMessage(leafEntry.message);
    if (errorMessage) {
      return buildTranscriptTailRecoveryPlan({
        targetEntryId: resolveVisibleSessionBranchTargetId(sessionManager, leafEntry.parentId ?? null),
        reason: 'assistant_error',
        errorMessage,
      });
    }
  }

  const danglingToolCallRepairLeafId = resolveDanglingToolCallRepairLeafId(sessionManager);
  if (danglingToolCallRepairLeafId !== undefined) {
    return buildTranscriptTailRecoveryPlan({
      targetEntryId: danglingToolCallRepairLeafId,
      reason: 'dangling_tool_call',
    });
  }

  return null;
}

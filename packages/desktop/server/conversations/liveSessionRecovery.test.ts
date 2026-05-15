import { describe, expect, it, vi } from 'vitest';

import { repairDanglingToolCallContext, resolveTranscriptTailRecoveryPlan } from './liveSessionRecovery.js';

type BranchEntry = {
  type: string;
  id: string;
  parentId?: string | null;
  message?: {
    role: string;
    content: Array<Record<string, unknown>>;
    toolCallId?: string;
    stopReason?: string;
  };
};

function message(
  id: string,
  parentId: string | null,
  role: string,
  content: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): BranchEntry {
  return {
    type: 'message',
    id,
    parentId,
    message: {
      role,
      content,
      ...extra,
    },
  };
}

function user(id: string, parentId: string | null, text = 'prompt'): BranchEntry {
  return message(id, parentId, 'user', [{ type: 'text', text }]);
}

function assistantToolCall(id: string, parentId: string | null, toolCallId = 'call_1'): BranchEntry {
  return message(id, parentId, 'assistant', [{ type: 'toolCall', id: toolCallId, name: 'read', arguments: { path: 'README.md' } }], {
    stopReason: 'toolUse',
  });
}

function toolResult(id: string, parentId: string | null, toolCallId = 'call_1'): BranchEntry {
  return {
    type: 'message',
    id,
    parentId,
    message: {
      role: 'toolResult',
      toolCallId,
      content: [{ type: 'text', text: 'ok' }],
    },
  };
}

function assistantText(id: string, parentId: string | null, text = 'done'): BranchEntry {
  return message(id, parentId, 'assistant', [{ type: 'text', text }], { stopReason: 'stop' });
}

function branchSummary(id: string, parentId: string | null): BranchEntry {
  return { type: 'branch_summary', id, parentId };
}

describe('live session recovery', () => {
  describe('resolveTranscriptTailRecoveryPlan', () => {
    it('recovers a tail assistant tool call with no result', () => {
      const plan = resolveTranscriptTailRecoveryPlan({
        getBranch: () => [user('user-1', null), assistantToolCall('assistant-1', 'user-1')],
      } as never);

      expect(plan).toMatchObject({
        targetEntryId: 'user-1',
        reason: 'dangling_tool_call',
        summary: 'Recovered from an unfinished tool-use tail so the conversation can continue from the last stable point.',
      });
    });

    it('does not recover an older dangling tool call after a later final assistant answer', () => {
      const plan = resolveTranscriptTailRecoveryPlan({
        getBranch: () => [
          user('user-1', null),
          assistantToolCall('assistant-1', 'user-1', 'call_stale'),
          user('user-2', 'assistant-1', 'continue'),
          assistantText('assistant-2', 'user-2', 'Implemented and checkpointed.'),
        ],
      } as never);

      expect(plan).toBeNull();
    });

    it('does not recover an older dangling tool call after a branch summary and new user tail', () => {
      const plan = resolveTranscriptTailRecoveryPlan({
        getBranch: () => [
          user('user-1', null),
          assistantToolCall('assistant-1', 'user-1', 'call_stale'),
          branchSummary('summary-1', 'user-1'),
          user('user-2', 'summary-1', 'What else to do?'),
        ],
      } as never);

      expect(plan).toBeNull();
    });

    it('does not recover when the tail tool call has a matching result', () => {
      const plan = resolveTranscriptTailRecoveryPlan({
        getBranch: () => [user('user-1', null), assistantToolCall('assistant-1', 'user-1'), toolResult('tool-1', 'assistant-1')],
      } as never);

      expect(plan).toBeNull();
    });

    it('recovers when the tail assistant has multiple tool calls and only some trailing results arrived', () => {
      const plan = resolveTranscriptTailRecoveryPlan({
        getBranch: () => [
          user('user-1', null),
          message(
            'assistant-1',
            'user-1',
            'assistant',
            [
              { type: 'toolCall', id: 'call_1', name: 'read', arguments: {} },
              { type: 'toolCall', id: 'call_2', name: 'bash', arguments: {} },
            ],
            { stopReason: 'toolUse' },
          ),
          toolResult('tool-1', 'assistant-1', 'call_1'),
        ],
      } as never);

      expect(plan).toMatchObject({
        targetEntryId: 'user-1',
        reason: 'dangling_tool_call',
      });
    });
  });

  describe('repairDanglingToolCallContext', () => {
    it('does not branch backward for stale dangling tool calls before a stable tail', () => {
      const branch = vi.fn();
      const resetLeaf = vi.fn();
      const buildSessionContext = vi.fn(() => ({ messages: [] }));
      const state = { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] };

      const repaired = repairDanglingToolCallContext({
        state,
        sessionManager: {
          getBranch: () => [
            user('user-1', null),
            assistantToolCall('assistant-1', 'user-1', 'call_stale'),
            user('user-2', 'assistant-1', 'continue'),
            assistantText('assistant-2', 'user-2'),
          ],
          getEntry: vi.fn(),
          branch,
          resetLeaf,
          buildSessionContext,
        },
      } as never);

      expect(repaired).toBe(false);
      expect(branch).not.toHaveBeenCalled();
      expect(resetLeaf).not.toHaveBeenCalled();
      expect(buildSessionContext).not.toHaveBeenCalled();
      expect(state.messages).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }]);
    });
  });
});

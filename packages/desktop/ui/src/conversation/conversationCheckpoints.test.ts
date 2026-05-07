import { describe, expect, it } from 'vitest';

import type { MessageBlock } from '../shared/types';
import {
  getConversationCheckpointIdFromSearch,
  readCheckpointPresentation,
  setConversationCheckpointIdInSearch,
} from './conversationCheckpoints';

// ── conversationCheckpoints — URL param + tool output presentation ──────────

describe('conversationCheckpoints', () => {
  describe('getConversationCheckpointIdFromSearch', () => {
    it('returns null for empty search', () => {
      expect(getConversationCheckpointIdFromSearch('')).toBeNull();
    });

    it('returns null when param is absent', () => {
      expect(getConversationCheckpointIdFromSearch('?file=doc.md')).toBeNull();
    });

    it('returns checkpoint id when present', () => {
      expect(getConversationCheckpointIdFromSearch('?checkpoint=abc123')).toBe('abc123');
    });

    it('handles compound search strings', () => {
      expect(getConversationCheckpointIdFromSearch('?run=run-1&checkpoint=def456&file=x.md')).toBe('def456');
    });
  });

  describe('setConversationCheckpointIdInSearch', () => {
    it('sets checkpoint param', () => {
      const result = setConversationCheckpointIdInSearch('', 'abc123');
      expect(result).toContain('checkpoint=abc123');
    });

    it('removes checkpoint and checkpointFile params when null', () => {
      const result = setConversationCheckpointIdInSearch('?checkpoint=abc&checkpointFile=diff&file=x.md', null);
      expect(result).not.toContain('checkpoint');
      expect(result).toContain('file=x');
    });

    it('preserves other params when setting checkpoint', () => {
      const result = setConversationCheckpointIdInSearch('?file=doc.md', 'xyz789');
      expect(result).toContain('checkpoint=xyz789');
      expect(result).toContain('file=doc');
    });
  });

  describe('readCheckpointPresentation', () => {
    it('returns null for non-checkpoint tool blocks', () => {
      const block = {
        type: 'tool_use',
        tool: 'bash',
        input: {},
      } as unknown as Extract<MessageBlock, { type: 'tool_use' }>;
      expect(readCheckpointPresentation(block)).toBeNull();
    });

    it('extracts presentation from a valid checkpoint block with details', () => {
      const block = {
        type: 'tool_use',
        tool: 'checkpoint',
        input: { action: 'save', checkpointId: 'abc123' },
        details: {
          action: 'save',
          checkpointId: 'abc123',
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          title: 'Add feature X',
          subject: 'Implement the new thing',
          fileCount: 3,
          linesAdded: 42,
          linesDeleted: 10,
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      } as unknown as Extract<MessageBlock, { type: 'tool_use' }>;
      const result = readCheckpointPresentation(block);
      expect(result).not.toBeNull();
      expect(result!.checkpointId).toBe('abc123');
      expect(result!.commitSha).toBe('abcdef1234567890');
      expect(result!.shortSha).toBe('abcdef1');
      expect(result!.title).toBe('Add feature X');
      expect(result!.fileCount).toBe(3);
      expect(result!.linesAdded).toBe(42);
      expect(result!.linesDeleted).toBe(10);
    });

    it('returns null for empty object details', () => {
      const block = {
        type: 'tool_use',
        tool: 'checkpoint',
        input: {},
        details: {},
      } as unknown as Extract<MessageBlock, { type: 'tool_use' }>;
      expect(readCheckpointPresentation(block)).toBeNull();
    });

    it('falls back to input fields when details are missing', () => {
      const block = {
        type: 'tool_use',
        tool: 'checkpoint',
        input: {
          action: 'save',
          checkpointId: 'def456',
        },
        details: null,
      } as unknown as Extract<MessageBlock, { type: 'tool_use' }>;
      const result = readCheckpointPresentation(block);
      expect(result).not.toBeNull();
      expect(result!.action).toBe('save');
      expect(result!.checkpointId).toBe('def456');
      expect(result!.shortSha).toBe('def456'.slice(0, 7));
    });

    it('returns null when action is missing', () => {
      const block = {
        type: 'tool_use',
        tool: 'checkpoint',
        input: {},
        details: JSON.stringify({}),
      } as unknown as Extract<MessageBlock, { type: 'tool_use' }>;
      expect(readCheckpointPresentation(block)).toBeNull();
    });

    it('returns null when checkpointId is missing', () => {
      const block = {
        type: 'tool_use',
        tool: 'checkpoint',
        input: { action: 'save' },
        details: JSON.stringify({ action: 'save' }),
      } as unknown as Extract<MessageBlock, { type: 'tool_use' }>;
      expect(readCheckpointPresentation(block)).toBeNull();
    });
  });
});

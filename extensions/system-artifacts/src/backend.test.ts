import { describe, expect, it, vi } from 'vitest';

const mockSave = vi.fn();
const mockGet = vi.fn();
const mockList = vi.fn();
const mockDelete = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('@personal-agent/extensions/backend/artifacts', () => ({
  saveConversationArtifact: (...args: unknown[]) => mockSave(...args),
  getConversationArtifact: (...args: unknown[]) => mockGet(...args),
  listConversationArtifacts: (...args: unknown[]) => mockList(...args),
  deleteConversationArtifact: (...args: unknown[]) => mockDelete(...args),
  ConversationArtifactKind: undefined,
}));

import { artifact } from './backend.js';

function createCtx(overrides?: Record<string, unknown>) {
  return {
    profile: 'test-profile',
    toolContext: { conversationId: 'conv-1' },
    ui: { invalidate: mockInvalidate },
    ...overrides,
  };
}

describe('system-artifacts backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('input validation', () => {
    it('throws when toolContext is missing conversationId', async () => {
      await expect(artifact({ action: 'list' }, createCtx({ toolContext: {} }))).rejects.toThrow('conversationId is required');
    });

    it('throws for an unsupported action', async () => {
      await expect(artifact({ action: 'unknown' } as never, createCtx())).rejects.toThrow('Unsupported artifact action');
    });
  });

  describe('list action', () => {
    it('returns formatted list when artifacts exist', async () => {
      mockList.mockReturnValue([
        { id: 'a1', kind: 'html', title: 'Report', revision: 2, updatedAt: '2025-01-01T00:00:00Z' },
        { id: 'a2', kind: 'mermaid', title: 'Diagram', revision: 1, updatedAt: '2025-01-02T00:00:00Z' },
      ]);

      const result = await artifact({ action: 'list' }, createCtx());

      expect(result.action).toBe('list');
      expect(result.conversationId).toBe('conv-1');
      expect(result.artifactCount).toBe(2);
      expect(result.artifactIds).toEqual(['a1', 'a2']);
      expect(result.text).toContain('Artifacts for conversation conv-1');
      expect(result.text).toContain('a1 [html] Report (rev 2');
      expect(result.text).toContain('a2 [mermaid] Diagram (rev 1');
      expect(mockList).toHaveBeenCalledWith({ profile: 'test-profile', conversationId: 'conv-1' });
    });

    it('returns empty message when no artifacts', async () => {
      mockList.mockReturnValue([]);

      const result = await artifact({ action: 'list' }, createCtx());

      expect(result.text).toContain('No artifacts saved');
      expect(result.artifactCount).toBe(0);
      expect(result.artifactIds).toEqual([]);
    });
  });

  describe('save action', () => {
    it('saves a new artifact with default open=true', async () => {
      mockSave.mockReturnValue({
        id: 'a1',
        kind: 'html',
        title: 'Report',
        revision: 1,
        updatedAt: '2025-01-01T00:00:00Z',
        content: '<p>hello</p>',
      });

      const result = await artifact({ action: 'save', title: 'Report', kind: 'html', content: '<p>hello</p>' }, createCtx());

      expect(result.action).toBe('save');
      expect(result.text).toContain('Saved artifact a1 [html] "Report".');
      expect(result.openRequested).toBe(true);
      expect(result.revision).toBe(1);
      expect(result.artifactId).toBe('a1');
      expect(mockInvalidate).toHaveBeenCalledWith('artifacts');
    });

    it('saves with explicit artifactId for updates', async () => {
      mockSave.mockReturnValue({
        id: 'a1',
        kind: 'mermaid',
        title: 'Diagram v2',
        revision: 2,
        updatedAt: '2025-01-02T00:00:00Z',
        content: 'flowchart',
      });

      const result = await artifact(
        { action: 'save', artifactId: 'a1', title: 'Diagram v2', kind: 'mermaid', content: 'flowchart', open: false },
        createCtx(),
      );

      expect(result.text).toContain('Updated artifact a1 [mermaid] "Diagram v2".');
      expect(result.openRequested).toBe(false);
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'a1', title: 'Diagram v2', kind: 'mermaid' }));
    });

    it('throws when title is missing', async () => {
      await expect(artifact({ action: 'save', kind: 'html' }, createCtx())).rejects.toThrow('title is required');
    });

    it('throws when kind is missing', async () => {
      await expect(artifact({ action: 'save', title: 'X' }, createCtx())).rejects.toThrow('kind is required');
    });

    it('throws for invalid kind value', async () => {
      await expect(artifact({ action: 'save', title: 'X', kind: 'pdf' }, createCtx())).rejects.toThrow('Invalid artifact kind');
    });

    it('throws for blank string kind', async () => {
      await expect(artifact({ action: 'save', title: 'X', kind: '   ' }, createCtx())).rejects.toThrow('kind is required');
    });
  });

  describe('get action', () => {
    it('returns formatted artifact detail when found', async () => {
      mockGet.mockReturnValue({
        id: 'a1',
        kind: 'html',
        title: 'Report',
        revision: 2,
        updatedAt: '2025-01-01T00:00:00Z',
        content: '<p>hello world</p>',
      });

      const result = await artifact({ action: 'get', artifactId: 'a1' }, createCtx());

      expect(result.action).toBe('get');
      expect(result.title).toBe('Report');
      expect(result.text).toContain('Artifact a1');
      expect(result.text).toContain('Kind: html');
      expect(result.text).toContain('Revision: 2');
      expect(result.text).toContain('<p>hello world</p>');
    });

    it('returns artifact with body when body is empty', async () => {
      mockGet.mockReturnValue({
        id: 'a1',
        kind: 'mermaid',
        title: 'Diagram',
        revision: 1,
        updatedAt: '2025-01-01T00:00:00Z',
        content: '',
      });

      const result = await artifact({ action: 'get', artifactId: 'a1' }, createCtx());
      expect(result.text).toContain('Revision: 1');
    });

    it('throws when artifact is not found', async () => {
      mockGet.mockReturnValue(null);
      await expect(artifact({ action: 'get', artifactId: 'a1' }, createCtx())).rejects.toThrow('Artifact a1 was not found');
    });

    it('throws when artifactId is missing', async () => {
      await expect(artifact({ action: 'get' } as never, createCtx())).rejects.toThrow('artifactId is required');
    });
  });

  describe('delete action', () => {
    it('returns success message when deleted', async () => {
      mockDelete.mockReturnValue(true);
      const result = await artifact({ action: 'delete', artifactId: 'a1' }, createCtx());
      expect(result.text).toContain('Deleted artifact a1');
      expect(result.deleted).toBe(true);
      expect(mockInvalidate).toHaveBeenCalledWith('artifacts');
    });

    it('returns message when artifact did not exist', async () => {
      mockDelete.mockReturnValue(false);
      const result = await artifact({ action: 'delete', artifactId: 'a1' }, createCtx());
      expect(result.text).toContain('Artifact a1 did not exist');
      expect(result.deleted).toBe(false);
    });

    it('throws when artifactId is missing for delete', async () => {
      await expect(artifact({ action: 'delete' } as never, createCtx())).rejects.toThrow('artifactId is required');
    });
  });
});

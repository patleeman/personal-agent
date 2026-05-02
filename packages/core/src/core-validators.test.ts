import { describe, expect, it } from 'vitest';

import { validateConversationArtifactId, validateConversationArtifactKind } from './conversation-artifacts.js';
import { validateConversationCheckpointId } from './conversation-checkpoints.js';
import { validateConversationCommitCheckpointId } from './conversation-commit-checkpoints.js';

describe('validateConversationCheckpointId', () => {
  it('accepts valid checkpoint ids', () => {
    expect(() => validateConversationCheckpointId('abc123')).not.toThrow();
    expect(() => validateConversationCheckpointId('abc123def456')).not.toThrow();
  });

  it('throws for empty id', () => {
    expect(() => validateConversationCheckpointId('')).toThrow();
  });

  it('throws for whitespace-only id', () => {
    expect(() => validateConversationCheckpointId('   ')).toThrow();
  });
});

describe('validateConversationArtifactId', () => {
  it('accepts valid artifact ids', () => {
    expect(() => validateConversationArtifactId('my-artifact')).not.toThrow();
    expect(() => validateConversationArtifactId('test-123')).not.toThrow();
  });

  it('throws for empty id', () => {
    expect(() => validateConversationArtifactId('')).toThrow();
  });

  it('throws for whitespace-only id', () => {
    expect(() => validateConversationArtifactId('   ')).toThrow();
  });
});

describe('validateConversationArtifactKind', () => {
  it('accepts valid kinds', () => {
    expect(() => validateConversationArtifactKind('html')).not.toThrow();
    expect(() => validateConversationArtifactKind('mermaid')).not.toThrow();
    expect(() => validateConversationArtifactKind('latex')).not.toThrow();
  });

  it('throws for invalid kinds', () => {
    expect(() => validateConversationArtifactKind('pdf')).toThrow();
    expect(() => validateConversationArtifactKind('')).toThrow();
  });
});

describe('validateConversationCommitCheckpointId', () => {
  it('accepts valid commit checkpoint ids', () => {
    expect(() => validateConversationCommitCheckpointId('abc123d')).not.toThrow();
    expect(() => validateConversationCommitCheckpointId('deadbeefcafe')).not.toThrow();
  });

  it('throws for empty id', () => {
    expect(() => validateConversationCommitCheckpointId('')).toThrow();
  });
});

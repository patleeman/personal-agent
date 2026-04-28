import { describe, expect, it } from 'vitest';
import { readArtifactPresentation } from './conversationArtifacts.js';

describe('conversationArtifacts', () => {
  it('ignores unsafe artifact revisions from tool details', () => {
    expect(readArtifactPresentation({
      type: 'tool_use',
      id: 'tool-1',
      tool: 'artifact',
      input: { action: 'save', artifactId: 'artifact-1', title: 'Artifact', kind: 'html' },
      details: { action: 'save', artifactId: 'artifact-1', title: 'Artifact', kind: 'html', revision: Number.MAX_SAFE_INTEGER + 1 },
      status: 'done',
    } as never)?.revision).toBeUndefined();
  });
});

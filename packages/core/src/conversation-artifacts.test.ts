import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteConversationArtifact,
  getConversationArtifact,
  listConversationArtifacts,
  resolveConversationArtifactPath,
  resolveConversationArtifactsDir,
  resolveProfileConversationArtifactsDir,
  saveConversationArtifact,
  validateConversationArtifactId,
} from './conversation-artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-conversation-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

describe('conversation artifact paths', () => {
  it('resolves the profile artifact directory', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveProfileConversationArtifactsDir({ stateRoot, profile: 'datadog' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'conversation-artifacts', 'datadog'),
    );
  });

  it('resolves the conversation artifact directory and file path', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveConversationArtifactsDir({ stateRoot, profile: 'datadog', conversationId: 'conv-123' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'conversation-artifacts', 'datadog', 'conv-123'),
    );

    expect(
      resolveConversationArtifactPath({
        stateRoot,
        profile: 'datadog',
        conversationId: 'conv-123',
        artifactId: 'mockup',
      }),
    ).toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-artifacts', 'datadog', 'conv-123', 'mockup.json'));
  });

  it('rejects invalid artifact ids', () => {
    expect(() => validateConversationArtifactId('bad/id')).toThrow('Invalid artifact id');
  });
});

describe('conversation artifact storage', () => {
  it('creates, reads, updates, and lists artifacts newest-first', () => {
    const stateRoot = createTempStateRoot();

    const first = saveConversationArtifact({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      title: 'Retry flow',
      kind: 'mermaid',
      content: 'flowchart TD\nA-->B',
      createdAt: '2026-03-12T16:00:00.000Z',
      updatedAt: '2026-03-12T16:00:00.000Z',
    });

    expect(first.id).toBe('retry-flow');
    expect(first.revision).toBe(1);

    const second = saveConversationArtifact({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      artifactId: first.id,
      title: 'Retry flow diagram',
      kind: 'mermaid',
      content: 'flowchart TD\nA-->C',
      updatedAt: '2026-03-12T16:05:00.000Z',
    });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.revision).toBe(2);
    expect(second.title).toBe('Retry flow diagram');

    const other = saveConversationArtifact({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      title: 'Interactive mockup',
      kind: 'html',
      content: '<div>Hello</div>',
      updatedAt: '2026-03-12T16:10:00.000Z',
    });

    expect(
      getConversationArtifact({
        stateRoot,
        profile: 'datadog',
        conversationId: 'conv-123',
        artifactId: first.id,
      }),
    ).toMatchObject({
      id: first.id,
      revision: 2,
      content: 'flowchart TD\nA-->C',
    });

    expect(listConversationArtifacts({ stateRoot, profile: 'datadog', conversationId: 'conv-123' }).map((artifact) => artifact.id)).toEqual(
      [other.id, first.id],
    );
  });

  it('skips unreadable artifact files while listing', () => {
    const stateRoot = createTempStateRoot();

    const artifact = saveConversationArtifact({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      title: 'Good artifact',
      kind: 'html',
      content: '<div>Good</div>',
    });
    const dir = resolveConversationArtifactsDir({ stateRoot, profile: 'datadog', conversationId: 'conv-123' });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.json'), '{ nope');

    expect(listConversationArtifacts({ stateRoot, profile: 'datadog', conversationId: 'conv-123' }).map((item) => item.id)).toEqual([
      artifact.id,
    ]);
  });

  it('creates unique ids when titles collide', () => {
    const stateRoot = createTempStateRoot();

    const first = saveConversationArtifact({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      title: 'Demo artifact',
      kind: 'html',
      content: '<div>One</div>',
    });

    const second = saveConversationArtifact({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      title: 'Demo artifact',
      kind: 'html',
      content: '<div>Two</div>',
    });

    expect(first.id).toBe('demo-artifact');
    expect(second.id).toBe('demo-artifact-2');
  });

  it('deletes artifacts by id', () => {
    const stateRoot = createTempStateRoot();

    const artifact = saveConversationArtifact({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      artifactId: 'mockup',
      title: 'Mockup',
      kind: 'html',
      content: '<div>Mockup</div>',
    });

    expect(
      deleteConversationArtifact({
        stateRoot,
        profile: 'datadog',
        conversationId: 'conv-123',
        artifactId: artifact.id,
      }),
    ).toBe(true);

    expect(
      getConversationArtifact({
        stateRoot,
        profile: 'datadog',
        conversationId: 'conv-123',
        artifactId: artifact.id,
      }),
    ).toBeNull();
  });
});

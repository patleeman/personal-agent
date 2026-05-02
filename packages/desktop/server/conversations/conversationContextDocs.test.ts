import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildAttachedConversationContextDocsContext,
  readConversationContextDocs,
  writeConversationContextDocs,
} from './conversationContextDocs.js';

function createStateRoot(): string {
  return mkdtempSync(join(tmpdir(), 'personal-agent-conversation-context-docs-'));
}

describe('conversationContextDocs', () => {
  it('writes, dedupes, and reads attached context docs', () => {
    const stateRoot = createStateRoot();

    const saved = writeConversationContextDocs({
      stateRoot,
      conversationId: 'conversation-1',
      attachedContextDocs: [
        {
          path: '/vault/work/design.md',
          title: 'Design',
          kind: 'doc',
          mentionId: '@design',
          summary: 'Primary design brief',
        },
        {
          path: '/vault/work/design.md',
          title: 'Duplicate',
          kind: 'doc',
        },
        {
          path: '/vault/references/schema.sql',
          title: 'schema.sql',
          kind: 'file',
        },
      ],
    });

    expect(saved).toEqual([
      {
        path: '/vault/work/design.md',
        title: 'Design',
        kind: 'doc',
        mentionId: '@design',
        summary: 'Primary design brief',
      },
      {
        path: '/vault/references/schema.sql',
        title: 'schema.sql',
        kind: 'file',
      },
    ]);

    expect(readConversationContextDocs('conversation-1', stateRoot)).toEqual(saved);
  });

  it('builds a readable prompt context block', () => {
    const context = buildAttachedConversationContextDocsContext([
      {
        path: '/vault/work/design.md',
        title: 'Design',
        kind: 'doc',
        mentionId: '@design',
        summary: 'Primary design brief',
      },
    ]);

    expect(context).toContain('Attached conversation context docs:');
    expect(context).toContain('Design');
    expect(context).toContain('/vault/work/design.md');
    expect(context).toContain('Primary design brief');
    expect(context).toContain('@design');
  });
});

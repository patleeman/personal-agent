import { describe, expect, it } from 'vitest';
import {
  COMPANION_CONVERSATIONS_PATH,
  COMPANION_INBOX_PATH,
  COMPANION_SYSTEM_PATH,
  COMPANION_TASKS_PATH,
  buildCompanionConversationPath,
  buildCompanionPagePath,
  buildCompanionPagesFilterPath,
  buildCompanionTaskPath,
  resolveCompanionRouteRedirect,
} from './routes.js';

describe('companion route builders', () => {
  it('encodes detail ids for companion links and collapses page helpers to inbox', () => {
    expect(buildCompanionConversationPath('conv/123')).toBe('/app/conversations/conv%2F123');
    expect(buildCompanionTaskPath('task/123')).toBe('/app/tasks/task%2F123');
    expect(buildCompanionPagePath('project', 'continuous conversations')).toBe(COMPANION_INBOX_PATH);
    expect(buildCompanionPagePath('note', 'memory/123')).toBe(COMPANION_INBOX_PATH);
    expect(buildCompanionPagePath('skill', 'agent-browser')).toBe(COMPANION_INBOX_PATH);
    expect(buildCompanionPagesFilterPath('page')).toBe(COMPANION_INBOX_PATH);
  });
});

describe('resolveCompanionRouteRedirect', () => {
  it('allows the canonical companion routes through unchanged', () => {
    expect(resolveCompanionRouteRedirect('/app')).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_INBOX_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_CONVERSATIONS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_TASKS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_SYSTEM_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123')).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123')).toBeNull();
  });

  it('canonicalizes trailing slashes to the supported companion routes', () => {
    expect(resolveCompanionRouteRedirect('/app/')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/inbox/')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/')).toBe(COMPANION_CONVERSATIONS_PATH);
    expect(resolveCompanionRouteRedirect('/app/tasks/')).toBe(COMPANION_TASKS_PATH);
    expect(resolveCompanionRouteRedirect('/app/system/')).toBe(COMPANION_SYSTEM_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/')).toBe('/app/conversations/conv-123');
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123/')).toBe('/app/tasks/task-123');
  });

  it('redirects legacy knowledge and page-role routes back to inbox', () => {
    expect(resolveCompanionRouteRedirect('/app/knowledge')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/knowledge/')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/notes')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/skills')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/memories')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/notes/memory-index')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/memories/memory-index')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/skills/agent-browser')).toBe(COMPANION_INBOX_PATH);
  });

  it('redirects unsupported companion paths back to inbox', () => {
    expect(resolveCompanionRouteRedirect('/app/unknown')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/notes/memory-index/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/skills/agent-browser/extra')).toBe(COMPANION_INBOX_PATH);
  });

  it('ignores non-companion paths', () => {
    expect(resolveCompanionRouteRedirect('/conversations')).toBeNull();
    expect(resolveCompanionRouteRedirect('/application')).toBeNull();
  });
});

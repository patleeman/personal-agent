import { describe, expect, it } from 'vitest';
import {
  COMPANION_CONVERSATIONS_PATH,
  COMPANION_INBOX_PATH,
  COMPANION_PAGES_PATH,
  COMPANION_QUICK_NOTE_PATH,
  COMPANION_SYSTEM_PATH,
  COMPANION_TASKS_PATH,
  buildCompanionConversationPath,
  buildCompanionPagePath,
  buildCompanionPagesFilterPath,
  buildCompanionTaskPath,
  resolveCompanionRouteRedirect,
} from './routes.js';

describe('companion route builders', () => {
  it('encodes detail ids for companion links', () => {
    expect(buildCompanionConversationPath('conv/123')).toBe('/app/conversations/conv%2F123');
    expect(buildCompanionTaskPath('task/123')).toBe('/app/tasks/task%2F123');
    expect(buildCompanionPagePath('project', 'continuous conversations')).toBe('/app/pages?kind=project&page=continuous+conversations');
    expect(buildCompanionPagePath('note', 'memory/123')).toBe('/app/pages?kind=note&page=memory%2F123');
    expect(buildCompanionPagePath('skill', 'agent-browser')).toBe('/app/pages?kind=skill&page=agent-browser');
    expect(buildCompanionPagesFilterPath('page')).toBe('/app/pages?type=page');
  });
});

describe('resolveCompanionRouteRedirect', () => {
  it('allows the canonical companion routes through unchanged', () => {
    expect(resolveCompanionRouteRedirect('/app')).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_INBOX_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_CONVERSATIONS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_TASKS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_SYSTEM_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_PAGES_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_QUICK_NOTE_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123')).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123')).toBeNull();
  });

  it('canonicalizes trailing slashes to the supported companion routes', () => {
    expect(resolveCompanionRouteRedirect('/app/')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/inbox/')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/')).toBe(COMPANION_CONVERSATIONS_PATH);
    expect(resolveCompanionRouteRedirect('/app/tasks/')).toBe(COMPANION_TASKS_PATH);
    expect(resolveCompanionRouteRedirect('/app/system/')).toBe(COMPANION_SYSTEM_PATH);
    expect(resolveCompanionRouteRedirect('/app/pages/')).toBe(COMPANION_PAGES_PATH);
    expect(resolveCompanionRouteRedirect('/app/capture/')).toBe(COMPANION_QUICK_NOTE_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/')).toBe('/app/conversations/conv-123');
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123/')).toBe('/app/tasks/task-123');
  });

  it('redirects legacy knowledge and page-role routes to the canonical pages surface', () => {
    expect(resolveCompanionRouteRedirect('/app/knowledge')).toBe(COMPANION_PAGES_PATH);
    expect(resolveCompanionRouteRedirect('/app/knowledge/')).toBe(COMPANION_PAGES_PATH);
    expect(resolveCompanionRouteRedirect('/app/projects')).toBe(COMPANION_PAGES_PATH);
    expect(resolveCompanionRouteRedirect('/app/notes')).toBe(COMPANION_PAGES_PATH);
    expect(resolveCompanionRouteRedirect('/app/skills')).toBe(COMPANION_PAGES_PATH);
    expect(resolveCompanionRouteRedirect('/app/memories')).toBe(COMPANION_PAGES_PATH);
    expect(resolveCompanionRouteRedirect('/app/projects/continuous-conversations')).toBe('/app/pages?kind=project&page=continuous-conversations');
    expect(resolveCompanionRouteRedirect('/app/notes/memory-index')).toBe('/app/pages?kind=note&page=memory-index');
    expect(resolveCompanionRouteRedirect('/app/memories/memory-index')).toBe('/app/pages?kind=note&page=memory-index');
    expect(resolveCompanionRouteRedirect('/app/skills/agent-browser')).toBe('/app/pages?kind=skill&page=agent-browser');
  });

  it('redirects unsupported companion paths back to the conversation list', () => {
    expect(resolveCompanionRouteRedirect('/app/unknown')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/projects/continuous-conversations/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/notes/memory-index/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/skills/agent-browser/extra')).toBe(COMPANION_INBOX_PATH);
  });

  it('ignores non-companion paths', () => {
    expect(resolveCompanionRouteRedirect('/conversations')).toBeNull();
    expect(resolveCompanionRouteRedirect('/application')).toBeNull();
  });
});

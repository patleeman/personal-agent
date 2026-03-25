import { describe, expect, it } from 'vitest';
import {
  COMPANION_CONVERSATIONS_PATH,
  COMPANION_INBOX_PATH,
  COMPANION_MEMORIES_PATH,
  COMPANION_PROJECTS_PATH,
  COMPANION_SKILLS_PATH,
  COMPANION_SYSTEM_PATH,
  COMPANION_TASKS_PATH,
  buildCompanionConversationPath,
  buildCompanionMemoryPath,
  buildCompanionProjectPath,
  buildCompanionSkillPath,
  buildCompanionTaskPath,
  resolveCompanionRouteRedirect,
} from './routes.js';

describe('companion route builders', () => {
  it('encodes detail ids for companion links', () => {
    expect(buildCompanionConversationPath('conv/123')).toBe('/app/conversations/conv%2F123');
    expect(buildCompanionTaskPath('task/123')).toBe('/app/tasks/task%2F123');
    expect(buildCompanionProjectPath('continuous conversations')).toBe('/app/projects/continuous%20conversations');
    expect(buildCompanionMemoryPath('memory/123')).toBe('/app/memories/memory%2F123');
    expect(buildCompanionSkillPath('tool-agent-browser')).toBe('/app/skills/tool-agent-browser');
  });
});

describe('resolveCompanionRouteRedirect', () => {
  it('allows the canonical companion routes through unchanged', () => {
    expect(resolveCompanionRouteRedirect('/app')).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_INBOX_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_CONVERSATIONS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_TASKS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_SYSTEM_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_PROJECTS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_MEMORIES_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_SKILLS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123')).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123')).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/projects/continuous-conversations')).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/memories/memory-index')).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/skills/tool-agent-browser')).toBeNull();
  });

  it('canonicalizes trailing slashes to the supported companion routes', () => {
    expect(resolveCompanionRouteRedirect('/app/')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/inbox/')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/')).toBe(COMPANION_CONVERSATIONS_PATH);
    expect(resolveCompanionRouteRedirect('/app/tasks/')).toBe(COMPANION_TASKS_PATH);
    expect(resolveCompanionRouteRedirect('/app/system/')).toBe(COMPANION_SYSTEM_PATH);
    expect(resolveCompanionRouteRedirect('/app/projects/')).toBe(COMPANION_PROJECTS_PATH);
    expect(resolveCompanionRouteRedirect('/app/memories/')).toBe(COMPANION_MEMORIES_PATH);
    expect(resolveCompanionRouteRedirect('/app/skills/')).toBe(COMPANION_SKILLS_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/')).toBe('/app/conversations/conv-123');
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123/')).toBe('/app/tasks/task-123');
    expect(resolveCompanionRouteRedirect('/app/projects/continuous-conversations/')).toBe('/app/projects/continuous-conversations');
    expect(resolveCompanionRouteRedirect('/app/memories/memory-index/')).toBe('/app/memories/memory-index');
    expect(resolveCompanionRouteRedirect('/app/skills/tool-agent-browser/')).toBe('/app/skills/tool-agent-browser');
  });

  it('redirects unsupported companion paths back to the conversation list', () => {
    expect(resolveCompanionRouteRedirect('/app/unknown')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/tasks/task-123/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/projects/continuous-conversations/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/memories/memory-index/extra')).toBe(COMPANION_INBOX_PATH);
    expect(resolveCompanionRouteRedirect('/app/skills/tool-agent-browser/extra')).toBe(COMPANION_INBOX_PATH);
  });

  it('ignores non-companion paths', () => {
    expect(resolveCompanionRouteRedirect('/conversations')).toBeNull();
    expect(resolveCompanionRouteRedirect('/application')).toBeNull();
  });
});

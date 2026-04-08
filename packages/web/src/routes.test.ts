import { describe, expect, it } from 'vitest';
import { WEB_INSTRUCTIONS_PATH, resolveWebRouteRedirect } from './routes.js';

describe('resolveWebRouteRedirect', () => {
  it('redirects legacy docs routes into a new conversation', () => {
    expect(resolveWebRouteRedirect('/notes')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/notes/memory-index')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/memories')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/memories/memory-index')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/skills')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/skills/agent-browser')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/nodes', '?kind=project&page=continuous-conversations')).toBe('/conversations/new');
  });

  it('keeps instruction redirects for legacy knowledge links', () => {
    expect(resolveWebRouteRedirect('/knowledge')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/knowledge', '?section=projects&project=continuous-conversations')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/knowledge', '?section=skills&skill=agent-browser')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/knowledge', '?section=instructions&instruction=%2Ftmp%2Fshared%2FAGENTS.md')).toBe('/instructions?instruction=%2Ftmp%2Fshared%2FAGENTS.md');
  });

  it('normalizes trailing slashes on legacy routes', () => {
    expect(resolveWebRouteRedirect('/notes/memory-index/')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/knowledge/', '?section=instructions&instruction=%2Ftmp%2Fshared%2FAGENTS.md')).toBe('/instructions?instruction=%2Ftmp%2Fshared%2FAGENTS.md');
  });

  it('redirects legacy project routes into a new conversation', () => {
    expect(resolveWebRouteRedirect('/projects')).toBe('/conversations/new');
    expect(resolveWebRouteRedirect('/projects/continuous-conversations')).toBe('/conversations/new');
  });

  it('ignores canonical and unrelated routes', () => {
    expect(resolveWebRouteRedirect(WEB_INSTRUCTIONS_PATH)).toBeNull();
    expect(resolveWebRouteRedirect('/workspace/files')).toBeNull();
    expect(resolveWebRouteRedirect('/conversations')).toBeNull();
    expect(resolveWebRouteRedirect('/projects/continuous-conversations/extra')).toBeNull();
  });
});

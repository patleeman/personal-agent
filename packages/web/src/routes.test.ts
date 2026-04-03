import { describe, expect, it } from 'vitest';
import { WEB_INSTRUCTIONS_PATH, WEB_PAGES_PATH, resolveWebRouteRedirect } from './routes.js';

describe('resolveWebRouteRedirect', () => {
  it('redirects legacy page-role routes to the canonical pages surface', () => {
    expect(resolveWebRouteRedirect('/projects')).toBe('/pages?type=page');
    expect(resolveWebRouteRedirect('/projects/continuous-conversations')).toBe('/pages?kind=project&page=continuous-conversations');
    expect(resolveWebRouteRedirect('/notes')).toBe('/pages?type=page');
    expect(resolveWebRouteRedirect('/notes/memory-index')).toBe('/pages?kind=note&page=memory-index');
    expect(resolveWebRouteRedirect('/memories')).toBe('/pages?type=page');
    expect(resolveWebRouteRedirect('/memories/memory-index')).toBe('/pages?kind=note&page=memory-index');
    expect(resolveWebRouteRedirect('/skills')).toBe('/pages?type=skill');
    expect(resolveWebRouteRedirect('/skills/agent-browser')).toBe('/pages?kind=skill&page=agent-browser');
    expect(resolveWebRouteRedirect('/nodes', '?kind=project&page=continuous-conversations')).toBe('/pages?kind=project&page=continuous-conversations');
  });

  it('maps legacy knowledge selections onto pages and instructions', () => {
    expect(resolveWebRouteRedirect('/knowledge')).toBe('/pages?type=page');
    expect(resolveWebRouteRedirect('/knowledge', '?section=projects&project=continuous-conversations')).toBe('/pages?kind=project&page=continuous-conversations');
    expect(resolveWebRouteRedirect('/knowledge', '?section=notes&note=memory-index')).toBe('/pages?kind=note&page=memory-index');
    expect(resolveWebRouteRedirect('/knowledge', '?section=memories&memory=memory-index')).toBe('/pages?kind=note&page=memory-index');
    expect(resolveWebRouteRedirect('/knowledge', '?section=skills&skill=agent-browser')).toBe('/pages?kind=skill&page=agent-browser');
    expect(resolveWebRouteRedirect('/knowledge', '?section=instructions&instruction=%2Ftmp%2Fshared%2FAGENTS.md')).toBe('/instructions?instruction=%2Ftmp%2Fshared%2FAGENTS.md');
  });

  it('normalizes trailing slashes on legacy routes', () => {
    expect(resolveWebRouteRedirect('/projects/')).toBe('/pages?type=page');
    expect(resolveWebRouteRedirect('/notes/memory-index/')).toBe('/pages?kind=note&page=memory-index');
    expect(resolveWebRouteRedirect('/knowledge/', '?section=instructions&instruction=%2Ftmp%2Fshared%2FAGENTS.md')).toBe('/instructions?instruction=%2Ftmp%2Fshared%2FAGENTS.md');
  });

  it('ignores canonical and unrelated routes', () => {
    expect(resolveWebRouteRedirect(WEB_PAGES_PATH)).toBeNull();
    expect(resolveWebRouteRedirect(WEB_INSTRUCTIONS_PATH)).toBeNull();
    expect(resolveWebRouteRedirect('/conversations')).toBeNull();
    expect(resolveWebRouteRedirect('/projects/continuous-conversations/extra')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { WEB_INSTRUCTIONS_PATH, resolveWebRouteRedirect } from './routes.js';

describe('resolveWebRouteRedirect', () => {
  it('redirects legacy docs routes into the workspace', () => {
    expect(resolveWebRouteRedirect('/notes')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/notes/memory-index')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/memories')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/memories/memory-index')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/skills')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/skills/agent-browser')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/nodes', '?kind=project&page=continuous-conversations')).toBe('/workspace/files');
  });

  it('keeps instruction redirects for legacy knowledge links', () => {
    expect(resolveWebRouteRedirect('/knowledge')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/knowledge', '?section=projects&project=continuous-conversations')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/knowledge', '?section=skills&skill=agent-browser')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/knowledge', '?section=instructions&instruction=%2Ftmp%2Fshared%2FAGENTS.md')).toBe('/instructions?instruction=%2Ftmp%2Fshared%2FAGENTS.md');
  });

  it('normalizes trailing slashes on legacy routes', () => {
    expect(resolveWebRouteRedirect('/notes/memory-index/')).toBe('/workspace/files');
    expect(resolveWebRouteRedirect('/knowledge/', '?section=instructions&instruction=%2Ftmp%2Fshared%2FAGENTS.md')).toBe('/instructions?instruction=%2Ftmp%2Fshared%2FAGENTS.md');
  });

  it('ignores canonical and unrelated routes', () => {
    expect(resolveWebRouteRedirect(WEB_INSTRUCTIONS_PATH)).toBeNull();
    expect(resolveWebRouteRedirect('/workspace/files')).toBeNull();
    expect(resolveWebRouteRedirect('/conversations')).toBeNull();
    expect(resolveWebRouteRedirect('/projects')).toBeNull();
    expect(resolveWebRouteRedirect('/projects/continuous-conversations')).toBeNull();
    expect(resolveWebRouteRedirect('/projects/continuous-conversations/extra')).toBeNull();
  });
});

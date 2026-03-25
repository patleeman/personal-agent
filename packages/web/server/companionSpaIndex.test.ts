import { describe, expect, it } from 'vitest';
import { shouldServeCompanionIndex } from './companionSpaIndex.js';

describe('shouldServeCompanionIndex', () => {
  it('serves the companion shell for /app routes', () => {
    expect(shouldServeCompanionIndex('/')).toBe(true);
    expect(shouldServeCompanionIndex('/app')).toBe(true);
    expect(shouldServeCompanionIndex('/app/')).toBe(true);
    expect(shouldServeCompanionIndex('/app/conversations')).toBe(true);
    expect(shouldServeCompanionIndex('/app/projects/project-1')).toBe(true);
    expect(shouldServeCompanionIndex('/app/unknown')).toBe(true);
  });

  it('serves stripped companion routes for path-proxy deployments', () => {
    expect(shouldServeCompanionIndex('/conversations')).toBe(true);
    expect(shouldServeCompanionIndex('/conversations/conv-123')).toBe(true);
    expect(shouldServeCompanionIndex('/projects')).toBe(true);
    expect(shouldServeCompanionIndex('/memories/memory-index')).toBe(true);
    expect(shouldServeCompanionIndex('/skills/tool-agent-browser')).toBe(true);
  });

  it('keeps non-companion routes as 404s on the companion server', () => {
    expect(shouldServeCompanionIndex('/api/activity')).toBe(false);
    expect(shouldServeCompanionIndex('/assets/missing.js')).toBe(false);
    expect(shouldServeCompanionIndex('/icon.svg')).toBe(false);
    expect(shouldServeCompanionIndex('/unknown')).toBe(false);
  });
});

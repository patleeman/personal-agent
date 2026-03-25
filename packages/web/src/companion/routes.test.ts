import { describe, expect, it } from 'vitest';
import {
  COMPANION_CONVERSATIONS_PATH,
  buildCompanionConversationPath,
  resolveCompanionRouteRedirect,
} from './routes.js';

describe('buildCompanionConversationPath', () => {
  it('encodes conversation ids for companion links', () => {
    expect(buildCompanionConversationPath('conv/123')).toBe('/app/conversations/conv%2F123');
  });
});

describe('resolveCompanionRouteRedirect', () => {
  it('allows the canonical companion routes through unchanged', () => {
    expect(resolveCompanionRouteRedirect('/app')).toBeNull();
    expect(resolveCompanionRouteRedirect(COMPANION_CONVERSATIONS_PATH)).toBeNull();
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123')).toBeNull();
  });

  it('canonicalizes trailing slashes to the supported companion routes', () => {
    expect(resolveCompanionRouteRedirect('/app/')).toBe(COMPANION_CONVERSATIONS_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/')).toBe(COMPANION_CONVERSATIONS_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/')).toBe('/app/conversations/conv-123');
  });

  it('redirects unsupported companion paths back to the conversation list', () => {
    expect(resolveCompanionRouteRedirect('/app/unknown')).toBe(COMPANION_CONVERSATIONS_PATH);
    expect(resolveCompanionRouteRedirect('/app/conversations/conv-123/extra')).toBe(COMPANION_CONVERSATIONS_PATH);
  });

  it('ignores non-companion paths', () => {
    expect(resolveCompanionRouteRedirect('/conversations')).toBeNull();
    expect(resolveCompanionRouteRedirect('/application')).toBeNull();
  });
});

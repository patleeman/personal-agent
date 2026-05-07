import { describe, expect, it } from 'vitest';

import { buildExtensionFileSrc } from './ExtensionFrame';

describe('buildExtensionFileSrc', () => {
  it('encodes extension file entries and launch context', () => {
    expect(
      buildExtensionFileSrc({
        extensionId: 'agent board',
        entry: 'frontend/rail panel.html',
        surfaceId: 'conversation-rail',
        route: null,
        pathname: '/conversations/session-1',
        search: '?run=run-1',
        hash: '#details',
        conversationId: 'session-1',
        cwd: '/tmp/work repo',
      }),
    ).toBe(
      '/api/extensions/agent%20board/files/frontend/rail%20panel.html?surfaceId=conversation-rail&route=&pathname=%2Fconversations%2Fsession-1&search=%3Frun%3Drun-1&hash=%23details&conversationId=session-1&cwd=%2Ftmp%2Fwork+repo',
    );
  });
});

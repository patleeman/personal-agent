import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  attachGatewayConversation,
  detachArchivedGatewayConversations,
  ensureGatewayConnection,
  readGatewayState,
} from './gatewayState.js';

let tempDir: string | null = null;

function makeStateRoot(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'pa-gateway-state-'));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('gatewayState', () => {
  it('creates a telegram gateway connection', () => {
    const stateRoot = makeStateRoot();

    ensureGatewayConnection({ stateRoot, profile: 'shared', provider: 'telegram' });
    const state = readGatewayState({ stateRoot, profile: 'shared' });

    expect(state.connections).toMatchObject([{ provider: 'telegram', label: 'Telegram', status: 'needs_config' }]);
  });

  it('allows only one attached telegram conversation per connection', () => {
    const stateRoot = makeStateRoot();

    attachGatewayConversation({ stateRoot, profile: 'shared', provider: 'telegram', conversationId: 'conv-a', conversationTitle: 'A' });
    const state = attachGatewayConversation({
      stateRoot,
      profile: 'shared',
      provider: 'telegram',
      conversationId: 'conv-b',
      conversationTitle: 'B',
    });

    expect(state.bindings).toHaveLength(1);
    expect(state.bindings[0]).toMatchObject({ conversationId: 'conv-b', conversationTitle: 'B' });
  });

  it('detaches archived conversations from gateways', () => {
    const stateRoot = makeStateRoot();
    attachGatewayConversation({ stateRoot, profile: 'shared', provider: 'telegram', conversationId: 'conv-a', conversationTitle: 'A' });

    const state = detachArchivedGatewayConversations({ stateRoot, profile: 'shared', conversationIds: ['conv-a'] });

    expect(state.bindings).toEqual([]);
    expect(state.events[0]?.message).toContain('archived');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import gatewayContextExtension from './gateway-context.js';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

function setupBeforeAgentStartHandler(): (event: { systemPrompt?: string }) => { systemPrompt: string } | undefined {
  const handlers = new Map<string, (event: { systemPrompt?: string }) => { systemPrompt: string } | undefined>();

  const api = {
    on: vi.fn((event: string, handler: (event: { systemPrompt?: string }) => { systemPrompt: string } | undefined) => {
      handlers.set(event, handler);
    }),
  };

  gatewayContextExtension(api as any);

  const handler = handlers.get('before_agent_start');
  if (!handler) {
    throw new Error('before_agent_start handler was not registered');
  }

  return handler;
}

describe('gateway context extension', () => {
  it('appends gateway context prompt for telegram provider', () => {
    process.env.PERSONAL_AGENT_GATEWAY_MODE = '1';
    process.env.PERSONAL_AGENT_GATEWAY_PROVIDER = 'telegram';

    const handler = setupBeforeAgentStartHandler();
    const result = handler({ systemPrompt: 'base system prompt' });

    expect(result?.systemPrompt).toContain('base system prompt');
    expect(result?.systemPrompt).toContain('GATEWAY_RUNTIME_CONTEXT');
    expect(result?.systemPrompt).toContain('Telegram-specific capabilities:');
    expect(result?.systemPrompt).toContain('Do NOT include code snippets');
    expect(result?.systemPrompt).toContain('do not include local file paths unless asked');
    expect(result?.systemPrompt).toContain('/regenerate');
  });

  it('does not modify system prompt when gateway mode is disabled', () => {
    delete process.env.PERSONAL_AGENT_GATEWAY_MODE;

    const handler = setupBeforeAgentStartHandler();
    const result = handler({ systemPrompt: 'base system prompt' });

    expect(result).toBeUndefined();
  });
});

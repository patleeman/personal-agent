import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import exitAliasExtension from './exit-alias';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('exit-alias shared extension', () => {
  it('registers /exit outside gateway mode and shuts down cleanly', async () => {
    const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> | void }> = {};

    const pi = {
      registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: any) => Promise<void> | void }) => {
        commands[name] = command;
      }),
    };

    exitAliasExtension(pi as never);

    expect(commands.exit).toBeDefined();
    expect(commands.exit?.description).toBe('Alias for /quit');

    const shutdown = vi.fn();
    await commands.exit?.handler('', { shutdown });

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('does not register /exit in gateway mode', () => {
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_GATEWAY_MODE: '1',
    };

    const registerCommand = vi.fn();

    exitAliasExtension({ registerCommand } as never);

    expect(registerCommand).not.toHaveBeenCalled();
  });
});

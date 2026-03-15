import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export default function exitAliasExtension(pi: ExtensionAPI): void {
  if (process.env.PERSONAL_AGENT_GATEWAY_MODE === '1') {
    return;
  }

  pi.registerCommand('exit', {
    description: 'Alias for /quit',
    handler: async (_args, ctx) => {
      ctx.shutdown();
    },
  });
}

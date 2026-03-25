import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export default function exitAliasExtension(pi: ExtensionAPI): void {
  pi.registerCommand('exit', {
    description: 'Alias for /quit',
    handler: async (_args, ctx) => {
      ctx.shutdown();
    },
  });
}

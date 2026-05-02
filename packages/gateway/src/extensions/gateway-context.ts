import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { composePromptCatalogEntries } from '@personal-agent/resources';

type GatewayProvider = 'telegram' | 'unknown';

function resolveGatewayProvider(): GatewayProvider {
  const raw = (process.env.PERSONAL_AGENT_GATEWAY_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'telegram') {
    return raw;
  }

  return 'unknown';
}

function buildGatewayContextBlock(provider: GatewayProvider): string {
  const paths = ['runtime/gateway.md'];
  if (provider === 'telegram') {
    paths.push('runtime/gateway-telegram.md');
  }

  return composePromptCatalogEntries(paths);
}

export default function gatewayContextExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', (event) => {
    if (process.env.PERSONAL_AGENT_GATEWAY_MODE !== '1') {
      return;
    }

    const systemPrompt = event.systemPrompt?.trim();
    if (!systemPrompt) {
      return;
    }

    const provider = resolveGatewayProvider();
    const block = buildGatewayContextBlock(provider);

    return {
      systemPrompt: `${event.systemPrompt}\n\n${block}`,
    };
  });
}

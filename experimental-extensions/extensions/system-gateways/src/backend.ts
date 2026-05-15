import type { ExtensionBackendContext } from '@personal-agent/extensions';
import {
  readTelegramGatewayServiceStatus,
  startTelegramGatewayService,
  stopTelegramGatewayService,
} from '@personal-agent/extensions/backend/gateways';

export async function startTelegramGateway(_input: unknown, ctx: ExtensionBackendContext): Promise<() => Promise<void>> {
  await startTelegramGatewayService();
  ctx.log.info('telegram gateway service started');
  return async () => {
    await stopTelegramGatewayService();
  };
}

export async function telegramGatewayStatus(): Promise<unknown> {
  return readTelegramGatewayServiceStatus();
}

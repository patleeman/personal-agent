function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/gateways must be resolved by the Personal Agent host runtime.');
}

export const startTelegramGatewayService = (..._args: unknown[]): unknown => hostResolved();
export const stopTelegramGatewayService = (..._args: unknown[]): unknown => hostResolved();
export const readTelegramGatewayServiceStatus = (..._args: unknown[]): unknown => hostResolved();

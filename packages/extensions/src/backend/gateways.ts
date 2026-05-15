function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/gateways must be resolved by the Personal Agent host runtime.');
}

export const startTelegramGatewayService = (..._args: any[]): any => hostResolved();
export const stopTelegramGatewayService = (..._args: any[]): any => hostResolved();
export const readTelegramGatewayServiceStatus = (..._args: any[]): any => hostResolved();

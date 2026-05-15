import { callServerModuleExport } from './serverModuleResolver.js';

async function callModuleExport<T>(specifier: string, name: string, ...args: unknown[]): Promise<T> {
  try {
    return await callServerModuleExport<T>(specifier, name, ...args);
  } catch (error) {
    if (error instanceof Error && error.message === `Backend API export ${name} is unavailable.`) {
      throw new Error(`Gateways backend API export ${name} is unavailable.`);
    }
    throw error;
  }
}

export async function startTelegramGatewayService(...args: unknown[]) {
  return callModuleExport('../routes/gateways.js', 'startTelegramGatewayRuntime', ...args);
}

export async function stopTelegramGatewayService(...args: unknown[]) {
  return callModuleExport('../routes/gateways.js', 'stopTelegramGatewayRuntime', ...args);
}

export async function readTelegramGatewayServiceStatus(...args: unknown[]) {
  return callModuleExport('../routes/gateways.js', 'readTelegramGatewayRuntimeStatus', ...args);
}

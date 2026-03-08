export interface GatewayExtensionRuntimeContext {
  provider: 'telegram' | 'discord';
  conversationId: string;
}

const runtimeContextBySessionManager = new WeakMap<object, GatewayExtensionRuntimeContext>();

export function setGatewayExtensionRuntimeContext(
  sessionManager: object,
  context: GatewayExtensionRuntimeContext,
): void {
  runtimeContextBySessionManager.set(sessionManager, context);
}

export function getGatewayExtensionRuntimeContext(
  sessionManager: object,
): GatewayExtensionRuntimeContext | undefined {
  return runtimeContextBySessionManager.get(sessionManager);
}

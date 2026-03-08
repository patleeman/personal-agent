export interface GatewayExtensionRuntimeContext {
  provider: 'telegram' | 'discord';
  conversationId: string;
}

const GATEWAY_RUNTIME_CONTEXT_SYMBOL = Symbol.for('personal-agent.gateway.runtime-context');
const runtimeContextBySessionManager = new WeakMap<object, GatewayExtensionRuntimeContext>();

type SessionManagerWithGatewayRuntimeContext = {
  [GATEWAY_RUNTIME_CONTEXT_SYMBOL]?: GatewayExtensionRuntimeContext;
};

export function setGatewayExtensionRuntimeContext(
  sessionManager: object,
  context: GatewayExtensionRuntimeContext,
): void {
  runtimeContextBySessionManager.set(sessionManager, context);
  (sessionManager as SessionManagerWithGatewayRuntimeContext)[GATEWAY_RUNTIME_CONTEXT_SYMBOL] = context;
}

export function getGatewayExtensionRuntimeContext(
  sessionManager: object,
): GatewayExtensionRuntimeContext | undefined {
  return runtimeContextBySessionManager.get(sessionManager)
    ?? (sessionManager as SessionManagerWithGatewayRuntimeContext)[GATEWAY_RUNTIME_CONTEXT_SYMBOL];
}

let companionRuntimeProvider;
export function setCompanionRuntimeProvider(provider) {
  companionRuntimeProvider = provider;
}
export function getCompanionRuntimeProvider() {
  return companionRuntimeProvider;
}
export async function resolveCompanionRuntime(config) {
  if (!companionRuntimeProvider) return null;
  return companionRuntimeProvider(config);
}

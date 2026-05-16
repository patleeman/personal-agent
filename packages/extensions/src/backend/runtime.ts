function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/runtime must be resolved by the Personal Agent host runtime.');
}

export const buildLiveSessionExtensionFactoriesForRuntime = (..._args: unknown[]): unknown => hostResolved();
export const buildLiveSessionResourceOptionsForRuntime = (..._args: unknown[]): unknown => hostResolved();
export const getRuntimeDir = (..._args: unknown[]): unknown => hostResolved();
export const buildSessionContextForRuntime = (..._args: unknown[]): unknown => hostResolved();

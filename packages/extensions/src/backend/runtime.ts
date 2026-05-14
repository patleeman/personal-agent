function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/runtime must be resolved by the Personal Agent host runtime.');
}

export const buildLiveSessionExtensionFactoriesForRuntime = (..._args: any[]): any => hostResolved();
export const buildLiveSessionResourceOptionsForRuntime = (..._args: any[]): any => hostResolved();
export const getRuntimeDir = (..._args: any[]): any => hostResolved();
export const buildSessionContextForRuntime = (..._args: any[]): any => hostResolved();

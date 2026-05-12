function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/events must be resolved by the Personal Agent host runtime.');
}

export const invalidateAppTopics = (..._args: any[]): any => hostResolved();
export const publishAppEvent = (..._args: any[]): any => hostResolved();
export const persistAppTelemetryEvent = (..._args: any[]): any => hostResolved();

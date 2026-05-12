function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/runs must be resolved by the Personal Agent host runtime.');
}

export const cancelDurableRun = (..._args: any[]): any => hostResolved();
export const followUpDurableRun = (..._args: any[]): any => hostResolved();
export const getDurableRun = (..._args: any[]): any => hostResolved();
export const getDurableRunLog = (..._args: any[]): any => hostResolved();
export const listDurableRuns = (..._args: any[]): any => hostResolved();
export const rerunDurableRun = (..._args: any[]): any => hostResolved();
export const applyScheduledTaskThreadBinding = (..._args: any[]): any => hostResolved();
export const invalidateAppTopics = (..._args: any[]): any => hostResolved();
export const persistAppTelemetryEvent = (..._args: any[]): any => hostResolved();
export const startBackgroundRun = (..._args: any[]): any => hostResolved();
export const createStoredAutomation = (..._args: any[]): any => hostResolved();
export const parseDeferredResumeDelayMs = (..._args: any[]): any => hostResolved();
export const pingDaemon = (..._args: any[]): any => hostResolved();
export const setTaskCallbackBinding = (..._args: any[]): any => hostResolved();

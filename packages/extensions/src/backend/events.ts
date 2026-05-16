function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/events must be resolved by the Personal Agent host runtime.');
}

export const invalidateAppTopics = (..._args: unknown[]): unknown => hostResolved();
export const publishAppEvent = (..._args: unknown[]): unknown => hostResolved();

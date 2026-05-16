function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/browser must be resolved by the Personal Agent host runtime.');
}

export type WorkbenchBrowserToolHost = unknown;
export const getWorkbenchBrowserToolHost = (..._args: unknown[]): unknown => hostResolved();

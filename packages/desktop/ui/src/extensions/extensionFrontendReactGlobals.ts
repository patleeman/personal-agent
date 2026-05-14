import * as React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';

declare global {
  // Shared React objects used by compiled native extension frontend bundles.
  // Extension bundles must not ship their own React copy or hooks will read a
  // different dispatcher than the host renderer.
  // eslint-disable-next-line no-var
  var __PA_REACT__: typeof React | undefined;
  // eslint-disable-next-line no-var
  var __PA_REACT_JSX_RUNTIME__: typeof ReactJsxRuntime | undefined;
}

export function ensureExtensionFrontendReactGlobals() {
  globalThis.__PA_REACT__ ??= React;
  globalThis.__PA_REACT_JSX_RUNTIME__ ??= ReactJsxRuntime;
}

import * as React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';

declare global {
  // Shared React objects used by compiled native extension frontend bundles.
  // Extension bundles must not ship their own React copy or hooks will read a
  // different dispatcher than the host renderer.
  // eslint-disable-next-line no-var
  var __PA_REACT__: typeof React | undefined;
  // eslint-disable-next-line no-var
  var __PA_REACT_DOM__: typeof ReactDom | undefined;
  // eslint-disable-next-line no-var
  var __PA_REACT_DOM_CLIENT__: typeof ReactDomClient | undefined;
  // eslint-disable-next-line no-var
  var __PA_REACT_JSX_RUNTIME__: typeof ReactJsxRuntime | undefined;
}

export function ensureExtensionFrontendReactGlobals() {
  globalThis.__PA_REACT__ ??= React;
  globalThis.__PA_REACT_DOM__ ??= ReactDom;
  globalThis.__PA_REACT_DOM_CLIENT__ ??= ReactDomClient;
  globalThis.__PA_REACT_JSX_RUNTIME__ ??= ReactJsxRuntime;
}

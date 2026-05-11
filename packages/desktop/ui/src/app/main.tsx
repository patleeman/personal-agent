import '@fontsource-variable/dm-sans';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { addNotification } from '../components/notifications/notificationStore';
import { recordRendererTelemetry } from '../telemetry/appTelemetry';
import { App } from './App';

// ── Renderer-side crash logging ───────────────────────────────────────────────
// These fire for uncaught JS errors and unhandled promise rejections in the
// renderer process. They pipe to the main process log via the desktop bridge.

window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.message : event.message || 'Script error';
  const stack = event.error instanceof Error ? event.error.stack : undefined;

  console.error('[renderer] uncaught error', event.error ?? event.message);
  recordRendererTelemetry({
    category: 'renderer',
    name: 'uncaught_error',
    route: `${window.location.pathname}${window.location.search}`,
    metadata: { message, stack, filename: event.filename, lineno: event.lineno, colno: event.colno },
  });

  addNotification({
    type: 'error',
    message: `Uncaught error: ${message}`,
    details: stack,
    source: 'core',
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'unknown');
  const stack = event.reason instanceof Error ? event.reason.stack : undefined;

  console.error('[renderer] unhandled rejection', reason);
  recordRendererTelemetry({
    category: 'renderer',
    name: 'unhandled_rejection',
    route: `${window.location.pathname}${window.location.search}`,
    metadata: { reason, stack },
  });

  addNotification({
    type: 'warning',
    message: `Unhandled rejection: ${reason}`,
    details: stack,
    source: 'core',
  });
});

// ── Desktop shell detection ───────────────────────────────────────────────────

const desktopShellParams = new URLSearchParams(window.location.search);
if (desktopShellParams.get('desktop-shell') === '1') {
  try {
    window.sessionStorage.setItem('__pa_desktop_shell__', '1');
  } catch {
    // Ignore storage failures.
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

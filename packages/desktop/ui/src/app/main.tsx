import '@fontsource-variable/dm-sans';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import 'katex/dist/katex.min.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// ── Renderer-side crash logging ───────────────────────────────────────────────
// These fire for uncaught JS errors and unhandled promise rejections in the
// renderer process. They pipe to the main process log via the desktop bridge.

window.addEventListener('error', (event) => {
  try {
    const bridge = window.personalAgentDesktop;
    if (bridge && typeof bridge.getEnvironment === 'function') {
      // Best-effort: the bridge is available in the desktop shell.
      // Actual log writing is done through the main process via IPC.
    }
  } catch {
    // Ignore bridge access errors.
  }

  console.error('[renderer] uncaught error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'unknown');
  console.error('[renderer] unhandled rejection', reason);
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

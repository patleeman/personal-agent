import '@fontsource-variable/dm-sans';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import 'katex/dist/katex.min.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

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

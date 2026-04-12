function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildDesktopStartupErrorPageHtml(input: {
  message: string;
  logsDir: string;
}): string {
  const message = escapeHtml(input.message.trim() || 'Desktop startup failed.');
  const logsDir = escapeHtml(input.logsDir.trim());

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Personal Agent Startup Error</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #17130d;
        --panel: #211b14;
        --panel-border: rgba(238, 214, 182, 0.12);
        --text: #f7efe5;
        --muted: #c1b3a1;
        --accent: #d09a4c;
        --accent-strong: #e2ae64;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(208, 154, 76, 0.16), transparent 34%),
          linear-gradient(180deg, #1a1510 0%, var(--bg) 100%);
        color: var(--text);
        font: 15px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        padding: 32px;
      }

      .panel {
        width: min(720px, 100%);
        background: color-mix(in srgb, var(--panel) 92%, black);
        border: 1px solid var(--panel-border);
        border-radius: 22px;
        padding: 28px;
        box-shadow: 0 30px 90px rgba(0, 0, 0, 0.34);
      }

      .eyebrow {
        margin: 0 0 10px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: 29px;
        line-height: 1.15;
      }

      p {
        margin: 14px 0 0;
        color: var(--muted);
      }

      .error {
        margin: 22px 0 0;
        padding: 16px 18px;
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.08);
        white-space: pre-wrap;
        word-break: break-word;
      }

      .logs {
        margin: 18px 0 0;
        font-size: 13px;
        color: var(--muted);
      }

      .logs code {
        color: var(--text);
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }

      button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 11px 16px;
        cursor: pointer;
        font: inherit;
        transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
      }

      button:hover {
        transform: translateY(-1px);
      }

      .primary {
        background: var(--accent);
        color: #261705;
        font-weight: 700;
      }

      .primary:hover {
        background: var(--accent-strong);
      }

      .secondary {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text);
      }

      .secondary:hover {
        background: rgba(255, 255, 255, 0.12);
      }

      .hint {
        margin-top: 18px;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <p class="eyebrow">Desktop Startup Error</p>
      <h1>Personal Agent couldn’t finish starting.</h1>
      <p>The desktop shell hit an error before it could open the normal app surface.</p>
      <div class="error">${message}</div>
      <p class="logs">Logs: <code>${logsDir}</code></p>
      <div class="actions">
        <button class="primary" id="open-logs" type="button">Open logs</button>
        <button class="secondary" id="try-again" type="button">Try again</button>
      </div>
      <p class="hint">If the problem is a busy port or another stuck runtime, closing the conflicting process and then trying again is usually enough.</p>
    </main>
    <script>
      const logsDir = ${JSON.stringify(input.logsDir)};
      const desktop = window.personalAgentDesktop;

      document.getElementById('open-logs')?.addEventListener('click', async () => {
        if (!desktop?.openPath) {
          return;
        }

        try {
          await desktop.openPath(logsDir);
        } catch (error) {
          console.error('Failed to open logs', error);
        }
      });

      document.getElementById('try-again')?.addEventListener('click', () => {
        window.location.href = 'personal-agent://app/';
      });
    </script>
  </body>
</html>`;
}

export function buildDesktopStartupErrorPageDataUrl(input: {
  message: string;
  logsDir: string;
}): string {
  return `data:text/html;charset=UTF-8,${encodeURIComponent(buildDesktopStartupErrorPageHtml(input))}`;
}

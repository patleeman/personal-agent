import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';

export interface DesktopAboutDetails {
  applicationName: string;
  applicationVersion: string;
  piVersion: string;
  iconDataUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readVersionFromPackageJson(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
        return parsed.version.trim();
      }
    } catch {
      // Ignore malformed or unreadable package metadata and try the next candidate.
    }
  }

  return null;
}

export function resolveDesktopAboutVersionsForPaths(currentDir: string, cwd = process.cwd()): {
  applicationVersion: string;
  piVersion: string;
} {
  const packageDir = resolve(currentDir, '..');
  const applicationVersion = readVersionFromPackageJson([
    resolve(packageDir, 'package.json'),
  ]) ?? 'Unknown';
  const piVersion = readVersionFromPackageJson([
    resolve(packageDir, 'node_modules', '@mariozechner', 'pi-coding-agent', 'package.json'),
    resolve(packageDir, '..', '..', 'node_modules', '@mariozechner', 'pi-coding-agent', 'package.json'),
    resolve(cwd, 'node_modules', '@mariozechner', 'pi-coding-agent', 'package.json'),
  ]) ?? 'Unknown';

  return {
    applicationVersion,
    piVersion,
  };
}

function readDesktopIconDataUrl(iconFile: string): string {
  const iconBuffer = readFileSync(iconFile);
  return `data:image/png;base64,${iconBuffer.toString('base64')}`;
}

export function resolveDesktopAboutDetails(currentDir = dirname(fileURLToPath(import.meta.url))): DesktopAboutDetails {
  const versions = resolveDesktopAboutVersionsForPaths(currentDir);
  const runtime = resolveDesktopRuntimePaths();

  return {
    applicationName: app.name || 'Personal Agent',
    applicationVersion: versions.applicationVersion === 'Unknown' ? app.getVersion() : versions.applicationVersion,
    piVersion: versions.piVersion,
    iconDataUrl: readDesktopIconDataUrl(runtime.colorIconFile),
  };
}

export function buildDesktopAboutPageHtml(details: DesktopAboutDetails): string {
  const applicationName = escapeHtml(details.applicationName);
  const applicationVersion = escapeHtml(details.applicationVersion);
  const piVersion = escapeHtml(details.piVersion);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>About ${applicationName}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #17130d;
        --panel: rgba(33, 27, 20, 0.96);
        --panel-border: rgba(238, 214, 182, 0.12);
        --text: #f7efe5;
        --muted: #c1b3a1;
        --accent: #e2ae64;
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
          radial-gradient(circle at top, rgba(208, 154, 76, 0.16), transparent 36%),
          linear-gradient(180deg, #1a1510 0%, var(--bg) 100%);
        color: var(--text);
        font: 15px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        padding: 24px;
      }

      .panel {
        width: min(360px, 100%);
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        padding: 28px 24px 22px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
        text-align: center;
      }

      .icon {
        width: 72px;
        height: 72px;
        display: block;
        margin: 0 auto 18px;
        border-radius: 18px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.26);
      }

      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }

      p {
        margin: 10px 0 0;
        color: var(--muted);
      }

      .versions {
        margin: 22px 0 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }

      .version-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 18px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
      }

      dt {
        margin: 0;
        color: var(--muted);
        font-weight: 600;
      }

      dd {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <img class="icon" src="${details.iconDataUrl}" alt="${applicationName} logo" />
      <h1>${applicationName}</h1>
      <p>Local desktop shell for Personal Agent.</p>
      <dl class="versions">
        <div class="version-row">
          <dt>Personal Agent</dt>
          <dd>${applicationVersion}</dd>
        </div>
        <div class="version-row">
          <dt>Pi</dt>
          <dd>${piVersion}</dd>
        </div>
      </dl>
    </main>
  </body>
</html>`;
}

export function buildDesktopAboutPageDataUrl(details: DesktopAboutDetails): string {
  return `data:text/html;charset=UTF-8,${encodeURIComponent(buildDesktopAboutPageHtml(details))}`;
}

export class DesktopAboutWindowController {
  private window?: BrowserWindow;

  show(): void {
    const details = resolveDesktopAboutDetails();
    const title = `About ${details.applicationName}`;

    if (this.window && !this.window.isDestroyed()) {
      this.window.setTitle(title);
      void this.window.loadURL(buildDesktopAboutPageDataUrl(details));
      this.showWindow(this.window);
      return;
    }

    const parentWindow = BrowserWindow.getFocusedWindow();
    const window = new BrowserWindow({
      width: 420,
      height: 360,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title,
      icon: resolveDesktopRuntimePaths().colorIconFile,
      backgroundColor: '#17130d',
      ...(parentWindow ? { parent: parentWindow } : {}),
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const }
        : {}),
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });

    window.on('closed', () => {
      if (this.window === window) {
        this.window = undefined;
      }
    });

    window.once('ready-to-show', () => {
      this.showWindow(window);
    });

    this.window = window;
    void window.loadURL(buildDesktopAboutPageDataUrl(details));
  }

  private showWindow(window: BrowserWindow): void {
    if (!window.isVisible()) {
      window.show();
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.focus();
  }
}

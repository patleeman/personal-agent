import { describe, expect, it } from 'vitest';
import {
  buildDesktopStartupErrorPageDataUrl,
  buildDesktopStartupErrorPageHtml,
} from './startup-error-page.js';

describe('startup error page helpers', () => {
  it('renders the error details, logs path, and desktop actions', () => {
    const html = buildDesktopStartupErrorPageHtml({
      message: 'Port 3741 <busy> & blocked',
      logsDir: '/tmp/logs',
    });

    expect(html).toContain('Personal Agent couldn’t finish starting.');
    expect(html).toContain('Port 3741 &lt;busy&gt; &amp; blocked');
    expect(html).toContain('Logs: <code>/tmp/logs</code>');
    expect(html).toContain('desktop.openPath(logsDir)');
    expect(html).toContain("window.location.href = 'personal-agent://app/'");
  });

  it('encodes the HTML into a data URL for BrowserWindow.loadURL', () => {
    const dataUrl = buildDesktopStartupErrorPageDataUrl({
      message: 'boom',
      logsDir: '/tmp/logs',
    });

    expect(dataUrl.startsWith('data:text/html;charset=UTF-8,')).toBe(true);
    expect(decodeURIComponent(dataUrl.slice('data:text/html;charset=UTF-8,'.length))).toContain('boom');
  });
});

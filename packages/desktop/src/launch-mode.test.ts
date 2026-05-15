import { describe, expect, it } from 'vitest';

import { resolveDesktopLaunchPresentation } from './launch-mode.js';

describe('resolveDesktopLaunchPresentation', () => {
  it('defaults to the stable app presentation', () => {
    expect(resolveDesktopLaunchPresentation({})).toEqual({
      mode: 'stable',
      appName: 'Personal Agent',
    });
  });

  it('marks explicit testing launches clearly', () => {
    expect(
      resolveDesktopLaunchPresentation({
        PERSONAL_AGENT_DESKTOP_VARIANT: ' testing ',
      }),
    ).toEqual({
      mode: 'testing',
      appName: 'Personal Agent Testing',
      launchLabel: 'Testing',
    });
  });

  it('treats the dev desktop bundle as a testing launch by default', () => {
    expect(
      resolveDesktopLaunchPresentation({
        PERSONAL_AGENT_DESKTOP_DEV_BUNDLE: '1',
      }),
    ).toEqual({
      mode: 'testing',
      appName: 'Personal Agent Testing',
      launchLabel: 'Testing',
    });
  });

  it('marks explicit dev launches clearly', () => {
    expect(
      resolveDesktopLaunchPresentation({
        PERSONAL_AGENT_RUNTIME_CHANNEL: ' dev ',
      }),
    ).toEqual({
      mode: 'dev',
      appName: 'Personal Agent Dev',
      launchLabel: 'Dev',
    });
  });

  it('marks explicit RC launches clearly', () => {
    expect(
      resolveDesktopLaunchPresentation({
        PERSONAL_AGENT_DESKTOP_VARIANT: ' rc ',
      }),
    ).toEqual({
      mode: 'rc',
      appName: 'Personal Agent RC',
      launchLabel: 'RC',
    });
  });

  it('uses the RC app presentation for packaged RC versions', () => {
    expect(resolveDesktopLaunchPresentation({}, { version: '0.7.9-rc.10', packaged: true })).toEqual({
      mode: 'rc',
      appName: 'Personal Agent RC',
      launchLabel: 'RC',
    });
  });

  it('keeps unpackaged RC versions on the stable presentation unless explicitly marked', () => {
    expect(resolveDesktopLaunchPresentation({}, { version: '0.7.9-rc.10', packaged: false })).toEqual({
      mode: 'stable',
      appName: 'Personal Agent',
    });
  });
});

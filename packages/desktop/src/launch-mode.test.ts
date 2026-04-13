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
    expect(resolveDesktopLaunchPresentation({
      PERSONAL_AGENT_DESKTOP_VARIANT: ' testing ',
    })).toEqual({
      mode: 'testing',
      appName: 'Personal Agent Testing',
      launchLabel: 'Testing',
    });
  });

  it('treats the dev desktop bundle as a testing launch by default', () => {
    expect(resolveDesktopLaunchPresentation({
      PERSONAL_AGENT_DESKTOP_DEV_BUNDLE: '1',
    })).toEqual({
      mode: 'testing',
      appName: 'Personal Agent Testing',
      launchLabel: 'Testing',
    });
  });
});

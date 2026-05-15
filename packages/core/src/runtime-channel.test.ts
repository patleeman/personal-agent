import { describe, expect, it } from 'vitest';

import { readPortOverride, resolvePersonalAgentRuntimeChannel, resolvePersonalAgentRuntimeChannelConfig } from './runtime-channel.js';

describe('runtime channel resolution', () => {
  it('defaults to stable', () => {
    expect(resolvePersonalAgentRuntimeChannel({})).toBe('stable');
    expect(resolvePersonalAgentRuntimeChannelConfig({})).toEqual({
      channel: 'stable',
      stateRootSuffix: '',
      companionPort: 3842,
      codexPort: 3846,
      updatesEnabled: true,
    });
  });

  it('uses RC for packaged prerelease versions', () => {
    expect(resolvePersonalAgentRuntimeChannel({}, { version: '0.8.0-rc.12', packaged: true })).toBe('rc');
    expect(resolvePersonalAgentRuntimeChannelConfig({}, { version: '0.8.0-rc.12', packaged: true }).companionPort).toBe(3843);
  });

  it('keeps unpackaged prerelease versions stable unless explicitly overridden', () => {
    expect(resolvePersonalAgentRuntimeChannel({}, { version: '0.8.0-rc.12', packaged: false })).toBe('stable');
  });

  it('normalizes explicit dev and test aliases', () => {
    expect(resolvePersonalAgentRuntimeChannel({ PERSONAL_AGENT_RUNTIME_CHANNEL: 'development' })).toBe('dev');
    expect(resolvePersonalAgentRuntimeChannel({ PERSONAL_AGENT_DESKTOP_VARIANT: 'testing' })).toBe('test');
  });

  it('validates optional port overrides', () => {
    expect(readPortOverride('3844')).toBe(3844);
    expect(readPortOverride('0')).toBe(0);
    expect(readPortOverride('nope')).toBeUndefined();
    expect(readPortOverride('70000')).toBeUndefined();
  });
});

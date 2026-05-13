import { afterEach, describe, expect, it } from 'vitest';

import { buildLiveSessionExtensionFactoriesForRuntime, buildLiveSessionResourceOptionsForRuntime } from './runtimeAgentHooks.js';

const originalRepoRoot = process.env.PERSONAL_AGENT_REPO_ROOT;
const originalProfile = process.env.PERSONAL_AGENT_PROFILE;
const originalActiveProfile = process.env.PERSONAL_AGENT_ACTIVE_PROFILE;

afterEach(() => {
  if (originalRepoRoot === undefined) {
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
  } else {
    process.env.PERSONAL_AGENT_REPO_ROOT = originalRepoRoot;
  }

  if (originalProfile === undefined) {
    delete process.env.PERSONAL_AGENT_PROFILE;
  } else {
    process.env.PERSONAL_AGENT_PROFILE = originalProfile;
  }

  if (originalActiveProfile === undefined) {
    delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
  } else {
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = originalActiveProfile;
  }
});

describe('runtime agent hooks', () => {
  it('builds live-session resources and extension factories before the app runtime registers builders', () => {
    process.env.PERSONAL_AGENT_REPO_ROOT = process.cwd();
    process.env.PERSONAL_AGENT_PROFILE = 'shared';
    delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;

    const options = buildLiveSessionResourceOptionsForRuntime();
    const factories = buildLiveSessionExtensionFactoriesForRuntime();

    expect(options.additionalExtensionPaths).toEqual(expect.any(Array));
    expect(options.additionalSkillPaths).toEqual(expect.any(Array));
    expect(options.additionalPromptTemplatePaths).toEqual(expect.any(Array));
    expect(options.additionalThemePaths).toEqual(expect.any(Array));
    expect(factories.length).toBeGreaterThan(0);
  });
});

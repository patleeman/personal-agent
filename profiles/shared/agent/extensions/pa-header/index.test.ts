import { mkdtempSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import paHeaderExtension from './index';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  delete process.env.PERSONAL_AGENT_REPO_ROOT;
  delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
  delete process.env.PERSONAL_AGENT_PROFILE;
  delete process.env.PI_CODING_AGENT_DIR;
});

describe('pa-header extension', () => {
  it('shows the active profile name as the header label', async () => {
    const repoRoot = createTempDir('pa-header-repo-');
    const runtimeAgentDir = join(repoRoot, '.runtime-agent');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';
    process.env.PI_CODING_AGENT_DIR = runtimeAgentDir;

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(repoRoot, 'profiles', 'datadog', 'agent'), { recursive: true });
    mkdirSync(runtimeAgentDir, { recursive: true });

    let sessionStartHandler: ((event: unknown, ctx: { hasUI: boolean; cwd: string; ui: { setHeader: (header: unknown) => void } }) => Promise<void>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'session_start') {
          sessionStartHandler = handler as (event: unknown, ctx: { hasUI: boolean; cwd: string; ui: { setHeader: (header: unknown) => void } }) => Promise<void>;
        }
      },
    };

    paHeaderExtension(pi as never);
    expect(sessionStartHandler).toBeDefined();

    const setHeader = vi.fn();
    await sessionStartHandler!({}, {
      hasUI: true,
      cwd: repoRoot,
      ui: { setHeader },
    });

    expect(setHeader).toHaveBeenCalledTimes(1);

    const renderFactory = setHeader.mock.calls[0]?.[0] as (tui: unknown, theme: { fg: (tone: string, text: string) => string }) => { render: (width: number) => string[] };
    const renderable = renderFactory(
      { children: [] },
      { fg: (_tone: string, text: string) => text },
    );

    const lines = renderable.render(200);
    expect(lines[0]).toBe('[datadog]');
    expect(lines.join('\n')).not.toContain('active profile:');
    expect(lines.join('\n')).not.toContain('requested profile:');
    expect(lines.join('\n')).toContain('source AGENTS.md: profiles/datadog/agent/AGENTS.md');
    expect(lines.join('\n')).toContain('runtime AGENTS.md: .runtime-agent/AGENTS.md');
  });

  it('shows requested-profile fallback details when the requested profile is missing', async () => {
    const repoRoot = createTempDir('pa-header-repo-');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'missing-profile';

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });

    let sessionStartHandler: ((event: unknown, ctx: { hasUI: boolean; cwd: string; ui: { setHeader: (header: unknown) => void } }) => Promise<void>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'session_start') {
          sessionStartHandler = handler as (event: unknown, ctx: { hasUI: boolean; cwd: string; ui: { setHeader: (header: unknown) => void } }) => Promise<void>;
        }
      },
    };

    paHeaderExtension(pi as never);

    const setHeader = vi.fn();
    await sessionStartHandler!({}, {
      hasUI: true,
      cwd: repoRoot,
      ui: { setHeader },
    });

    const renderFactory = setHeader.mock.calls[0]?.[0] as (tui: unknown, theme: { fg: (tone: string, text: string) => string }) => { render: (width: number) => string[] };
    const renderable = renderFactory(
      { children: [] },
      { fg: (_tone: string, text: string) => text },
    );

    const lines = renderable.render(200);
    expect(lines[0]).toBe('[shared]');
    expect(lines.join('\n')).toContain('requested profile: missing-profile (using shared)');
    expect(lines.join('\n')).toContain('source AGENTS.md: none (shared profile)');
  });
});

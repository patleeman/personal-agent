import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDesktopRuntimePathsForContext } from './desktop-env.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function seedDevRepo(repoRoot: string): void {
  mkdirSync(join(repoRoot, 'packages', 'daemon', 'dist'), { recursive: true });
  mkdirSync(join(repoRoot, 'packages', 'web', 'dist-server'), { recursive: true });
  mkdirSync(join(repoRoot, 'packages', 'web', 'dist'), { recursive: true });
  mkdirSync(join(repoRoot, 'packages', 'desktop', 'assets'), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), '{"name":"personal-agent"}\n');
  writeFileSync(join(repoRoot, 'packages', 'daemon', 'dist', 'index.js'), 'console.log("daemon");\n');
  writeFileSync(join(repoRoot, 'packages', 'web', 'dist-server', 'index.js'), 'console.log("web");\n');
  writeFileSync(join(repoRoot, 'packages', 'desktop', 'assets', 'iconTemplate.png'), 'png\n');
  writeFileSync(join(repoRoot, 'packages', 'desktop', 'assets', 'icon.png'), 'png\n');
}

function seedPackagedApp(appRoot: string, resourcesPath: string): void {
  mkdirSync(join(appRoot, 'node_modules', '@personal-agent', 'daemon', 'dist'), { recursive: true });
  mkdirSync(join(appRoot, 'node_modules', '@personal-agent', 'web', 'dist-server'), { recursive: true });
  mkdirSync(join(appRoot, 'node_modules', '@personal-agent', 'web', 'dist'), { recursive: true });
  mkdirSync(join(appRoot, 'assets'), { recursive: true });
  mkdirSync(join(resourcesPath, 'defaults'), { recursive: true });
  mkdirSync(join(resourcesPath, 'extensions'), { recursive: true });
  mkdirSync(join(resourcesPath, 'internal-skills'), { recursive: true });
  mkdirSync(join(resourcesPath, 'prompt-catalog'), { recursive: true });
  writeFileSync(join(appRoot, 'node_modules', '@personal-agent', 'daemon', 'dist', 'index.js'), 'console.log("daemon");\n');
  writeFileSync(join(appRoot, 'node_modules', '@personal-agent', 'web', 'dist-server', 'index.js'), 'console.log("web");\n');
  writeFileSync(join(appRoot, 'assets', 'iconTemplate.png'), 'png\n');
  writeFileSync(join(appRoot, 'assets', 'icon.png'), 'png\n');
}

const originalStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

afterEach(() => {
  if (originalStateRoot === undefined) {
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
    return;
  }

  process.env.PERSONAL_AGENT_STATE_ROOT = originalStateRoot;
});

describe('resolveDesktopRuntimePathsForContext', () => {
  it('resolves repo artifacts in development mode', () => {
    const repoRoot = createTempDir('pa-desktop-dev-');
    const stateRoot = createTempDir('pa-desktop-state-');
    seedDevRepo(repoRoot);
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const result = resolveDesktopRuntimePathsForContext({
      currentDir: join(repoRoot, 'packages', 'desktop', 'dist'),
      cwd: repoRoot,
      env: {
        ...process.env,
        PERSONAL_AGENT_NODE_PATH: '/custom/node',
        PERSONAL_AGENT_REPO_ROOT: repoRoot,
      },
      execPath: '/ignored/electron',
      isPackaged: false,
    });

    expect(result.repoRoot).toBe(repoRoot);
    expect(result.nodeCommand).toBe('/custom/node');
    expect(result.useElectronRunAsNode).toBe(false);
    expect(result.daemonEntryFile).toBe(join(repoRoot, 'packages', 'daemon', 'dist', 'index.js'));
    expect(result.webDistDir).toBe(join(repoRoot, 'packages', 'web', 'dist'));
    expect(result.trayTemplateIconFile).toBe(join(repoRoot, 'packages', 'desktop', 'assets', 'iconTemplate.png'));
    expect(result.colorIconFile).toBe(join(repoRoot, 'packages', 'desktop', 'assets', 'icon.png'));
    expect(result.desktopConfigFile).toBe(join(stateRoot, 'desktop', 'config.json'));
    expect(existsSync(dirname(result.desktopLogsDir))).toBe(true);
  });

  it('resolves packaged resources and uses the bundled runtime', () => {
    const appBundleRoot = createTempDir('pa-desktop-app-');
    const resourcesPath = join(appBundleRoot, 'Personal Agent.app', 'Contents', 'Resources');
    const appRoot = join(resourcesPath, 'app.asar');
    const stateRoot = createTempDir('pa-desktop-state-');
    seedPackagedApp(appRoot, resourcesPath);
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const result = resolveDesktopRuntimePathsForContext({
      isPackaged: true,
      appRoot,
      resourcesPath,
      execPath: '/Applications/Personal Agent.app/Contents/MacOS/Personal Agent',
    });

    expect(result.repoRoot).toBe(resourcesPath);
    expect(result.nodeCommand).toBe('/Applications/Personal Agent.app/Contents/MacOS/Personal Agent');
    expect(result.useElectronRunAsNode).toBe(true);
    expect(result.daemonEntryFile).toBe(join(appRoot, 'node_modules', '@personal-agent', 'daemon', 'dist', 'index.js'));
    expect(result.webDistDir).toBe(join(appRoot, 'node_modules', '@personal-agent', 'web', 'dist'));
    expect(result.trayTemplateIconFile).toBe(join(appRoot, 'assets', 'iconTemplate.png'));
    expect(result.colorIconFile).toBe(join(appRoot, 'assets', 'icon.png'));
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLocalConversationAutomationSettings,
  migrateLocalConversationAutomationSettingsToProfile,
  resolveConversationAutomationProfileSettingsFile,
} from './conversationAutomationProfileSettings.js';

const tempDirs: string[] = [];

function createTempDir(prefix = 'pa-conversation-automation-profile-settings-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('conversationAutomationProfileSettings', () => {
  it('migrates local automation settings into the active profile settings file', () => {
    const stateRoot = createTempDir();
    const repoRoot = createTempDir('pa-repo-');
    const profilesRoot = join(stateRoot, 'profiles');
    const localProfileDir = join(stateRoot, 'config', 'local');
    mkdirSync(join(profilesRoot, 'assistant', 'agent'), { recursive: true });
    mkdirSync(join(profilesRoot, 'shared', 'agent'), { recursive: true });
    mkdirSync(join(localProfileDir, 'agent'), { recursive: true });
    writeFileSync(join(profilesRoot, 'shared', 'agent', 'settings.json'), '{}\n');

    writeFileSync(join(localProfileDir, 'agent', 'settings.json'), `${JSON.stringify({
      webUi: {
        conversationAutomation: {
          workflowPresets: {
            presets: [{ id: 'preset-1', name: 'Checkpoint', updatedAt: '2026-03-19T00:00:00.000Z', gates: [] }],
            defaultPresetIds: ['preset-1'],
          },
        },
        conversationAutomationJudge: {
          model: 'openai/gpt-5-mini',
        },
        theme: 'midnight',
      },
    }, null, 2)}\n`);

    const result = migrateLocalConversationAutomationSettingsToProfile('assistant', {
      repoRoot,
      profilesRoot,
      localProfileDir,
    });

    expect(result.migrated).toBe(true);
    expect(result.profileSettingsFile).toBe(resolveConversationAutomationProfileSettingsFile('assistant', {
      repoRoot,
      profilesRoot,
      localProfileDir,
    }));

    const profileSettings = JSON.parse(readFileSync(result.profileSettingsFile, 'utf-8')) as Record<string, unknown>;
    expect(profileSettings).toMatchObject({
      webUi: {
        conversationAutomation: {
          workflowPresets: {
            defaultPresetIds: ['preset-1'],
          },
        },
        conversationAutomationJudge: {
          model: 'openai/gpt-5-mini',
        },
      },
    });

    const localSettings = JSON.parse(readFileSync(result.localSettingsFile, 'utf-8')) as Record<string, unknown>;
    expect(localSettings).toEqual({
      webUi: {
        theme: 'midnight',
      },
    });
  });

  it('clears local automation settings without touching other local settings', () => {
    const stateRoot = createTempDir();
    const repoRoot = createTempDir('pa-repo-');
    const profilesRoot = join(stateRoot, 'profiles');
    const localProfileDir = join(stateRoot, 'config', 'local');
    mkdirSync(join(localProfileDir, 'agent'), { recursive: true });

    const localSettingsFile = join(localProfileDir, 'agent', 'settings.json');
    writeFileSync(localSettingsFile, `${JSON.stringify({
      webUi: {
        conversationAutomation: { workflowPresets: { presets: [], defaultPresetIds: [] } },
        conversationAutomationJudge: { model: 'openai/gpt-5-mini' },
        theme: 'midnight',
      },
    }, null, 2)}\n`);

    const result = clearLocalConversationAutomationSettings({
      repoRoot,
      profilesRoot,
      localProfileDir,
    });

    expect(result.changed).toBe(true);
    expect(JSON.parse(readFileSync(localSettingsFile, 'utf-8'))).toEqual({
      webUi: {
        theme: 'midnight',
      },
    });
  });
});

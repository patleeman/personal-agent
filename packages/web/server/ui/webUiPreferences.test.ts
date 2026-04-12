import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from './webUiPreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-ui-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('readSavedWebUiPreferences', () => {
  it('returns empty ids when the settings file is missing', () => {
    const dir = createTempDir();
    expect(readSavedWebUiPreferences(join(dir, 'settings.json'))).toEqual({
      openConversationIds: [],
      pinnedConversationIds: [],
      archivedConversationIds: [],
      workspacePaths: [],
      nodeBrowserViews: [],
    });
  });

  it('sanitizes stored conversation ids and removes workspace duplicates from archived conversations', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      webUi: {
        openConversationIds: [' session-1 ', '', 'session-2', null, 'session-1'],
        pinnedConversationIds: ['session-2', ' session-3 ', 'session-3'],
        archivedConversationIds: ['session-3', ' session-4 ', '', 'session-1', 'session-4'],
        workspacePaths: [' /tmp/alpha ', '', '/tmp/beta', '/tmp/alpha'],
      },
    }));

    expect(readSavedWebUiPreferences(file)).toEqual({
      openConversationIds: ['session-1'],
      pinnedConversationIds: ['session-2', 'session-3'],
      archivedConversationIds: ['session-4'],
      workspacePaths: ['/tmp/alpha', '/tmp/beta'],
      nodeBrowserViews: [],
    });
  });
});

describe('writeSavedWebUiPreferences', () => {
  it('writes the workspace and archived conversation ids while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultModel: 'gpt-5.4',
      webUi: {
        sidebarCollapsed: true,
      },
    }));

    writeSavedWebUiPreferences({
      openConversationIds: ['session-1', ' session-2 ', 'session-3'],
      pinnedConversationIds: ['session-3', 'session-4', 'session-4'],
      archivedConversationIds: ['session-2', 'session-5', ' session-6 '],
      workspacePaths: [' /tmp/alpha ', '/tmp/beta', '/tmp/alpha'],
    }, file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultModel: 'gpt-5.4',
      webUi: {
        sidebarCollapsed: true,
        openConversationIds: ['session-1', 'session-2'],
        pinnedConversationIds: ['session-3', 'session-4'],
        archivedConversationIds: ['session-5', 'session-6'],
        workspacePaths: ['/tmp/alpha', '/tmp/beta'],
      },
    });
  });

  it('preserves the other lists when only one list is updated', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      webUi: {
        openConversationIds: ['session-1'],
        pinnedConversationIds: ['session-2'],
        archivedConversationIds: ['session-3'],
        workspacePaths: ['/tmp/alpha'],
      },
    }));

    writeSavedWebUiPreferences({ pinnedConversationIds: ['session-4'] }, file);

    expect(readSavedWebUiPreferences(file)).toEqual({
      openConversationIds: ['session-1'],
      pinnedConversationIds: ['session-4'],
      archivedConversationIds: ['session-3'],
      workspacePaths: ['/tmp/alpha'],
      nodeBrowserViews: [],
    });
  });

  it('stores and sanitizes node browser views', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');

    writeSavedWebUiPreferences({
      nodeBrowserViews: [
        { id: ' shared-skills ', name: ' Shared skills ', search: '?q=type:skill', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:01:00.000Z' },
        { id: '', name: 'broken', search: '', createdAt: '', updatedAt: '' },
      ],
    }, file);

    expect(readSavedWebUiPreferences(file)).toEqual({
      openConversationIds: [],
      pinnedConversationIds: [],
      archivedConversationIds: [],
      workspacePaths: [],
      nodeBrowserViews: [
        { id: 'shared-skills', name: 'Shared skills', search: '?q=type:skill', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:01:00.000Z' },
      ],
    });
  });

  it('removes the nested keys when given empty lists', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      webUi: {
        openConversationIds: ['session-1'],
        pinnedConversationIds: ['session-2'],
        archivedConversationIds: ['session-3'],
        workspacePaths: ['/tmp/alpha'],
      },
    }));

    writeSavedWebUiPreferences({ openConversationIds: [], pinnedConversationIds: [], archivedConversationIds: [], workspacePaths: [] }, file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({});
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSavedUiPreferences, writeSavedUiPreferences } from './uiPreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-ui-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('readSavedUiPreferences', () => {
  it('returns empty ids when the settings file is missing', () => {
    const dir = createTempDir();
    expect(readSavedUiPreferences(join(dir, 'settings.json'))).toEqual({
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
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          openConversationIds: [' session-1 ', '', 'session-2', null, 'session-1'],
          pinnedConversationIds: ['session-2', ' session-3 ', 'session-3'],
          archivedConversationIds: ['session-3', ' session-4 ', '', 'session-1', 'session-4'],
          workspacePaths: [' /tmp/alpha/ ', '', '/tmp/beta', '/tmp/alpha'],
        },
      }),
    );

    expect(readSavedUiPreferences(file)).toEqual({
      openConversationIds: ['session-1'],
      pinnedConversationIds: ['session-2', 'session-3'],
      archivedConversationIds: ['session-4'],
      workspacePaths: ['/tmp/alpha', '/tmp/beta'],
      nodeBrowserViews: [],
    });
  });
});

describe('writeSavedUiPreferences', () => {
  it('writes the workspace and archived conversation ids while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        defaultModel: 'gpt-5.4',
        ui: {
          sidebarCollapsed: true,
        },
      }),
    );

    writeSavedUiPreferences(
      {
        openConversationIds: ['session-1', ' session-2 ', 'session-3'],
        pinnedConversationIds: ['session-3', 'session-4', 'session-4'],
        archivedConversationIds: ['session-2', 'session-5', ' session-6 '],
        workspacePaths: [' /tmp/alpha/ ', '/tmp/beta', '/tmp/alpha'],
      },
      file,
    );

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultModel: 'gpt-5.4',
      ui: {
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
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          openConversationIds: ['session-1'],
          pinnedConversationIds: ['session-2'],
          archivedConversationIds: ['session-3'],
          workspacePaths: ['/tmp/alpha'],
        },
      }),
    );

    writeSavedUiPreferences({ pinnedConversationIds: ['session-4'] }, file);

    expect(readSavedUiPreferences(file)).toEqual({
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

    writeSavedUiPreferences(
      {
        nodeBrowserViews: [
          {
            id: ' shared-skills ',
            name: ' Shared skills ',
            search: '?q=type:skill',
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:01:00.000Z',
          },
          { id: '', name: 'broken', search: '', createdAt: '', updatedAt: '' },
        ],
      },
      file,
    );

    expect(readSavedUiPreferences(file)).toEqual({
      openConversationIds: [],
      pinnedConversationIds: [],
      archivedConversationIds: [],
      workspacePaths: [],
      nodeBrowserViews: [
        {
          id: 'shared-skills',
          name: 'Shared skills',
          search: '?q=type:skill',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:01:00.000Z',
        },
      ],
    });
  });

  it('falls back to valid node browser view timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          nodeBrowserViews: [{ id: 'docs', name: 'Docs', search: '', createdAt: 'not-a-date', updatedAt: 'also-not-a-date' }],
        },
      }),
    );

    expect(readSavedUiPreferences(file).nodeBrowserViews).toEqual([
      { id: 'docs', name: 'Docs', search: '', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
    ]);
  });

  it('falls back for non-ISO node browser view timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          nodeBrowserViews: [{ id: 'docs', name: 'Docs', search: '', createdAt: '1', updatedAt: '9999' }],
        },
      }),
    );

    expect(readSavedUiPreferences(file).nodeBrowserViews).toEqual([
      { id: 'docs', name: 'Docs', search: '', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
    ]);
  });

  it('falls back for overflowed node browser view timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          nodeBrowserViews: [
            { id: 'docs', name: 'Docs', search: '', createdAt: '2026-02-31T00:00:00.000Z', updatedAt: '2026-02-31T00:01:00.000Z' },
          ],
        },
      }),
    );

    expect(readSavedUiPreferences(file).nodeBrowserViews).toEqual([
      { id: 'docs', name: 'Docs', search: '', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
    ]);
  });

  it('removes the nested keys when given empty lists', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          openConversationIds: ['session-1'],
          pinnedConversationIds: ['session-2'],
          archivedConversationIds: ['session-3'],
          workspacePaths: ['/tmp/alpha'],
        },
      }),
    );

    writeSavedUiPreferences({ openConversationIds: [], pinnedConversationIds: [], archivedConversationIds: [], workspacePaths: [] }, file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({});
  });
});

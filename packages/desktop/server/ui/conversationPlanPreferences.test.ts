import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readConversationPlanDefaults,
  readConversationPlanLibrary,
  readConversationPlansWorkspace,
  writeConversationPlanDefaults,
  writeConversationPlanLibrary,
} from './conversationPlanPreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-conversation-plan-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('readConversationPlanDefaults', () => {
  it('returns disabled defaults when the settings file is missing', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');

    expect(readConversationPlanDefaults(file)).toEqual({ defaultEnabled: false });
    expect(readConversationPlanLibrary(file)).toEqual({ presets: [], defaultPresetIds: [] });
    expect(readConversationPlansWorkspace(file)).toEqual({
      defaultEnabled: false,
      presetLibrary: { presets: [], defaultPresetIds: [] },
    });
  });

  it('normalizes workflow presets and filters invalid defaults', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      ui: {
        conversationAutomation: {
          defaultEnabled: true,
          workflowPresets: {
            presets: [
              {
                id: ' preset-1 ',
                name: ' Alpha preset ',
                updatedAt: 'not-a-date',
                items: [
                  { kind: 'instruction', label: '  Instruction ', text: '  Follow the plan. ' },
                  { kind: 'skill', label: '  Skill ', skillName: ' backfill-tests ', skillArgs: ' target=models ' },
                  { kind: 'skill', label: 'Broken skill' },
                ],
              },
              { name: 'No id preset', items: [{ kind: 'instruction', text: 'Second item' }] },
              'ignore-me',
            ],
            defaultPresetIds: ['preset-1', 'preset-1', 'preset-2', 'missing'],
          },
        },
      },
    }));

    expect(readConversationPlanDefaults(file)).toEqual({ defaultEnabled: true });
    expect(readConversationPlanLibrary(file)).toEqual({
      presets: [
        {
          id: 'preset-1',
          name: 'Alpha preset',
          updatedAt: '1970-01-01T00:00:00.000Z',
          items: [
            { id: 'item-1', kind: 'instruction', label: 'Instruction', text: 'Follow the plan.' },
            { id: 'item-2', kind: 'skill', label: 'Skill', skillName: 'backfill-tests', skillArgs: 'target=models' },
          ],
        },
        {
          id: 'preset-2',
          name: 'No id preset',
          updatedAt: '1970-01-01T00:00:00.000Z',
          items: [
            { id: 'item-1', kind: 'instruction', label: 'Instruction', text: 'Second item' },
          ],
        },
      ],
      defaultPresetIds: ['preset-1', 'preset-2'],
    });
    expect(readConversationPlansWorkspace(file)).toEqual({
      defaultEnabled: true,
      presetLibrary: {
        presets: [
          expect.objectContaining({ id: 'preset-1' }),
          expect.objectContaining({ id: 'preset-2' }),
        ],
        defaultPresetIds: ['preset-1', 'preset-2'],
      },
    });
  });

  it('falls back for non-ISO workflow preset timestamps', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      ui: {
        conversationAutomation: {
          workflowPresets: {
            presets: [
              {
                id: 'preset-1',
                name: 'Alpha preset',
                updatedAt: '9999',
                items: [{ kind: 'instruction', text: 'Follow the plan.' }],
              },
            ],
          },
        },
      },
    }));

    expect(readConversationPlanLibrary(file).presets[0]?.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('falls back for overflowed workflow preset timestamps', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      ui: {
        conversationAutomation: {
          workflowPresets: {
            presets: [
              {
                id: 'preset-1',
                name: 'Alpha preset',
                updatedAt: '2026-02-31T09:00:00.000Z',
                items: [{ kind: 'instruction', text: 'Follow the plan.' }],
              },
            ],
          },
        },
      },
    }));

    expect(readConversationPlanLibrary(file).presets[0]?.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('writeConversationPlanDefaults', () => {
  it('writes default enablement while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultModel: 'gpt-5.4',
      ui: {
        openConversationIds: ['session-1'],
      },
    }));

    expect(writeConversationPlanDefaults({ defaultEnabled: true }, file)).toEqual({ defaultEnabled: true });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultModel: 'gpt-5.4',
      ui: {
        openConversationIds: ['session-1'],
        conversationAutomation: {
          defaultEnabled: true,
        },
      },
    });
  });
});

describe('writeConversationPlanLibrary', () => {
  it('writes normalized presets while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultModel: 'gpt-5.4',
      ui: {
        openConversationIds: ['session-1'],
        conversationAutomation: {
          defaultEnabled: true,
        },
      },
    }));

    const result = writeConversationPlanLibrary({
      presets: [
        {
          id: ' preset-a ',
          name: ' Reminder preset ',
          items: [
            { kind: 'instruction', text: '  First reminder  ' },
            { kind: 'skill', skillName: ' deep-research ', skillArgs: ' topic=desktop ' },
            { kind: 'instruction', text: '   ' },
          ],
        },
      ],
      defaultPresetIds: ['preset-a', 'missing', 'preset-a'],
    }, file);

    expect(result).toEqual({
      presets: [
        {
          id: 'preset-a',
          name: 'Reminder preset',
          updatedAt: expect.any(String),
          items: [
            { id: 'item-1', kind: 'instruction', label: 'Instruction', text: 'First reminder' },
            { id: 'item-2', kind: 'skill', label: 'Skill', skillName: 'deep-research', skillArgs: 'topic=desktop' },
          ],
        },
      ],
      defaultPresetIds: ['preset-a'],
    });

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultModel: 'gpt-5.4',
      ui: {
        openConversationIds: ['session-1'],
        conversationAutomation: {
          defaultEnabled: true,
          workflowPresets: {
            presets: [
              {
                id: 'preset-a',
                name: 'Reminder preset',
                updatedAt: result.presets[0]?.updatedAt,
                items: [
                  { id: 'item-1', kind: 'instruction', label: 'Instruction', text: 'First reminder' },
                  { id: 'item-2', kind: 'skill', label: 'Skill', skillName: 'deep-research', skillArgs: 'topic=desktop' },
                ],
              },
            ],
            defaultPresetIds: ['preset-a'],
          },
        },
      },
    });
  });
});

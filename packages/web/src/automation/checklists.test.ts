import { describe, expect, it } from 'vitest';
import {
  appendChecklistPresetItems,
  checklistDraftItemsToTemplateItems,
  summarizeChecklistText,
  toChecklistDraftItems,
} from './checklists';

describe('automation checklist helpers', () => {
  it('summarizes long checklist text for labels', () => {
    expect(summarizeChecklistText('Short item')).toBe('Short item');
    expect(summarizeChecklistText('')).toBe('Untitled item');
    expect(summarizeChecklistText('a'.repeat(100))).toBe(`${'a'.repeat(69)}…`);
  });

  it('converts checklist items into editable draft rows and back', () => {
    const draftItems = toChecklistDraftItems([
      {
        id: 'step-1',
        kind: 'instruction',
        label: 'Do the thing',
        text: 'Do the thing',
      },
      {
        id: 'step-2',
        kind: 'skill',
        label: 'Checkpoint',
        skillName: 'checkpoint',
        skillArgs: '--push',
      },
    ]);

    expect(draftItems).toEqual([
      { id: 'step-1', text: 'Do the thing' },
      { id: 'step-2', text: '/skill:checkpoint --push' },
    ]);

    expect(checklistDraftItemsToTemplateItems(draftItems)).toEqual([
      {
        id: 'step-1',
        kind: 'instruction',
        label: 'Do the thing',
        text: 'Do the thing',
      },
      {
        id: 'step-2',
        kind: 'instruction',
        label: '/skill:checkpoint --push',
        text: '/skill:checkpoint --push',
      },
    ]);
  });

  it('appends preset items with fresh ids', () => {
    const result = appendChecklistPresetItems(
      [{ id: 'existing', text: 'Already here' }],
      {
        id: 'preset-1',
        title: 'Preset',
        summary: 'Summary',
        items: [
          { id: 'preset-step', kind: 'instruction', label: 'Investigate', text: 'Investigate carefully' },
        ],
      },
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'existing', text: 'Already here' });
    expect(result[1]?.text).toBe('Investigate carefully');
    expect(result[1]?.id).not.toBe('preset-step');
  });
});

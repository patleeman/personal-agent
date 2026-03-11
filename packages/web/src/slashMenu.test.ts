import { describe, expect, it } from 'vitest';
import { buildSlashMenuItems, parseSlashInput } from './slashMenu';
import type { MemorySkillItem } from './types';

const SKILLS: MemorySkillItem[] = [
  {
    source: 'shared',
    name: 'best-practices-react',
    description: 'React and Next.js performance optimization guidelines.',
    path: '/tmp/react/SKILL.md',
  },
  {
    source: 'shared',
    name: 'best-practices-frontend-design',
    description: 'Create distinctive, production-grade frontend interfaces.',
    path: '/tmp/frontend/SKILL.md',
  },
];

describe('parseSlashInput', () => {
  it('splits slash commands from their argument text', () => {
    expect(parseSlashInput('/model gpt-5.4')).toEqual({ command: '/model', argument: 'gpt-5.4' });
    expect(parseSlashInput('/model ')).toEqual({ command: '/model', argument: '' });
  });
});

describe('buildSlashMenuItems', () => {
  it('fuzzy-finds built-in commands for a generic slash query', () => {
    const items = buildSlashMenuItems('/mdl', SKILLS);
    expect(items[0]?.displayCmd).toBe('/model');
  });

  it('keeps matching slash commands by command token even after an argument starts', () => {
    const items = buildSlashMenuItems('/model gpt', SKILLS);
    expect(items[0]?.displayCmd).toBe('/model');
  });

  it('returns skill entries when the query targets skills', () => {
    const items = buildSlashMenuItems('/ski', SKILLS);
    expect(items.map((item) => item.displayCmd)).toEqual([
      '/skill:best-practices-frontend-design',
      '/skill:best-practices-react',
    ]);
    expect(items.every((item) => item.kind === 'skill')).toBe(true);
  });

  it('fuzzy-filters skills by name after /skill:', () => {
    const items = buildSlashMenuItems('/skill:bpr', SKILLS);
    expect(items[0]?.displayCmd).toBe('/skill:best-practices-react');
  });

  it('does not flood the default slash menu with every skill when only / is typed', () => {
    const items = buildSlashMenuItems('/', SKILLS);
    expect(items.some((item) => item.kind === 'skill')).toBe(false);
    expect(items.some((item) => item.displayCmd === '/model')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { diffTopicSignatures } from './appEvents.js';

describe('diffTopicSignatures', () => {
  it('returns no invalidations on the initial snapshot', () => {
    expect(diffTopicSignatures(null, {
      activity: 'a1',
      projects: 'p1',
      sessions: 's1',
      tasks: 't1',
      runs: 'r1',
    })).toEqual([]);
  });

  it('returns only the topics whose signatures changed', () => {
    expect(diffTopicSignatures({
      activity: 'a1',
      projects: 'p1',
      sessions: 's1',
      tasks: 't1',
      runs: 'r1',
    }, {
      activity: 'a2',
      projects: 'p1',
      sessions: 's2',
      tasks: 't1',
      runs: 'r2',
    })).toEqual(['activity', 'sessions', 'runs']);
  });
});

import { describe, expect, it } from 'vitest';
import { INITIAL_APP_EVENT_TOPICS } from './system.js';

describe('system route initial app topics', () => {
  it('keeps the initial desktop snapshot stream focused on lightweight app summaries', () => {
    expect(INITIAL_APP_EVENT_TOPICS).not.toContain('activity');
    expect(INITIAL_APP_EVENT_TOPICS).not.toContain('alerts');
    expect(INITIAL_APP_EVENT_TOPICS).toEqual([
      'sessions',
      'tasks',
      'runs',
      'daemon',
    ]);
  });
});

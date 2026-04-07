import { describe, expect, it } from 'vitest';
import { INITIAL_APP_EVENT_TOPICS } from './system.js';

describe('system route initial app topics', () => {
  it('keeps the initial desktop snapshot stream focused on lightweight app summaries', () => {
    expect(INITIAL_APP_EVENT_TOPICS).toContain('alerts');
    expect(INITIAL_APP_EVENT_TOPICS).not.toContain('runs');
    expect(INITIAL_APP_EVENT_TOPICS).toEqual([
      'sessions',
      'activity',
      'alerts',
      'tasks',
      'daemon',
      'webUi',
    ]);
  });
});

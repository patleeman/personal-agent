import { describe, expect, it } from 'vitest';
import { deriveCompanionQuickNoteDraft } from './CompanionQuickNotePage.js';

describe('deriveCompanionQuickNoteDraft', () => {
  it('uses the first content line as the title and keeps the rest as the body', () => {
    expect(deriveCompanionQuickNoteDraft('Trip ideas\nBook train tickets\nCheck hotel')).toEqual({
      title: 'Trip ideas',
      body: 'Book train tickets\nCheck hotel',
    });
  });

  it('keeps single-line notes intact so the content is not lost', () => {
    expect(deriveCompanionQuickNoteDraft('Remember to submit expense report')).toEqual({
      title: 'Remember to submit expense report',
      body: 'Remember to submit expense report',
    });
  });

  it('strips common markdown prefixes from the derived title', () => {
    expect(deriveCompanionQuickNoteDraft('- [ ] Buy lemons\nAt the farmer\'s market')).toEqual({
      title: 'Buy lemons',
      body: "At the farmer's market",
    });
  });
});

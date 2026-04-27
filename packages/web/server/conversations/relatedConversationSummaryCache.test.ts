import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readCachedRelatedConversationSummary,
  writeCachedRelatedConversationSummary,
} from './relatedConversationSummaryCache.js';

function makeTempCacheFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pa-related-summary-cache-'));
  const sessionFile = join(dir, 'session.jsonl');
  const cacheFile = join(dir, 'summary-cache.json');
  writeFileSync(sessionFile, '{"type":"session","id":"conv-1"}\n', 'utf-8');
  return { sessionFile, cacheFile };
}

describe('related conversation summary cache', () => {
  it('stores and reuses summaries for the same session file signature and prompt', () => {
    const { sessionFile, cacheFile } = makeTempCacheFixture();

    writeCachedRelatedConversationSummary({
      sessionId: 'conv-1',
      sessionFile,
      prompt: 'Ship the release flow fix.',
      summary: 'Keep the notarization mapping fix.',
      cacheFile,
    });

    expect(readCachedRelatedConversationSummary({
      sessionId: 'conv-1',
      sessionFile,
      prompt: 'Ship   the release flow fix. ',
      cacheFile,
    })).toBe('Keep the notarization mapping fix.');
  });

  it('invalidates cached summaries when the source session file changes', () => {
    const { sessionFile, cacheFile } = makeTempCacheFixture();

    writeCachedRelatedConversationSummary({
      sessionId: 'conv-1',
      sessionFile,
      prompt: 'Ship the release flow fix.',
      summary: 'Old summary.',
      cacheFile,
    });
    writeFileSync(sessionFile, '{"type":"session","id":"conv-1"}\n{"type":"message"}\n', 'utf-8');

    expect(readCachedRelatedConversationSummary({
      sessionId: 'conv-1',
      sessionFile,
      prompt: 'Ship the release flow fix.',
      cacheFile,
    })).toBeNull();
  });

  it('keeps prompts distinct', () => {
    const { sessionFile, cacheFile } = makeTempCacheFixture();

    writeCachedRelatedConversationSummary({
      sessionId: 'conv-1',
      sessionFile,
      prompt: 'Ship the release flow fix.',
      summary: 'Release context.',
      cacheFile,
    });

    expect(readCachedRelatedConversationSummary({
      sessionId: 'conv-1',
      sessionFile,
      prompt: 'Plan auto mode work.',
      cacheFile,
    })).toBeNull();
  });
});

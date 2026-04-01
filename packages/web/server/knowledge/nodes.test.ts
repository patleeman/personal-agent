import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUnifiedNode } from '@personal-agent/core';
import { readNodeBrowserDetail } from './nodes.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-node-browser-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(dir, 'sync', 'profiles');
  return dir;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readNodeBrowserDetail', () => {
  it('returns typed relationships, incoming relationships, and suggestions', () => {
    const stateRoot = createTempStateRoot();
    const profilesRoot = join(stateRoot, 'sync', 'profiles');
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(join(profilesRoot, 'assistant.json'), JSON.stringify({ id: 'assistant' }));

    createUnifiedNode({
      id: 'alpha-note',
      title: 'Alpha Note',
      summary: 'Tracks browser automation patterns.',
      tags: ['type:note', 'area:automation', 'topic:browser'],
      relationships: [{ type: 'depends-on', targetId: 'beta-note' }],
      body: '# Alpha Note\n\nTracks browser automation patterns.',
    }, { profilesRoot });

    createUnifiedNode({
      id: 'beta-note',
      title: 'Beta Note',
      summary: 'Shared browser automation baseline.',
      tags: ['type:note', 'area:automation', 'topic:browser'],
      body: '# Beta Note\n\nShared browser automation baseline.',
    }, { profilesRoot });

    createUnifiedNode({
      id: 'gamma-note',
      title: 'Gamma Note',
      summary: 'Browser automation validation checklist.',
      tags: ['type:note', 'area:automation', 'topic:browser'],
      body: '# Gamma Note\n\nBrowser automation validation checklist.',
    }, { profilesRoot });

    createUnifiedNode({
      id: 'delta-note',
      title: 'Delta Note',
      summary: 'Links back to alpha.',
      tags: ['type:note'],
      relationships: [{ type: 'references', targetId: 'alpha-note' }],
      body: '# Delta Note\n\nLinks back to alpha.',
    }, { profilesRoot });

    const detail = readNodeBrowserDetail('assistant', 'alpha-note');

    expect(detail.outgoingRelationships).toEqual([
      {
        type: 'depends-on',
        node: {
          kind: 'note',
          id: 'beta-note',
          title: 'Beta Note',
          summary: 'Shared browser automation baseline.',
        },
      },
    ]);

    expect(detail.incomingRelationships).toEqual([
      {
        type: 'references',
        node: {
          kind: 'note',
          id: 'delta-note',
          title: 'Delta Note',
          summary: 'Links back to alpha.',
        },
      },
    ]);

    expect(detail.suggestedNodes.map((entry) => entry.node.id)).toContain('gamma-note');
  });
});

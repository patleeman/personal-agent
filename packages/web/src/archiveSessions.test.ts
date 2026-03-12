import { describe, expect, it } from 'vitest';
import { ALL_ARCHIVE_WORKSPACES_VALUE, buildArchiveWorkspaceOptions, filterArchiveSessions } from './archiveSessions';
import type { SessionMeta } from './types';

const SESSIONS: SessionMeta[] = [
  {
    id: 'session-personal-1',
    file: '/tmp/session-personal-1.jsonl',
    timestamp: '2026-03-12T10:11:13.711Z',
    cwd: '/Users/patrick/workingdir/personal-agent',
    cwdSlug: '--Users-patrick-workingdir-personal-agent--',
    model: 'gpt-5.4',
    title: 'Fix the archive modal',
    messageCount: 12,
  },
  {
    id: 'session-home-1',
    file: '/tmp/session-home-1.jsonl',
    timestamp: '2026-03-12T10:41:13.800Z',
    cwd: '/Users/patrick',
    cwdSlug: '--Users-patrick--',
    model: 'gpt-5.4',
    title: 'Run the memory pass',
    messageCount: 8,
  },
  {
    id: 'session-workdir-1',
    file: '/tmp/session-workdir-1.jsonl',
    timestamp: '2026-03-12T10:30:13.216Z',
    cwd: '/Users/patrick/workingdir',
    cwdSlug: '--Users-patrick-workingdir--',
    model: 'gpt-5.4',
    title: 'Create my morning report',
    messageCount: 5,
  },
  {
    id: 'session-personal-2',
    file: '/tmp/session-personal-2.jsonl',
    timestamp: '2026-03-11T22:11:10.788Z',
    cwd: '/Users/patrick/workingdir/personal-agent',
    cwdSlug: '--Users-patrick-workingdir-personal-agent--',
    model: 'gpt-5.4',
    title: 'Investigate sidebar behavior',
    messageCount: 7,
  },
] satisfies SessionMeta[];

describe('archiveSessions', () => {
  it('returns all sessions across workspaces when no workspace filter is selected', () => {
    expect(filterArchiveSessions(SESSIONS, '', ALL_ARCHIVE_WORKSPACES_VALUE).map((session) => session.id)).toEqual([
      'session-personal-1',
      'session-home-1',
      'session-workdir-1',
      'session-personal-2',
    ]);
  });

  it('filters by workspace after starting from the full archive set', () => {
    expect(filterArchiveSessions(SESSIONS, '', '/Users/patrick/workingdir/personal-agent').map((session) => session.id)).toEqual([
      'session-personal-1',
      'session-personal-2',
    ]);
  });

  it('searches across title, cwd, and id within the selected workspace scope', () => {
    expect(filterArchiveSessions(SESSIONS, 'morning', ALL_ARCHIVE_WORKSPACES_VALUE).map((session) => session.id)).toEqual([
      'session-workdir-1',
    ]);
    expect(filterArchiveSessions(SESSIONS, 'patrick', '/Users/patrick').map((session) => session.id)).toEqual([
      'session-home-1',
    ]);
    expect(filterArchiveSessions(SESSIONS, 'session-personal-2', '/Users/patrick/workingdir/personal-agent').map((session) => session.id)).toEqual([
      'session-personal-2',
    ]);
  });

  it('builds workspace options ordered by freshest conversation in each workspace', () => {
    expect(buildArchiveWorkspaceOptions(SESSIONS)).toEqual([
      {
        value: '/Users/patrick',
        label: '/Users/patrick',
        count: 1,
        latestTimestamp: '2026-03-12T10:41:13.800Z',
      },
      {
        value: '/Users/patrick/workingdir',
        label: '/Users/patrick/workingdir',
        count: 1,
        latestTimestamp: '2026-03-12T10:30:13.216Z',
      },
      {
        value: '/Users/patrick/workingdir/personal-agent',
        label: '/Users/patrick/workingdir/personal-agent',
        count: 2,
        latestTimestamp: '2026-03-12T10:11:13.711Z',
      },
    ]);
  });
});

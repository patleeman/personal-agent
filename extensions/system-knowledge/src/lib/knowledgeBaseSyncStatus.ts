import type { KnowledgeBaseState } from '@personal-agent/extensions/knowledge';

export interface KnowledgeBaseSyncPresentation {
  text: string;
  toneClass: string;
  dotClass: string;
  pulse: boolean;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function getKnowledgeBaseSyncPresentation(
  state: KnowledgeBaseState | null | undefined,
  options: { includeLastSyncAt?: boolean } = {},
): KnowledgeBaseSyncPresentation {
  if (!state) {
    return {
      text: 'Loading sync status…',
      toneClass: 'text-dim',
      dotClass: 'bg-border-subtle',
      pulse: true,
    };
  }

  if (!state.configured) {
    return {
      text: 'Managed sync off',
      toneClass: 'text-dim',
      dotClass: 'bg-border-subtle',
      pulse: false,
    };
  }

  if (state.syncStatus === 'syncing') {
    return {
      text: 'Syncing…',
      toneClass: 'text-accent',
      dotClass: 'bg-accent',
      pulse: true,
    };
  }

  if (state.syncStatus === 'error') {
    return {
      text: state.lastError ? `Sync failed · ${state.lastError}` : 'Sync failed',
      toneClass: 'text-danger',
      dotClass: 'bg-danger',
      pulse: false,
    };
  }

  const gitStatus = state.gitStatus ?? null;
  if (gitStatus) {
    const parts: string[] = [];
    if (gitStatus.localChangeCount > 0) {
      parts.push(formatCount(gitStatus.localChangeCount, 'local change', 'local changes'));
    }
    if (gitStatus.aheadCount > 0) {
      parts.push(formatCount(gitStatus.aheadCount, 'local commit', 'local commits'));
    }
    if (gitStatus.behindCount > 0) {
      parts.push(formatCount(gitStatus.behindCount, 'remote commit', 'remote commits'));
    }

    if (parts.length > 0) {
      const label =
        gitStatus.localChangeCount > 0
          ? 'Pending sync'
          : gitStatus.aheadCount > 0 && gitStatus.behindCount > 0
            ? 'Diverged'
            : gitStatus.aheadCount > 0
              ? 'Push pending'
              : 'Remote updates';
      return {
        text: `${label} · ${parts.join(' · ')}`,
        toneClass: 'text-warning',
        dotClass: 'bg-warning',
        pulse: false,
      };
    }
  }

  if (options.includeLastSyncAt && state.lastSyncAt) {
    return {
      text: `In sync · Last synced ${new Date(state.lastSyncAt).toLocaleString()}`,
      toneClass: 'text-success',
      dotClass: 'bg-success',
      pulse: false,
    };
  }

  return {
    text: state.lastSyncAt ? 'In sync' : 'Ready to sync',
    toneClass: state.lastSyncAt ? 'text-success' : 'text-secondary',
    dotClass: state.lastSyncAt ? 'bg-success' : 'bg-border-default',
    pulse: false,
  };
}

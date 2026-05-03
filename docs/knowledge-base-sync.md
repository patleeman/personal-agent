# Knowledge Base Sync

Knowledge Base Sync uses git to synchronize vault content across machines. When configured, the runtime maintains a managed git clone that serves as the vault root.

## How It Works

1. The runtime clones a remote git repository to `<state-root>/knowledge-base/repo`
2. Local file changes are tracked via a content-addressed snapshot (blob hashes)
3. On sync, the runtime pulls remote changes and pushes local changes
4. The managed mirror serves as the effective `<vault-root>`

```
Machine A ──► Git remote ◄── Machine B
                 │
          Managed clone
          <state-root>/knowledge-base/repo
                 │
            Effective vault root
```

## Configuration

Set the repo URL in config.json:

```json
{
  "knowledgeBaseRepoUrl": "git@github.com:user/pa-knowledge.git",
  "knowledgeBaseBranch": "main"
}
```

The branch setting is optional. When omitted, the remote default branch is used.

## Vault Root Resolution

When KB sync is configured, the vault root resolution order is:

1. `PERSONAL_AGENT_VAULT_ROOT` environment variable
2. Managed KB mirror (`<state-root>/knowledge-base/repo`)
3. Legacy `vaultRoot` config value
4. `~/Documents/personal-agent`

When `PERSONAL_AGENT_VAULT_ROOT` is set, the managed mirror is bypassed entirely.

## Sync State

The runtime tracks sync state in the machine configuration:

| Field          | Description                                          |
| -------------- | ---------------------------------------------------- |
| `repoUrl`      | Configured remote URL                                |
| `branch`       | Tracked branch                                       |
| `lastSyncAt`   | ISO timestamp of last sync                           |
| `lastSyncHead` | Commit SHA at last sync                              |
| `snapshot`     | Content-addressed file snapshot for change detection |

## Sync Status

The runtime exposes the sync status through the API:

| Status     | Meaning                      |
| ---------- | ---------------------------- |
| `disabled` | No repo URL configured       |
| `idle`     | Synced, waiting for changes  |
| `syncing`  | Currently pulling or pushing |
| `error`    | Last sync failed             |

When idle, the status also includes git status information:

- `localChangeCount` — files modified locally
- `aheadCount` — local commits not on remote
- `behindCount` — remote commits not yet pulled

## Recovery

When conflicts or errors occur, the runtime preserves recovery data. The recovery directory contains backup copies of files that could not be merged automatically.

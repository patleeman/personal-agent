# Knowledge Base Sync

The knowledge base can be backed by a git repository for synchronization across machines.

## How it works

When `knowledgeBaseRepoUrl` is configured in `<config-root>/config.json`, the runtime maintains a managed clone of the repository at:

```text
<state-root>/knowledge-base/repo
```

This clone is the effective `<vault-root>` (unless `PERSONAL_AGENT_VAULT_ROOT` overrides it). The runtime treats it as the canonical source of durable knowledge: instruction files, skills, projects, and normal docs all live inside this clone.

The sync engine:

1. **Pulls** remote changes so the local mirror stays up to date with the remote repository
2. **Watches** for local file edits and commits them after a quiet period (~2 minutes of no writes)
3. **Pushes** local commits to the remote

The sync loop runs every 5 minutes in the background. Manual sync (from Settings or the Knowledge page) checks immediately.

## .gitignore

The managed mirror uses a standard `.gitignore` at the repo root. Common entries exclude:

- `node_modules/`
- `.DS_Store`
- build artifacts or large binary files that should not live in the knowledge base

If you add files that should not be tracked, update the `.gitignore` in the mirror directly. The sync engine respects git's normal ignore rules.

## Sync state in the UI

The Knowledge page sidebar shows the mirror's current sync status:

| State                        | Meaning                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| In sync                      | The local mirror matches the remote.                             |
| Pending local changes        | Files have been modified but have not settled into a commit yet. |
| Pending local/remote commits | There are un-pushed local commits or unpulled remote commits.    |
| Sync in progress             | A sync operation is running.                                     |
| Sync error                   | The last sync attempt failed.                                    |

The status is about the managed mirror under `<state-root>/knowledge-base/repo`, not an arbitrary overridden vault root.

## Cross-process locking

The sync engine uses a cross-process lock on the mirror directory. This prevents multiple runtimes (e.g. a desktop app and a standalone daemon) from racing each other through the same checkout.

## Migration from an unmanaged vault

If you have content in an old unmanaged local vault (set via legacy `vaultRoot` or the default `~/Documents/personal-agent`), copy the files into the managed repo manually. The runtime no longer auto-imports legacy vault content.

## URL import

The desktop Knowledge page can import a web page directly into `<vault-root>`. Use this to save a URL as a durable note instead of quoting it inside a conversation. The imported file is a markdown document in the managed repo and will be synced like any other local change.

## Practical rules

- Treat the managed mirror as the source of truth for durable knowledge while KB sync is enabled
- If content is missing after sync, compare with any old local vault and copy missing files manually
- Large binary files in the knowledge base will slow down sync — keep the KB to markdown, small images, and config files
- The branch defaults to `main` unless overridden with `knowledgeBaseBranch` in config

## Related docs

- [Configuration](./configuration.md) — `knowledgeBaseRepoUrl` and `knowledgeBaseBranch`
- [Knowledge System](./knowledge-system.md)
- [Deskop App](./desktop-app.md)

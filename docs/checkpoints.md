# Checkpoints and Diffs

Checkpoints bind a conversation to a specific snapshot of the working tree. Diffs surface those snapshots inline in the workbench.

## The checkpoint tool

The `checkpoint` tool creates a focused git commit that covers only the files relevant to the current task. It is available to agents in any conversation that has a working directory under git.

```
checkpoint action=save message="Description of what was done" paths=["src/file.ts", "docs/README.md"]
```

The tool stages only the specified paths, commits them with the given message, and attaches the diff to the conversation for review. It does not push automatically.

**Key behaviors:**

- **Targeted commits** — only the listed paths are staged. Unrelated changes in the working tree are left alone. If the tool cannot safely stage only the intended hunks, it stops and reports the conflict.
- **Review modal** — by default, saving a checkpoint opens a diff review in the workbench. The review can be skipped with `open=false`.
- **Listing** — `checkpoint action=list` lists recent checkpoints for the conversation.
- **Inspection** — `checkpoint action=get checkpointId=<sha>` returns details for a specific checkpoint.

## Diffs in the workbench

When a conversation has saved checkpoint diffs, they appear in the right workbench rail under the **Diffs** tab.

- Diffs are conversation-scoped. Opening a checkpoint review switches the workbench to show the diff in the main pane while the rail lists all diffs newest-first.
- Each diff entry shows the commit message, the files changed, and the diff content.
- The workbench diff view replaces the old modal-based diff review — all checkpoint browsing happens inline.

## Checkpoints vs. artifacts

| Surface    | Purpose                                 | Lifecycle                                                   |
| ---------- | --------------------------------------- | ----------------------------------------------------------- |
| Checkpoint | git commit snapshot of code changes     | tied to conversation, persists in git                       |
| Artifact   | rendered output (HTML, diagram, report) | tied to conversation, stored in conversation artifact state |

Checkpoints are for code. Artifacts are for rendered output. The two are independent — a checkpoint can include an artifact file as part of the commit, and an artifact can reference checkpoint diffs.

## Practical rules

- Checkpoint after completing a task or reaching a clear milestone. Targeted commits keep history clean.
- If unrelated work is mixed into a file the checkpoint covers, do not stage the unrelated hunks. If the tool cannot separate them safely, stop and flag it.
- Push happens independently — checkpoints are local commits. Use the normal git push when ready.
- Checkpoints are not a backup mechanism. They are a review and collaboration surface tied to the conversation thread.

## Related docs

- [Conversations](./conversations.md)
- [Desktop App](./desktop-app.md) — workbench diffs section

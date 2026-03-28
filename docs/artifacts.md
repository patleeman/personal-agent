# Artifacts and Rendered Outputs

`personal-agent` uses the word **artifact** for rendered outputs or saved deliverables that should remain inspectable after they are created.

There are two different artifact surfaces:

- **conversation artifacts** — rendered outputs tied to one conversation
- **project artifacts** — durable files stored with a project

## Conversation artifacts

Conversation artifacts are rendered outputs saved for one conversation and shown in the artifact panel.

Use them when you want:

- an HTML report or mockup in the current thread
- a Mermaid diagram
- LaTeX source or a math-heavy rendered output
- an inspectable output that stays attached to the conversation history

Conversation artifacts are the right fit for outputs created through the `artifact` tool.

### Kinds

The built-in conversation artifact kinds are:

- `html`
- `mermaid`
- `latex`

Behavior by kind:

- **html** — rendered in an iframe; keep it self-contained by default
- **mermaid** — rendered as a diagram from raw Mermaid source
- **latex** — shown as raw LaTeX source, with math preview when appropriate

### Storage

Conversation artifacts live in local runtime state because they are conversation-bound:

- `~/.local/state/personal-agent/pi-agent/state/conversation-artifacts/<profile>/<conversationId>/<artifactId>.json`

They are not portable synced node files.

### Identity and revisions

Each conversation artifact has:

- stable `id`
- `title`
- `kind`
- `createdAt`
- `updatedAt`
- `revision`
- source `content`

If you save again with the same `artifactId`, the artifact is updated in place and its revision increments.

This is the right way to iterate on the same rendered output without creating a new unrelated stub each time.

## Project artifacts

Project artifacts are plain durable files stored with one project under:

- `sync/projects/<projectId>/artifacts/`

Use them for:

- exports
- screenshots
- reports you want to keep with a project
- generated deliverables
- sample outputs tied to the project rather than to one conversation view

Project artifacts are different from conversation artifacts:

- they are durable project files, not artifact-panel records
- they travel with the project node
- they are the right fit when the output belongs to the project as a deliverable

## Conversation artifact vs project artifact

Use a **conversation artifact** when the output is primarily a rendered part of the current thread.

Use a **project artifact** when the output should live with the project's durable files regardless of which conversation produced it.

A useful rule:

- **show this in the current conversation** → conversation artifact
- **keep this with the project files** → project artifact

Sometimes both are appropriate: render something in the conversation first, then save or export a durable copy into the project if it becomes part of the project handoff.

## The `artifact` tool

The `artifact` tool is the agent-facing surface for conversation artifacts.

Use it when rendering would explain something better than plain text, such as:

- a report-style HTML memo
- a UI mockup
- a Mermaid diagram
- LaTeX output

Important usage rules:

- reuse the same `artifactId` when iterating on an existing artifact
- keep HTML self-contained unless the user explicitly wants external dependencies
- use project artifacts separately when the output should live with project files rather than the conversation panel

## Web UI behavior

In the web UI, conversation artifacts can:

- appear as chat stubs in the conversation stream
- open in the right-hand artifact panel
- be listed for the conversation
- be copied as raw source
- show or hide source beside the rendered output when the kind supports it

The artifact panel is for inspection and iteration inside the conversation, not for replacing the project file system.

## Practical rule of thumb

Use artifacts for rendered outputs and deliverables.

Then choose the right home:

- **conversation artifact** for thread-local rendered inspection
- **project artifact** for project-owned durable files

## Related docs

- [Decision Guide](./decision-guide.md)
- [Agent Tool Map](./agent-tool-map.md)
- [Projects](./projects.md)
- [Conversations](./conversations.md)
- [Web UI Guide](./web-ui.md)

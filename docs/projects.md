# Projects

Projects are structured work packages that live in the vault. They have milestones, tasks, and durable status that persists across conversations and agent sessions.

## Project Structure

Each project lives at `<vault-root>/projects/<projectId>/`:

```
projects/
└── my-project/
    ├── state.yaml          # Milestones, tasks, status, metadata
    └── artifacts/          # Project-owned deliverables
        ├── spec-v1.md
        └── diagram.png
```

## State File

The `state.yaml` file tracks project progress:

```yaml
title: 'Refactor auth module'
status: 'active'
description: 'Replace the legacy auth system with OAuth2'

milestones:
  - title: 'Design'
    status: 'completed'
    tasks:
      - title: 'Write OAuth2 flow document'
        status: 'done'
      - title: 'Review with team'
        status: 'done'

  - title: 'Implementation'
    status: 'in-progress'
    tasks:
      - title: 'Implement token exchange'
        status: 'in-progress'
      - title: 'Add refresh token support'
        status: 'todo'
      - title: 'Write integration tests'
        status: 'todo'

  - title: 'Migration'
    status: 'planned'
    tasks:
      - title: 'Migrate existing users'
        status: 'todo'
```

### State values

| Field              | Values                                      |
| ------------------ | ------------------------------------------- |
| `status`           | `"active"`, `"completed"`, `"archived"`     |
| Milestone `status` | `"planned"`, `"in-progress"`, `"completed"` |
| Task `status`      | `"todo"`, `"in-progress"`, `"done"`         |

## Project Tasks vs Daemon Tasks

| Type                   | Storage               | Scope                | Managed by             |
| ---------------------- | --------------------- | -------------------- | ---------------------- |
| Project tasks          | `state.yaml` in vault | Project-specific     | Agent in conversations |
| Daemon scheduled tasks | Daemon runtime DB     | Global/cross-project | Daemon scheduler       |

These are independent systems. A project task tracks work within a project. A daemon scheduled task is a runtime automation.

## Linking Conversations

A conversation can be linked to a project. Linked conversations appear in the project context, so the agent can reference project state across threads. Links are stored in the conversation metadata.

## Project Artifacts

Project-owned deliverables live in the `artifacts/` directory. These are durable files that persist independently of any single conversation. Use project artifacts for:

- Design documents
- Specifications
- Meeting notes
- Delivered outputs

Unlike conversation artifacts (which are rendered in the transcript), project artifacts are files in the vault.

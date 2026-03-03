---
name: tool-task-factory
description: Task Factory CLI commands for managing tasks, workspaces, planning sessions, and automation. Use when the user asks about task-factory CLI, creating tasks, managing workspaces, or running agent tasks.
---

# Task Factory CLI (v0.5.0)

> 📁 **Local Skill**: This repo also contains `skills/task-factory/SKILL.md` for project-specific workflow guidance.

Task Factory is a lean manufacturing-inspired task queue system for AI agents.

## Quick Reference

### Common Commands

```bash
# Start the daemon
task-factory daemon start

# List workspaces
task-factory workspaces list

# List tasks
task-factory task list --workspace <id>

# Create a task
task-factory task create --workspace <id> --title "Task name"

# View task conversation
task-factory task conversation <task-id>

# Send message to task
task-factory task message <task-id> "Message content"
```

## Task Commands

### List Tasks
```bash
task-factory task list --workspace <id> [--scope active|archived|all] [--all]
```

### Show Task Details
```bash
task-factory task show <task-id>
```

### Update Task
```bash
task-factory task update <task-id> [options]
  --title <title>                    # Update title (max 200 chars)
  --content <content>                # Update content (max 50000 chars)
  --file <path>                      # Read content from file
  --acceptance-criteria <criteria>   # Comma-separated (max 50)
  --pre-execution-skills <skills>    # Comma-separated skill IDs
  --post-execution-skills <skills>   # Comma-separated skill IDs
  --model-provider <provider>        # Set execution model provider
  --model-id <id>                    # Set execution model ID
  --model-thinking <level>           # Set thinking level (off/minimal/low/medium/high/xhigh)
  --planning-provider <provider>     # Set planning model provider
  --planning-model-id <id>           # Set planning model ID
  --planning-thinking <level>        # Set thinking level (off/minimal/low/medium/high/xhigh)
  --order <n>                        # Set task order for prioritization
  --plan-goal <goal>                 # Set plan goal
  --plan-steps <steps>               # Set plan steps (comma-separated)
  --pre-planning-skills <skills>     # Comma-separated pre-planning skill IDs
  --pre-execution-skills <skills>    # Comma-separated pre-execution skill IDs
  --post-execution-skills <skills>   # Comma-separated post-execution skill IDs
```

### Task Conversation
```bash
# View conversation (alias: chat)
task-factory task conversation <task-id> [options]
  --limit <n>           # Number of messages (default: 100)
  --since <duration>    # e.g., "2h", "1d"
  --follow              # Real-time updates
  --export <file>       # Export to markdown
  --json                # JSON output
  --compact             # Compact format
  --only <user|agent>   # Filter by role
  --search <keyword>    # Search messages
```

### Send Message
```bash
task-factory task message <task-id> <content> [options]
  --file <path>         # Read from file (max 10000 chars)
  --attachment <paths>  # Attach files (max 10, 10MB each)
```

### Steering & Follow-up
```bash
# Send steering instruction to running task
task-factory task steer <task-id> <instruction>

# Queue follow-up message
task-factory task follow-up <task-id> <message>
```

### Task Activity
```bash
task-factory task activity <task-id> [--limit <n>] [--json]
```

### Plan Management
```bash
# Regenerate plan
task-factory task plan regenerate <task-id>
```

### Acceptance Criteria
```bash
# Regenerate criteria
task-factory task criteria regenerate <task-id>

# Update criterion status
task-factory task criteria check <task-id> <index> <pass|fail|pending>
```

## Planning Commands

```bash
# Get planning status
task-factory planning status <workspace-id>

# View planning messages
task-factory planning messages <workspace-id> [--limit <n>]

# Send planning message
task-factory planning message <workspace-id> <content>

# Stop planning
task-factory planning stop <workspace-id>

# Reset planning session
task-factory planning reset <workspace-id> [--force]
```

## Q&A Commands

```bash
# Check pending questions
task-factory qa pending <workspace-id>

# Submit answers
task-factory qa respond <workspace-id> --answers "answer1,answer2"

# Abort Q&A
task-factory qa abort <workspace-id>
```

## Shelf Commands (Draft Tasks)

```bash
# Show shelf contents
task-factory shelf show <workspace-id>

# Promote draft to task
task-factory shelf push <workspace-id> <draft-id>

# Promote all drafts
task-factory shelf push-all <workspace-id>

# Update draft
task-factory shelf update <workspace-id> <draft-id> --content <content>

# Remove item
task-factory shelf remove <workspace-id> <item-id> [--force]

# Clear all items
task-factory shelf clear <workspace-id> [--force]
```

## Idea Backlog Commands

```bash
# List ideas
task-factory idea list <workspace-id>

# Add idea
task-factory idea add <workspace-id> <description>

# Update idea
task-factory idea update <workspace-id> <idea-id> <description>

# Delete idea
task-factory idea delete <workspace-id> <idea-id> [--force]

# Reorder ideas
task-factory idea reorder <workspace-id> --order "idea-1,idea-2,idea-3"
```

## Attachment Commands

```bash
# List attachments
task-factory attachment list <task-id>

# Upload attachment (max 10MB)
task-factory attachment upload <task-id> <file-path> [--files <paths>]

# Download attachment
task-factory attachment download <task-id> <attachment-id> [-o <path>]

# Delete attachment
task-factory attachment delete <task-id> <attachment-id> [--force]
```

## Automation Commands

```bash
# Get automation settings
task-factory automation get <workspace-id>

# Set automation settings
task-factory automation set <workspace-id> [options]
  --ready-limit <n>        # Ready queue limit (1-100)
  --executing-limit <n>    # Executing limit (1-20)
  --backlog-to-ready <bool>
  --ready-to-executing <bool>

# Enable all automation
task-factory automation enable <workspace-id>

# Disable all automation
task-factory automation disable <workspace-id>
```

## Settings Commands

```bash
# Get global settings
task-factory settings get

# Set a global setting (supports dot notation for nested keys)
task-factory settings set <key> <value>

# Get Pi settings
task-factory settings pi

# Show available settings fields and types
task-factory settings schema
```

**Examples:**
```bash
# Set simple value
task-factory settings set theme "dark"

# Set nested value
task-factory settings set taskDefaults.modelConfig.provider "openai-codex"
task-factory settings set taskDefaults.modelConfig.modelId "gpt-5.3-codex"
task-factory settings set workflowDefaults.readyLimit 10

# View all available settings
task-factory settings schema
```

## Defaults Commands

```bash
# Get global defaults
task-factory defaults get

# Set global defaults
task-factory defaults set [options]
  --model <model>
  --pre-execution-skills <skills>
  --post-execution-skills <skills>

# Get workspace defaults
task-factory defaults workspace-get <workspace-id>

# Set workspace defaults
task-factory defaults workspace-set <workspace-id> [options]
```

## Auth Commands

```bash
# Check auth status
task-factory auth status

# Set API key for a provider
task-factory auth set-key <provider> <api-key>

# Clear credentials for a provider
task-factory auth clear <provider>
```

## Stat Command

```bash
# Show task statistics across all workspaces
task-factory stats
```

## Model Commands

```bash
# List available models
task-factory models list
```

## Skill Commands

```bash
# List factory skills (execution hooks)
task-factory skills list

# Get skill details
task-factory skills get <skill-id>

# Reload skills after adding new ones
task-factory skills reload

# List Pi skills
task-factory pi-skills list

task-factory pi-skills get <skill-id>
```

## Update Command

```bash
# Check for and install updates
task-factory update
```

When a new version is available, the CLI will display a notice:
```
┌─────────────────────────────────────────────────────────────┐
│ Update Available                                             │
├─────────────────────────────────────────────────────────────┤
│  Current version: 0.5.0                                      │
│  Latest version:  0.6.0                                      │
├─────────────────────────────────────────────────────────────┤
│  Run task-factory update to update to the latest version.   │
└─────────────────────────────────────────────────────────────┘
```

## Daemon Commands

```bash
# Start daemon
task-factory daemon start [--port <port>] [--host <host>]

# Stop daemon
task-factory daemon stop

# Restart daemon
task-factory daemon restart [--port <port>] [--host <host>]

# Check status
task-factory daemon status

# Start in foreground (legacy)
task-factory start [--port <port>] [--host <host>] [--no-open]
```

## Environment Variables

| Variable                   | Default     | Description                  |
| -------------------------- | ----------- | ---------------------------- |
| `PORT`                     | `3000`      | HTTP/WebSocket port          |
| `HOST`                     | `127.0.0.1` | Bind host                    |
| `DEBUG`                    | unset       | Enable debug logging         |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000`     | WebSocket heartbeat interval |

## Constraints & Limits

- Title: 200 characters max
- Content: 50000 characters max
- Messages: 10000 characters max
- Acceptance criteria: 50 max
- Attachments: 10 max per message
- Attachment size: 10MB max per file
- Ready limit: 1-100
- Executing limit: 1-20
- Task ID partial match: minimum 8 characters

## Error Handling

If the daemon is not running:
```
✗ Server Not Running

The Task Factory daemon is not running.

To start the daemon, run:
  task-factory daemon start

Or start in foreground mode:
  task-factory start
```

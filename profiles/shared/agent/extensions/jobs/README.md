# Jobs Extension

Full job workflow management for pi, compatible with pi-deck's job system.

## Commands

### Creating Jobs
- `/job [title]` - Create a new job in backlog phase
- `/job:plan [title|path]` - Create a job and start planning, or plan existing job

### Working with Jobs
- `/job:exec [path]` - Start executing a ready job (ready → executing)
- `/job:review [path]` - Start reviewing a completed job (executing → review)

### Phase Management
- `/job:promote [path]` - Promote job to next phase
- `/job:demote [path]` - Demote job to previous phase

### Listing & Management
- `/job:list` or `/jobs` - List all jobs with interactive management
- `/job:archive [path]` - Archive a completed job
- `/job:unarchive [path]` - Restore an archived job
- `/job:locations` - Manage job storage locations

## Job Phases

```
backlog → planning → ready → executing → review → complete
   📦        📝        ✅         ⚡          👀         ✓
```

## Job File Format

Jobs are markdown files with YAML frontmatter:

```markdown
---
title: "Job Title"
phase: planning
tags: [feature, frontend]
created: 2026-02-09T12:00:00.000Z
updated: 2026-02-09T12:00:00.000Z
---

# Job Title

## Description
What needs to be done.

## Plan
### Phase 1
- [ ] Task 1
- [ ] Task 2

### Phase 2
- [ ] Task 3

## Review
- Check code quality
- Run tests
```

## Storage Locations

By default, jobs are stored in:
1. `~/.pi/agent/jobs/<repo-name>/` (primary)
2. `<workspace>/.pi/jobs/` (local)

Configure custom locations with `/job:locations`.

## Keyboard Shortcuts (in job list)

- `↑/k` - Move up
- `↓/j` - Move down
- `Enter/v` - View job
- `p` - Start planning
- `e` - Start executing
- `r` - Start review
- `>` - Promote phase
- `<` - Demote phase
- `a` - Archive job
- `d` - Delete job
- `1-6` - Filter by phase
- `?` - Show help
- `q/Esc` - Cancel

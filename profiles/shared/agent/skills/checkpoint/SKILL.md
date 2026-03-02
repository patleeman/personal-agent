---
name: checkpoint
description: Commit and push the agent's current work. Stages only files modified by the agent.
---

# Checkpoint

Create a focused commit for the agent's current work.

## Workflow

### 1. Check Current State

```bash
git status
git diff --stat
```

Identify which files were modified by the agent vs. user.

### 2. Stage Agent's Changes

Only stage files the agent modified:
```bash
git add <file1> <file2> <file3>
```

**Do NOT use `git add .` or `git add -A`** — only stage specific files you changed.

### 3. Review Staged Changes

```bash
git diff --cached --stat
```

Confirm only intended files are staged.

### 4. Create Commit Message

```
<type>: <brief description>

<optional detailed explanation if needed>
```

**Types:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

### 5. Commit

```bash
git commit -m "<commit message>"
```

### 6. Push

```bash
git push
```

If push fails (for example non-fast-forward), stop and report the error.

### 7. Report

Provide the commit SHA to the user:

```bash
git rev-parse HEAD
```

## Important Notes

- **Only commit agent's changes** — don't stage unrelated files
- **Keep commits focused** — one logical change per checkpoint
- **Don't use --no-verify** — let hooks run
- **Always push after committing**

## What Not to Checkpoint

Don't commit:
- Broken/incomplete code (unless explicitly WIP)
- Files with merge conflicts
- Sensitive files (.env, credentials, secrets)
- Build artifacts, node_modules, etc.

If these are staged, warn the user and ask before proceeding.

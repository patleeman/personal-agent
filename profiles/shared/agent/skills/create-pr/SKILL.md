---
name: create-pr
description: Create a PR from commits on the current branch (no checkpoint SHA tracking, no cherry-picking).
---

# Create PR

Create a pull request from the current branch using the commits already in its history.

## How It Works

This skill compares the current branch to the default base branch (`main`, fallback `master`) and opens a PR for the commits ahead of base.

No SHA tracking file. No cherry-picking.

## Workflow

### 1. Identify Branch and Base

```bash
git rev-parse --abbrev-ref HEAD
git fetch origin
```

Pick base branch:
- Use `main` if `origin/main` exists
- Otherwise use `master` if `origin/master` exists
- If neither exists, ask the user which base branch to use

If current branch is `main` or `master`, ask the user whether to proceed or create/switch to a feature branch first.

### 2. Confirm There Are Commits to PR

```bash
git log --oneline origin/<base>..HEAD
git diff --stat origin/<base>...HEAD
```

If there are no commits ahead of base, inform the user and stop.

### 3. Push Current Branch

```bash
git push -u origin $(git branch --show-current)
```

If upstream already exists, regular `git push` is fine.

### 4. Create PR

```bash
gh pr create \
  --base <base> \
  --head $(git branch --show-current) \
  --title "<title>" \
  --body "$(cat <<'EOF'
## Summary
- What changed and why

## Testing
- [ ] Tests pass
- [ ] Manual testing completed
EOF
)"
```

### 5. Report

Provide the PR URL to the user.

## Important Notes

- **Do not use `.git/pi-checkpoint-shas`**
- **Do not cherry-pick commits onto a fresh branch**
- **Use the current branch history as source of truth**
- **Don't force push** — use regular push only

---
name: dotfiles
description: Make changes to dotfiles, commit, and push. Use when user wants to modify their personal dotfiles configuration.
---

# Dotfiles

Make changes to the user's dotfiles, then commit and push.

## Dotfiles Location

The user's dotfiles are located at: `/Users/<username>/dotfiles`

## Workflow

### 1. Understand the Request

Parse what the user wants to change in their dotfiles. This could be:
- Adding/modifying shell aliases
- Updating git config
- Changing editor settings
- Adding new tool configurations
- Modifying AI rules or prompts

### 2. Make the Changes

Navigate to the dotfiles directory and make the requested changes:

```bash
cd /Users/<username>/dotfiles
```

Read relevant files, then edit or create as needed.

### 3. Verify Changes

Review what was changed:
```bash
git -C /Users/<username>/dotfiles status
git -C /Users/<username>/dotfiles diff
```

### 4. Commit and Push

Stage, commit with a descriptive message, and push:

```bash
cd /Users/<username>/dotfiles && git add -A && git commit -m "$(cat <<'EOF'
<type>: <description>
EOF
)" && git push
```

## Important Notes

- **Keep changes focused** - One logical change per invocation
- **Respect existing structure** - Follow the patterns already in place
- **Don't break things** - Be careful with shell configs that could prevent login
- **Test syntax** - Validate shell scripts, JSON, YAML before committing

## Example Usage

User: `/dotfiles add an alias for docker compose`

1. Find the aliases file (likely in shell config)
2. Add the alias
3. Commit: `feat: add docker compose alias`
4. Push

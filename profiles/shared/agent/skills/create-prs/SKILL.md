---
name: create-prs
description: Extract logical pull requests from checkpoint commits. Analyzes commits since main, groups by feature/project, creates branches and PRs for each group.
---

# Create PRs

Extract logical pull requests from checkpoint commits.

## Use Case

You've been checkpointing work with `/checkpoint` as you go. Now you want to split that work into logical, reviewable PRs by feature or project area.

## Workflow

### 1. Analyze Commits

Get commits on current branch that aren't in main:

```bash
git log main..HEAD --oneline
git log main..HEAD --stat
```

Review each commit to understand what changed.

### 2. Group Commits Logically

Analyze commits and group by:
- **Feature/functionality** - Related changes for one feature
- **File area** - Changes to same part of codebase
- **Project** - If repo contains multiple projects
- **Type** - All security fixes, all docs, etc.

Ask user to confirm grouping strategy if not obvious.

### 3. For Each Group

Create branch and PR for each logical group:

#### a. Create feature branch from main

```bash
git checkout main
git pull
git checkout -b <feature-branch-name>
```

Branch naming:
- `feat/<description>` - New features
- `fix/<description>` - Bug fixes
- `refactor/<description>` - Refactoring
- `docs/<description>` - Documentation
- `security/<description>` - Security fixes

Examples:
- `feat/security-review-skill`
- `fix/sql-injection-user-search`
- `refactor/simplify-grug-guidelines`
- `docs/update-setup-instructions`

#### b. Cherry-pick commits

```bash
git cherry-pick <commit1> <commit2> <commit3>
```

If commits have dependencies or conflicts, pick them in order.

#### c. Push branch

```bash
git push -u origin <feature-branch-name>
```

#### d. Create PR

```bash
gh pr create --title "Title" --body "$(cat <<'EOF'
## Summary
- Bullet point summary of changes
- Another change
- One more

## Related Changes
- Commits: <commit hashes>
- Related to: #<issue-number> (if applicable)

## Testing
- [ ] Tests pass
- [ ] Manual testing completed

EOF
)"
```

**PR Title Format:**
- `feat: Add security-review skill for vulnerability scanning`
- `fix: Correct SQL injection in user search`
- `refactor: Simplify grug testing guidelines`

**PR Description:**
- Clear summary of what changed
- Link related commits/issues
- Testing checklist
- Mention if breaking changes

### 4. Return to Original Branch

```bash
git checkout <original-branch>
```

### 5. Summary

Provide user with:
- List of PRs created with URLs
- Commits included in each PR
- Any commits not included (explain why)

## Example Session

```
User: /create-prs

Agent:
Analyzing commits since main...

Found 8 commits:
1. abc123 - feat: add security-review skill
2. def456 - docs: update security.md
3. ghi789 - refactor: update grug.md for modern era
4. jkl012 - feat: add checkpoint skill
5. mno345 - feat: add create-prs skill
6. pqr678 - fix: typo in README
7. stu901 - feat: integrate code-quality into grug
8. vwx234 - docs: cleanup AGENTS.md

Proposed grouping:
- **PR1: Security improvements** (commits 1, 2)
  - Add security-review skill
  - Update security.md

- **PR2: Grug philosophy updates** (commits 3, 7)
  - Update grug.md for modern era
  - Integrate code-quality into grug

- **PR3: Git workflow skills** (commits 4, 5)
  - Add checkpoint skill
  - Add create-prs skill

- **PR4: Documentation cleanup** (commits 6, 8)
  - Fix typo in README
  - Cleanup AGENTS.md

Proceed with this grouping? [yes/no]

User: yes

Agent:
Creating PR1: Security improvements...
✓ Branch created: feat/security-improvements
✓ Commits cherry-picked: abc123, def456
✓ Pushed to origin
✓ PR created: https://github.com/user/repo/pull/42

Creating PR2: Grug philosophy updates...
✓ Branch created: refactor/grug-philosophy-updates
✓ Commits cherry-picked: ghi789, stu901
✓ Pushed to origin
✓ PR created: https://github.com/user/repo/pull/43

Creating PR3: Git workflow skills...
✓ Branch created: feat/git-workflow-skills
✓ Commits cherry-picked: jkl012, mno345
✓ Pushed to origin
✓ PR created: https://github.com/user/repo/pull/44

Creating PR4: Documentation cleanup...
✓ Branch created: docs/cleanup
✓ Commits cherry-picked: pqr678, vwx234
✓ Pushed to origin
✓ PR created: https://github.com/user/repo/pull/45

Summary:
✓ Created 4 PRs from 8 commits
✓ All commits included in PRs
✓ Returned to branch: main

PRs created:
- #42: Security improvements
- #43: Grug philosophy updates
- #44: Git workflow skills
- #45: Documentation cleanup
```

## Commit Grouping Strategies

### By Feature
Group commits that implement a single feature together.

### By File Area
Group commits touching the same files or directories:
- All `shared/skills/*` commits together
- All `shared/rules/*` commits together
- All documentation commits together

### By Type
Group by commit type:
- All `feat:` commits
- All `fix:` commits
- All `docs:` commits

### Interactive
Ask user to specify grouping:
- Show commits with file changes
- Ask user to assign each commit to a PR
- Confirm grouping before creating PRs

## Handling Complex Cases

### Commits with Dependencies
If commits depend on each other across groups, either:
1. Keep them in same PR
2. Create PRs in order with dependencies noted

### Conflicts During Cherry-Pick
If cherry-pick has conflicts:
1. Inform user of conflict
2. Skip that commit and note in summary
3. User may need to manually create that PR

### Very Large Changes
If a group has too many commits or file changes:
- Suggest splitting into multiple PRs
- Keep PRs reviewable (< 500 lines changed ideal)

## Best Practices

- **Keep PRs focused** - One logical change per PR
- **Make PRs reviewable** - Not too large (< 500 lines ideal)
- **Good PR titles** - Clear, descriptive, follow convention
- **Descriptive PR bodies** - Explain what and why
- **Link related work** - Reference issues, related PRs
- **Test checklist** - Include testing verification

## Important Notes

- **Don't force push** - Use regular git commands
- **Base on main** - All PRs should branch from latest main
- **Check for conflicts** - Warn user if base branch has moved
- **Preserve commit history** - Use cherry-pick, not squash
- **Clean branch names** - Follow naming conventions

## When to Use

Use `/create-prs` when:
- You've checkpointed multiple features/fixes
- Ready to create PRs for review
- Want to split work into logical chunks
- Need to organize mixed commits into coherent PRs

## Integration with `/checkpoint`

Workflow:
1. Work on multiple features
2. Use `/checkpoint` frequently to save progress
3. When ready for review, use `/create-prs` to extract PRs
4. Agent creates logical, reviewable PRs from checkpoints

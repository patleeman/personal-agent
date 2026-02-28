---
name: learn
description: Extract reusable patterns from the current session and save as skills. Use when you've solved a non-trivial problem worth capturing for future sessions.
---

# Learn - Extract Reusable Patterns

Analyze the current session and extract any patterns worth saving as skills.

**IMPORTANT**: Follow the skill-creator guidelines at `~/.pi/agent/skills/skill-creator/SKILL.md` to ensure proper skill structure.

## Trigger

Run `/learn` at any point during a session when you've solved a non-trivial problem.

## What to Extract

Look for:

1. **Error Resolution Patterns**
   - What error occurred?
   - What was the root cause?
   - What fixed it?
   - Is this reusable for similar errors?

2. **Debugging Techniques**
   - Non-obvious debugging steps
   - Tool combinations that worked
   - Diagnostic patterns

3. **Workarounds**
   - Library quirks
   - API limitations
   - Version-specific fixes

4. **Project-Specific Patterns**
   - Codebase conventions discovered
   - Architecture decisions made
   - Integration patterns

## Process

1. Review the session for extractable patterns
2. Identify the most valuable/reusable insight
3. Determine if this should be a simple skill or full skill with resources
4. Create proper skill structure following skill-creator guidelines
5. Ask user to confirm before saving
6. Save to `~/.pi/agent/skills/learned/`

## Skill Structure

For **simple patterns** (most cases), create a single SKILL.md file:

### Directory Structure
```
~/.pi/agent/skills/learned/[skill-name]/
└── SKILL.md
```

### SKILL.md Format
```markdown
---
name: [skill-name]
description: [What it does and when to use it - include trigger conditions]
---

# [Skill Title]

## Overview

[What problem this solves and when it applies]

## Solution

[The pattern/technique/workaround]

## Example

[Code example if applicable]
```

For **complex patterns** requiring scripts/references, use:

```bash
python ~/.pi/agent/skills/skill-creator/scripts/init_skill.py learned/[skill-name] --path ~/.pi/agent/skills
```

Then populate with:
- `scripts/` - Reusable automation code
- `references/` - Documentation loaded as needed
- `assets/` - Templates or files for output

## Notes

- Don't extract trivial fixes (typos, simple syntax errors)
- Don't extract one-time issues (specific API outages, etc.)
- Focus on patterns that will save time in future sessions
- Keep skills focused - one pattern per skill
- Follow skill-creator principles: be concise, only include what Claude doesn't already know
- Use proper frontmatter with `name` and `description` fields

## Related Resources

See the skill-creator skill for detailed guidelines:
`~/.pi/agent/skills/skill-creator/SKILL.md`

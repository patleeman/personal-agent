# Output Patterns

Use when skills need consistent, high-quality output.

## Template Pattern

Provide templates matching strictness to needs.

**Strict (API responses, data formats):**

```markdown
## Report Structure

ALWAYS use this exact template:

# [Analysis Title]

## Executive Summary
[One-paragraph overview]

## Key Findings
- Finding 1 with data
- Finding 2 with data

## Recommendations
1. Actionable recommendation
2. Actionable recommendation
```

**Flexible (when adaptation useful):**

```markdown
## Report Structure

Sensible default format, adapt as needed:

# [Analysis Title]

## Executive Summary
[Overview]

## Key Findings
[Adapt sections based on discovery]

## Recommendations
[Tailor to context]
```

## Examples Pattern

Show input/output pairs when quality depends on seeing examples:

```markdown
## Commit Message Format

**Example 1:**
Input: Added user authentication with JWT tokens
Output:
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware

**Example 2:**
Input: Fixed bug where dates displayed incorrectly
Output:
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
```

Examples communicate style better than descriptions.

## Checklist Pattern

For quality assurance:

```markdown
## Before Completion

Verify:
- [ ] All required fields populated
- [ ] No placeholder text remains
- [ ] Output format matches specification
- [ ] Edge cases handled
```

# Workflow Patterns

## Sequential Workflows

Guide Claude through linear processes with ordered steps:

```markdown
## PDF Form Filling Workflow

1. **Analyze** - Read PDF structure and identify form fields
2. **Map** - Match user data to form fields
3. **Fill** - Populate fields with appropriate values
4. **Validate** - Check all required fields are complete
5. **Output** - Save filled PDF
```

Use when tasks have clear progression without branching.

## Conditional Workflows

Incorporate decision points:

```markdown
## Document Workflow

Determine the task type first:

**If creating new content:**
1. Gather requirements
2. Create outline
3. Write content
4. Format and polish

**If editing existing content:**
1. Read current document
2. Identify changes needed
3. Apply edits
4. Verify changes preserved intent
```

Use when different paths based on conditions.

## Hybrid Patterns

Combine sequential steps with conditional branches:

```markdown
## Data Processing

1. **Load** - Read input file
2. **Validate** - Check format
   - If invalid: Report errors and stop
   - If valid: Continue
3. **Transform** - Apply processing rules
4. **Output** - Write results
   - If small dataset: Return inline
   - If large dataset: Write to file
```

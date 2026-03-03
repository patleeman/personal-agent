---
name: workflow-skill-creator
description: Guide for creating effective skills. Use when users want to create a new skill (or update an existing skill) that extends Claude's capabilities with specialized knowledge, workflows, or tool integrations.
---

# Skill Creator

Create modular skills that extend Claude's capabilities.

## About Skills

Skills are self-contained packages providing specialized knowledge, workflows, and tools. They transform Claude from a general-purpose assistant into a domain specialist.

### What Skills Provide

1. **Specialized workflows** - Multi-step procedures for specific domains
2. **Tool integrations** - Instructions for file formats, APIs, or tools
3. **Domain expertise** - Schemas, business logic, company knowledge
4. **Bundled resources** - Scripts, references, and assets

## Core Principles

### Concise is Key

Context window is shared. Only add what Claude doesn't already know. Challenge each piece: "Does Claude need this?" and "Does this justify its token cost?"

Prefer concise examples over verbose explanations.

### Degrees of Freedom

Match specificity to task fragility:

- **High freedom** (text instructions): Multiple valid approaches, context-dependent
- **Medium freedom** (pseudocode/parameterized scripts): Preferred pattern with acceptable variation
- **Low freedom** (specific scripts): Fragile operations, consistency critical

### Skill Structure

```
skill-name/
├── SKILL.md              # Required - frontmatter + instructions
├── scripts/              # Executable code (Python/Bash)
├── references/           # Documentation loaded as needed
└── assets/               # Files for output (templates, images)
```

#### SKILL.md (required)

- **Frontmatter** (YAML): `name` and `description` fields - determines when skill triggers
- **Body** (Markdown): Instructions loaded after skill triggers

#### Bundled Resources (optional)

| Directory     | Purpose                        | When to Include                         |
| ------------- | ------------------------------ | --------------------------------------- |
| `scripts/`    | Deterministic, repeatable code | Same code rewritten repeatedly          |
| `references/` | Documentation for context      | Claude needs to reference while working |
| `assets/`     | Output resources (not loaded)  | Templates, images, boilerplate          |

**Do NOT include:** README.md, CHANGELOG.md, installation guides, or meta-documentation.

### Progressive Disclosure

Keep SKILL.md under 500 lines. Split into reference files when larger:

```markdown
## Advanced features
- **Form filling**: See references/forms.md
- **API reference**: See references/api.md
```

Claude loads references only when needed.

## Creation Process

### Step 1: Understand with Examples

Clarify the skill's purpose:
- "What functionality should this skill support?"
- "Give examples of how it would be used"
- "What should trigger this skill?"

### Step 2: Plan Reusable Contents

For each example, identify:
- Scripts that would be rewritten repeatedly
- References that would be re-discovered each time
- Assets that would be copied/modified

### Step 3: Initialize

```bash
python ~/.pi/agent/skills/skill-creator/scripts/init_skill.py <skill-name>
```

Creates skill directory with SKILL.md template and resource folders.

### Step 4: Implement

1. Create `scripts/`, `references/`, `assets/` files identified in Step 2
2. Test scripts by running them
3. Delete unused example files
4. Write SKILL.md:

**Frontmatter:**
```yaml
---
name: my-skill
description: What it does and when to use it. Include all trigger conditions here.
---
```

**Body:** Instructions for using the skill and its resources. Use imperative form.

### Step 5: Validate

```bash
python ~/.pi/agent/skills/skill-creator/scripts/validate_skill.py ~/.pi/agent/skills/<skill-name>
```

### Step 6: Iterate

Use the skill on real tasks, notice gaps, update, repeat.

## Design Patterns

See `references/workflows.md` for sequential and conditional workflow patterns.
See `references/output-patterns.md` for template and example patterns.

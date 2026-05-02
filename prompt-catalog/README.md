# Prompt catalog

This directory is the repo-managed source of truth for prompt text that `personal-agent` owns directly.

Goals:

- keep prompt text inspectable in Git
- make prompt changes easy to diff and review
- keep prompts small without exploding into one-rule-per-file micro-prompts
- separate prompt wording from TypeScript control flow

## Scope

This catalog currently holds:

- shared system prompt sections (`system/`)
- runtime mode blocks (`runtime/`)
- utility prompts (`utilities/`)
- reminder review notes (`reminders/`)

Important:

- This layout is for **inspectability and maintainability**.
- It does **not** imply that external tools like Claude Code are internally authored in this exact shape.
- `personal-agent` still relies on Pi's generated base system prompt plus AGENTS/context layering.
- Shared `system/` sections are materialized into runtime `APPEND_SYSTEM.md`.
- Runtime-specific prompt blocks and utility prompts should load text from this catalog instead of embedding large string literals in TypeScript.

## Layout

```text
prompt-catalog/
  system/
  runtime/
  utilities/
  reminders/
```

## Authoring rules

- Prefer section-sized files over single-line micro-prompts.
- Keep prompt text stable and easy to diff.
- Use placeholders only when runtime interpolation is genuinely required.
- Keep execution logic in code and prompt wording in this catalog.

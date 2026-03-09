---
name: dd-marketplace
description: Browse and install skills from the Datadog Claude Marketplace (DataDog/claude-marketplace). Use when the user asks about available Datadog skills/plugins, wants to find a skill for a specific Datadog workflow, or needs to install a marketplace skill. Also use as a fallback when existing dd- skills don't cover a topic — search the marketplace for team-specific knowledge.
---

# Datadog Claude Marketplace

Browse Datadog Claude Marketplace skills from DataDog/claude-marketplace and install them locally.

The marketplace contains team-contributed skills for Datadog-specific workflows: deployments (Conductor, Rapid), CI debugging, service operations, code review patterns, and more.

## Script Location

Use `scripts/marketplace.sh` and resolve it relative to this skill directory.

## Commands

### List all available skills
```bash
scripts/marketplace.sh list
```

### Search by keyword
```bash
scripts/marketplace.sh search deploy
scripts/marketplace.sh search "ci failure"
scripts/marketplace.sh search atlas
```

### Show a skill's full content (without installing)
```bash
scripts/marketplace.sh show dd/conductor
scripts/marketplace.sh show atlas/faq
```

Use `show` to read a skill's instructions when the user needs guidance on a topic covered by a marketplace skill, even without installing it.

### Install a skill locally
```bash
scripts/marketplace.sh install dd/conductor
scripts/marketplace.sh install atlas/faq
```

By default this installs into the current repo's datadog profile at `profiles/datadog/agent/skills/<skill-name>/`. Use `--dest <dir>` to override. Skills with scripts and reference files are copied too.

### List plugins (top-level groupings)
```bash
scripts/marketplace.sh plugins
```

### Force-update the cache
```bash
scripts/marketplace.sh sync
```

The repo is cached at `~/.cache/dd-marketplace/` and auto-updates daily.

## Workflow

1. **User asks about a Datadog topic not covered by existing skills** → search the marketplace
2. **Found a relevant skill** → use `show` to read its instructions and answer the user's question
3. **User wants it permanently** → use `install` to add it to `profiles/datadog/agent/skills/` (or pass `--dest` explicitly)

## Notes

- Skills may reference Claude Code-specific features (`allowed-tools`, `${SKILL_PATH}`) — these are ignored by Pi but the instructions and scripts still work
- Some skills include helper scripts in `scripts/` — these are copied on install
- The repo is shallow-cloned on first use (~5 seconds)

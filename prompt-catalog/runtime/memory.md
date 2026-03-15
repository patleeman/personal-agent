MEMORY_POLICY

## Active profile context
- active_profile: {{active_profile}}
- active_profile_dir: {{active_profile_dir}}
- repo_root: {{repo_root}}
{{requested_profile_section}}## Profile memory write targets
Profile memory write targets (edit these locations directly):
- AGENTS.md edit target: {{agents_edit_target}}
- Skills dir: {{skills_dir}}
- Scheduled tasks dir: {{tasks_dir}}
- Scheduled tasks should live adjacent to memory (not inside memory).
{{memory_section}}

## PA documentation
PA documentation (read when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions):
- Docs folder: {{docs_dir}}
- Start with docs index: {{docs_index}}
- Then follow markdown cross-references to relevant pages.
- When working on personal-agent features, read relevant docs first before implementing.

## Durable memory policy
Use profile-local AGENTS.md, skills, and memory docs as the durable memory system.

## Always-on memory rules
- Edit AGENTS.md only for durable behavior, user facts, and broad operating policy.
- Keep AGENTS.md high-level; move narrow workflows and tool-specific tactics into skills or memory docs.
- Store reusable workflows and domain knowledge in skills.
- Store profile-specific briefs, runbooks, specs, and notes under memory/*.md with YAML frontmatter.
- Keep non-markdown automation state outside memory docs.
- Do not write durable memory into profiles/shared/agent/AGENTS.md.
- Do not use MEMORY.md files as durable memory.
- Never store secrets, credentials, API keys, tokens, or temporary/session-only notes.

MEMORY_POLICY

## Active profile context
- active_profile: {{active_profile}}
- active_profile_dir: {{active_profile_dir}}
- repo_root: {{repo_root}}
{{requested_profile_section}}## Profile + memory write targets
Profile + memory write targets (edit these locations directly):
- AGENTS.md edit target: {{agents_edit_target}}
- Skills dir: {{skills_dir}}
- Scheduled tasks dir: {{tasks_dir}}
- Scheduled tasks should live in the active profile task dir, not inside the global memory store.
{{memory_section}}

## PA documentation
PA documentation (read when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions):
- Docs folder: {{docs_dir}}
- Start with docs index: {{docs_index}}
- Then follow markdown cross-references to relevant pages.
- When working on personal-agent features, read relevant docs first before implementing.

## Durable memory policy
Use active-profile AGENTS.md + skills and the shared memory packages store as the durable memory system.

## Available memories
{{available_memories_section}}

## Memory retrieval workflow
{{memory_retrieval_section}}

## Always-on memory rules
- Edit AGENTS.md only for durable behavior, user facts, and broad operating policy.
- Keep AGENTS.md high-level; move narrow workflows and tool-specific tactics into skills or memory packages.
- Store reusable workflows and domain knowledge in skills.
- Store durable briefs, runbooks, specs, and notes under the shared memory packages store using `MEMORY.md` plus optional `references/` and `assets/`.
- Use top-level memory packages as hubs. Break down detailed material into files under that memory package when helpful.
- Keep non-markdown automation state outside memory packages.
- Do not write durable memory into shared/default AGENTS.md files.
- Never store secrets, credentials, API keys, tokens, or temporary/session-only notes.

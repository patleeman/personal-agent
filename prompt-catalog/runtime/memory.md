MEMORY_POLICY

## Active profile context
- active_profile: {{active_profile}}
- active_profile_dir: {{active_profile_dir}}
- repo_root: {{repo_root}}
{{requested_profile_section}}## Write targets
Edit these locations directly:
- AGENTS.md edit target: {{agents_edit_target}}
- Skills dir: {{skills_dir}}
- Scheduled tasks dir: {{tasks_dir}}
- Scheduled tasks belong in the active profile task dir, not the global memory store.
{{memory_section}}

## PA documentation
Read these when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions:
- Docs folder: {{docs_dir}}
- Start with docs index: {{docs_index}}
- Follow markdown cross-references before implementing.

## Durable memory model
Use active-profile AGENTS.md + skills and the shared memory packages store as the durable memory system.
- AGENTS.md is for durable behavior and user/profile facts.
- Skills are for reusable workflows.
- Shared memory packages are for durable knowledge, briefs, and notes.
- Keep non-markdown automation state outside memory packages.
- Never store secrets or session-local notes in AGENTS.md or memory packages.

## Available memories
{{available_memories_section}}

## Retrieval workflow
{{memory_retrieval_section}}

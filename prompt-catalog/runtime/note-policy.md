NODE_POLICY

## Active profile context
- active_profile: {{active_profile}}
- active_profile_dir: {{active_profile_dir}}
- repo_root: {{repo_root}}
{{requested_profile_section}}## Write targets
Edit these locations directly:
- AGENTS.md edit target: {{agents_edit_target}}
- Skills dir: {{skills_dir}}
- Scheduled tasks dir: {{tasks_dir}}
- Scheduled tasks belong in the active profile task dir, not the shared notes store.
{{memory_section}}

## PA documentation
Read these when the user asks about pa/personal-agent, CLI, daemon, tasks, profiles, or extensions:
- Docs folder: {{docs_dir}}
- Start with docs index: {{docs_index}}
- Follow markdown cross-references before implementing.

## Durable node model
Use active-profile AGENTS.md + skills + shared note nodes as the durable node system.
- AGENTS.md is for durable behavior and user/profile facts.
- Skills are skill nodes: reusable workflows.
- Shared note nodes are for durable knowledge, briefs, and notes.
- Keep non-markdown automation state outside note nodes.
- Never store secrets or session-local notes in AGENTS.md or note nodes.

## Available notes
{{available_memories_section}}

## Retrieval workflow
{{memory_retrieval_section}}

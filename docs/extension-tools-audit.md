# Extension tools audit

Summary: current PA tools are mostly runtime primitives; a few are strong candidates to become bundled system extensions once the extension tool API is hardened.

## Good extension candidates

- `web_fetch`, `web_search` — already conceptually packaged as web tools. Keep as an extension-owned tool set and make credentials/dependencies visible in Extension Manager.
- `artifact` — pairs naturally with the Artifacts workbench extension. Move the agent tool next to the Artifacts UI and storage APIs.
- `scheduled_task`, `run`, `conversation_queue`, `reminder` — these should live with Automations/Runs extensions once those APIs are stable. They are product modules, not core chat.
- `mcp` — should be a system extension with settings, auth state, and agent tools in one package.
- Browser tools — should live with the Browser extension and use host browser primitives instead of direct Electron details.

## Keep core for now

- `read`, `bash`, `edit`, `write` — core coding-agent primitives. Extensions may add higher-level file/workspace tools, but these are the runtime substrate.
- `ask_user_question`, `change_working_directory`, `set_conversation_title` — shell/conversation control primitives. They can eventually become system extensions, but they are tightly coupled to conversation lifecycle today.
- `checkpoint` — could become a Git/Checkpoint extension, but keep until workspace APIs and targeted commit UX are fully extension-owned.
- `image`, `probe_image` — can become an Image extension once provider config, attachment access, and generated asset storage are exposed as host APIs.

## Missing APIs before moving more tools

- Agent tool contributions from extension manifests. Added initial support for `contributes.tools` backed by backend actions.
- Extension-mounted skills. Added initial support for `contributes.skills` as enabled-extension skill dirs.
- Workspace/file write APIs with explicit cwd, path, and diff/patch helpers.
- Git APIs: status, diff, stage selected hunks, commit, checkpoint, branch metadata.
- Browser host APIs: tab state, open/navigate/snapshot/comment, without exposing Electron bounds.
- Secrets/config dependency reporting per extension, especially for MCP and web tools.
- Permission enforcement hooks. Permissions are still declarative display metadata, not hard gates.

## Recommendation

Next migration should be `web-tools` and Browser tool registration into manifest-declared system extensions. That proves the API on real tools without dragging all conversation lifecycle tools through the migration at once.

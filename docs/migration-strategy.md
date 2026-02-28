# Migration Strategy (Dotfiles → Personal-Agent)

## Objective

Move from symlink-heavy `~/.pi/agent` management to:

- repo-managed profile resources in `personal-agent/profiles/*`
- local mutable runtime state under `~/.local/state/personal-agent`

## Source migration

Imported from dotfiles shared Pi config:

- `AGENTS.md`
- `settings.json`
- `models.json`
- `extensions/` (source only: excluding `node_modules`, lockfiles, and build byproducts)
- `skills/`
- `themes/`

Target location:

- `profiles/shared/agent/**`

Datadog overlay baseline:

- `profiles/datadog/agent/AGENTS.md` (overlay file, extend as needed)

## Non-migrated runtime files

Not versioned and not copied into profile resources:

- `~/.pi/agent/auth.json`
- `~/.pi/agent/sessions/**`
- package/runtime caches

At runtime, `personal-agent` prepares:

- `~/.local/state/personal-agent/pi-agent`

and optionally seeds auth from legacy `~/.pi/agent/auth.json` if missing.

## Cutover steps

1. Clone `personal-agent` repo
2. Install deps: `npm install`
3. Validate: `npm run lint && npm run build && npm run test`
4. Set default profile (optional):
   - `personal-agent profile use shared`
5. Run:
   - `personal-agent run`
6. Verify doctor output:
   - `personal-agent doctor`

## Rollback

If issues occur:

1. Continue using legacy Pi directly (`pi`) with existing `~/.pi/agent`
2. Remove/ignore `PI_CODING_AGENT_DIR` overrides from your shell/scripts
3. Keep `personal-agent` repo changes; runtime state remains isolated and can be retried later

No destructive migration is performed against legacy `~/.pi/agent`; rollback is immediate.

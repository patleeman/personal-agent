# State home consolidation brief

## Goal
Move mutable personal-agent state to a single canonical home under `~/.local/state/personal-agent`, separate synchronized durable state from machine-local state, and stop scattering runtime/config data across repo paths and legacy defaults.

## Scope
- Define and document a stable state-home layout.
- Implement code changes so config and runtime paths resolve from one canonical state home.
- Keep local-only data (auth/cache/logs/tmp) outside synchronized state.
- Include dedicated space for profile projects under shared state.
- Exclude `tmux` and `tmux-logs` from the managed synchronized state layout.

## Out of scope
- Long historical data migration across many machines.
- Introducing a new sync backend in this phase.

## Deliverables
1. Updated path-resolution implementation.
2. Updated docs describing the single-home model.
3. One-time migration process for existing local installs.

## Success criteria
- New installs can run with one canonical state root and no path scatter.
- Existing installs can migrate once and continue without regressions.
- Projects, conversations, inbox, daemon runs, and gateway state all resolve under the new layout.

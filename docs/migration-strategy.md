# Migration Strategy

This document outlines migration paths for `personal-agent`.

## Current Status

`personal-agent` is in active development. New users should start fresh with the current version.

## Future Migrations

As the system evolves, migration tools will be provided for:

- Configuration format changes
- State file migrations
- Profile structure updates

## Compatibility Notes

- **v0.x** - No backward compatibility guarantees
- Extension APIs may change
- Configuration schemas may evolve

## Getting Current State

To check your current setup:

```bash
pa doctor
pa daemon status
pa memory status
```

## Manual Migration Steps

If you need to reset state:

```bash
# Stop daemon
pa daemon stop

# Backup and clear runtime state
mv ~/.local/state/personal-agent ~/.local/state/personal-agent.backup.$(date +%Y%m%d)

# Re-run doctor to reinitialize
pa doctor
```

Profile configurations in `profiles/` and `~/.config/personal-agent/` should be preserved.

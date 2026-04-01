# Execution Targets

Execution targets let a conversation run on another machine instead of the current local machine.

Use them for remote conversation offload, such as sending heavy work to a GPU box or another SSH-accessible machine.

## When to use execution targets

Good fits:

- a remote machine has the right hardware or environment
- you want a conversation to run near a different checkout or dataset
- you want to keep your local machine as the control surface while offloading execution elsewhere

Do not use execution targets as a replacement for:

- scheduled automation
- durable background runs
- sync

They answer **where a conversation runs**, not **when work runs**.

## Core model

An execution target is machine-local config describing a remote destination.

Typical fields include:

- SSH destination
- target label
- remote default working directory
- local repo path → remote checkout mapping
- optional remote profile override
- optional remote `pa` command override

Because SSH destinations and local path mappings are machine-specific, execution targets are local config, not synced durable profile state.

## Storage

Execution targets are stored in the machine-local config file under the `executionTargets` section:

- `~/.local/state/personal-agent/config/config.json`

See [Configuration](./configuration.md).

## Web UI behavior

If execution targets are configured, a new draft conversation can choose a target before the first prompt is sent.

Important behavior:

- target selection happens before the first turn
- once the conversation starts, the execution target is treated as locked for that conversation
- the chosen target is shown in the conversation header

## CLI behavior

Useful commands:

```bash
pa targets list
pa targets show <id>
pa targets add <id> --label <label> --ssh <destination>
pa targets update <id> ...
pa targets install <id>
pa targets delete <id>
```

`pa targets install <id>` uploads the built `personal-agent` runtime bundle plus synced profile/auth state to the remote target so that remote execution does not require a full checkout on that machine.

## Path mapping

Path mappings let a local repo path correspond to a remote checkout path.

This matters when a conversation references a repo or opens files locally while execution happens remotely. The target config tells `personal-agent` how to translate that working directory.

## Practical rule of thumb

Use an execution target when the conversation should start on another machine.

Use a run or scheduled task when the real question is background timing or automation instead.

## Related docs

- [Conversations](./conversations.md)
- [Command-Line Guide (`pa`)](./command-line.md)
- [Configuration](./configuration.md)
- [Web UI Guide](./web-ui.md)

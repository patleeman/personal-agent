# ACP Protocol

This extension exposes Personal Agent as an ACP agent over stdio.

## Usage

Enable the extension, then run:

```bash
personal-agent protocol acp
```

For Alleycat:

```bash
ACP_BRIDGE_AGENT_BIN=personal-agent
ACP_BRIDGE_AGENT_ARGS="protocol acp"
```

## Supported ACP surface

- `initialize`
- `authenticate`
- `session/new`
- `session/load`
- `session/list`
- `session/resume`
- `session/close`
- `session/fork` (unstable)
- `session/set_mode`
- `session/prompt`
- `session/cancel`

The implementation intentionally exposes only the ACP capabilities it fully supports.

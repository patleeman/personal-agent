# Sandboxing and Process Execution

Personal Agent routes host-owned process execution through a shared process launcher so sandboxing extensions can wrap commands consistently.

## Execution boundary

Extensions and core code should not spawn processes directly. Use the host APIs that route through the shared launcher:

- live-session bash tool
- extension `ctx.shell` and `ctx.git`
- daemon/background run launches
- automation command tasks

When a wrapper is active, tool UI should expose the wrapper metadata, for example a human label or the extension id. This is a visibility contract: users and agents should be able to tell which execution boundary handled a command.

## Registering a process wrapper

Agent extensions can register a process wrapper from their backend agent extension export:

```ts
export function mySandboxAgentExtension(pi) {
  pi.registerBashProcessWrapper(
    'my-sandbox-extension',
    (context) => ({
      ...context,
      command: '/path/to/sandbox',
      args: ['run', '--', context.command, ...context.args],
      shell: false,
    }),
    { label: 'My Sandbox' },
  );
}
```

The wrapper receives `{ command, args, cwd, env, shell, wrappers }` and returns the launch context to execute. Wrappers are applied in registration order. Use stable extension ids for wrapper ids.

## Extension process API policy

Extension backend code must use `ctx.shell` for process execution. Direct Node process APIs are blocked during backend builds and bundle loading for normal extension code:

- `child_process` / `node:child_process`
- `cluster` / `node:cluster`
- `worker_threads` / `node:worker_threads`

This is a guardrail against accidental bypasses, not a hostile-code security boundary. Unknown or hostile extension code still requires out-of-process isolation or a VM/workspace sandbox.

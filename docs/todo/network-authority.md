# Network Authority TODO

Network access should eventually follow the same authority/grants model as filesystem access and process execution, but we should hold off until filesystem authority and process sandboxing are further along. A half-implemented network layer would imply safety while bash, browser child processes, and native extension code could still bypass it. Bad bargain.

## Recommended direction

Create a core `NetworkAuthority` as the shared policy brain for network access:

```txt
agent/tool/extension call site
        │
        ▼
NetworkAuthority       ── subject identity, grants, destination registry
        │
        ▼
NetworkPolicy          ── allow/deny/ask decisions
        │
        ▼
NetworkHooks           ── extension/core interception, logging, redaction
        │
        ▼
Enforcement adapter    ── fetch client, Electron session, process sandbox/proxy
        │
        ▼
Network backend
```

The important design choice: keep one policy/grant/audit vocabulary, but use different enforcement adapters for different network surfaces.

## Surfaces to route through it

- First-class agent tools such as `web_fetch` and `web_search`.
- Extension SDK network APIs, for example future `ctx.network.fetch(...)` and `ctx.network.download(...)`.
- Built-in Workbench Browser traffic through Electron session hooks.
- Downloads through a Network Authority approval plus Filesystem Authority-managed staging root.
- Bash and child processes through the shared process launcher once network sandbox/proxy support exists.
- MCP/OAuth/helper network calls where practical.

## Built-in browser approach

Browser traffic does not call our TypeScript fetch client. It goes through Chromium. Enforce it at the Electron session boundary.

Use a dedicated session partition per browser context/conversation, then attach hooks:

- `session.webRequest.onBeforeRequest` for allow/deny of navigations, subresources, websockets, loopback, and LAN.
- `session.webRequest.onBeforeSendHeaders` for credential/header detection and redaction metadata.
- `session.webRequest.onHeadersReceived` for response metadata and redirects.
- `session.webRequest.onCompleted` / `onErrorOccurred` for final audit events.
- `session.on('will-download')` to stage downloads under a managed root instead of arbitrary paths.

CDP tools need a second policy layer because commands like `Runtime.evaluate`, `Page.navigate`, `Network.*`, and `Fetch.*` can initiate or mutate network behavior. Session hooks still catch the actual requests, but CDP command use should be audited/gated separately.

## Bash and agent-browser

Bash cannot be routed through a TypeScript network client. `curl`, `wget`, Python, Node, SSH, Playwright, and `agent-browser` talk to the OS network stack directly.

The honest model:

```txt
NetworkAuthority = policy brain
Direct tools/extensions = client adapter
Built-in browser = Electron session adapter
Bash/agent-browser = process sandbox/proxy adapter
```

For a future v1, the process launcher can pass `networkGrants` to wrappers alongside filesystem grants. A cooperative first step could inject proxy env vars:

```bash
HTTP_PROXY=http://127.0.0.1:<policy-proxy>
HTTPS_PROXY=http://127.0.0.1:<policy-proxy>
NO_PROXY=
```

For Chromium/Playwright child processes, wrappers may also need to inject browser proxy flags such as `--proxy-server`. This is useful for observability and cooperative tools, but it is not a hard security boundary. Real enforcement requires a sandbox, firewall/proxy boundary, container, VM, or equivalent process isolation.

## Policy defaults to consider

- Public internet: usually allow for explicit user/agent web tasks.
- Loopback: ask or deny by default.
- LAN/private IP ranges: ask or deny by default.
- SSH/listeners/raw sockets: ask or deny by default.
- Downloads: write only to a managed temp/download root, then copy/export via Filesystem Authority.
- Credentials: redact by default; audit whether credentials were present without storing secret values.

## Suggested sequencing

1. Finish Filesystem Authority.
2. Tighten process launcher and sandbox grant plumbing.
3. Add `NetworkAuthority` core types and permissive in-process implementation.
4. Route `web_fetch` / `web_search` through it.
5. Add extension `ctx.network` and manifest permission validation.
6. Add built-in browser Electron session adapter.
7. Add download staging through Filesystem Authority.
8. Add CDP command policy/audit.
9. Add process sandbox/proxy adapter for bash and `agent-browser`.

Until process sandboxing exists, network authority for bash is advisory. Do not present it as full enforcement.

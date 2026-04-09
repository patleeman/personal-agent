# Electron desktop app implementation spec

This document turns the Electron desktop app plan into an implementation-ready spec.

The target is a menubar-first Electron app that owns the local backend lifecycle, loads the existing web UI inside a desktop window, and supports saved remote connections through both SSH and direct web/Tailscale access.

## Final product decisions

These are locked in for the implementation:

- the desktop app always owns its own local daemon and web UI child processes
- closing the window does not quit the app; quitting the tray app stops owned local processes
- the desktop app loads the existing web UI instead of building a second renderer
- remote hosts are supported through two connection kinds:
  - `ssh`
  - `web` (direct HTTPS/Tailscale URL, using existing desktop pairing)
- the product needs a machine-local remote-connections management interface
- remote-host state should be visible both in native desktop chrome and in the renderer
- the tray "New conversation" action should focus/create the main window first and then navigate to the new-conversation route

## v1 scope

Ship a usable local desktop app first, but build it on a structure that does not need to be rewritten for remote support.

What v1 should include:

- `packages/desktop`
- tray app
- one main `BrowserWindow`
- local child-process ownership for daemon + web UI
- preload bridge for desktop-shell actions only
- machine-local desktop config
- settings UI for saved remote connections
- host abstraction with `local`, `ssh`, and `web` shapes
- remote UI state surfaces, even if SSH/Tailscale implementation lands in a later increment

What can come just after v1 if needed:

- actual `SshHostController`
- actual `WebHostController`
- packaged distribution polish
- login-item autostart
- tray unread badge and richer status

## Repo changes

### Root workspace

Add `packages/desktop` to the existing workspaces automatically through the root `packages/*` glob.

### Root `package.json` scripts

Add:

```json
{
  "scripts": {
    "desktop:build": "npm --prefix packages/desktop run build",
    "desktop:dev": "npm --prefix packages/desktop run dev",
    "desktop:start": "npm --prefix packages/desktop run start"
  }
}
```

On macOS, `desktop:dev` and `desktop:start` should launch through a renamed app wrapper (`Personal Agent.app`) rather than the raw `Electron.app` bundle so the system menu bar and app switcher use the product name instead of `Electron`.

### Root `tsconfig.json`

Add a project reference for `packages/desktop` once the package exists.

## `packages/desktop`

### Package shape

Create a dedicated Electron package with its own TypeScript build.

Suggested files:

```text
packages/desktop/
  package.json
  tsconfig.json
  src/
    main.ts
    preload.ts
    config.ts
    window.ts
    tray.ts
    ipc.ts
    desktop-env.ts
    hosts/
      types.ts
      host-manager.ts
      local-host-controller.ts
      ssh-host-controller.ts
      web-host-controller.ts
    backend/
      local-backend-processes.ts
      ports.ts
      health.ts
      child-process.ts
    state/
      desktop-config.ts
      browser-partitions.ts
```

### `package.json`

Use a plain Electron package first. Do not bring in an Electron framework unless it becomes necessary.

Suggested package shape:

```json
{
  "name": "@personal-agent/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "scripts": {
    "build:deps": "npm --prefix ../web run build && npm --prefix ../daemon run build && npm --prefix ../core run build && npm --prefix ../resources run build && npm --prefix ../services run build",
    "build": "npm run build:deps && tsc --build --force",
    "start": "electron dist/main.js",
    "dev": "npm run build && electron dist/main.js"
  },
  "dependencies": {
    "electron": "<current-stable>",
    "@personal-agent/core": "*",
    "@personal-agent/daemon": "*",
    "@personal-agent/resources": "*",
    "@personal-agent/services": "*"
  }
}
```

Notes:

- Keep the initial build boring.
- Build the existing web server and web client artifacts before launching Electron.
- Packaging tools such as `electron-builder` can be added later when distribution work starts.

### `tsconfig.json`

Use NodeNext output similar to other Node-side packages.

Suggested compiler shape:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

## Desktop config and machine-local state

Desktop config should be machine-local, not part of the shared vault.

### Config file location

Store it under the normal state root:

- `~/.local/state/personal-agent/desktop/config.json`

Use `@personal-agent/core` state-root helpers instead of hardcoding the path.

### Config schema

Suggested initial schema:

```ts
interface DesktopConfig {
  version: 1;
  defaultHostId: string;
  openWindowOnLaunch: boolean;
  windowState?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
  hosts: DesktopHostRecord[];
}

type DesktopHostRecord =
  | {
      id: string;
      label: string;
      kind: 'local';
    }
  | {
      id: string;
      label: string;
      kind: 'ssh';
      sshTarget: string;
      remoteRepoRoot?: string;
      remotePort?: number;
      autoConnect?: boolean;
    }
  | {
      id: string;
      label: string;
      kind: 'web';
      baseUrl: string;
      autoConnect?: boolean;
    };
```

Rules:

- `local` host is always present.
- `defaultHostId` defaults to `local`.
- do not store pairing tokens or session cookies in this config file.
- browser auth state should live in Electron session storage partitioned per host.

## Browser session partitioning

Each host should get its own persistent Electron browser partition.

Example:

- local host → `persist:pa-host-local`
- ssh host `gpu-box` → `persist:pa-host-gpu-box`
- web host `home-tailnet` → `persist:pa-host-home-tailnet`

This matters because it isolates:

- cookies
- localStorage
- service-worker/browser state
- remote desktop pairing sessions

Without host partitions, switching between multiple remote instances will get messy fast.

## Host abstraction

Use one host interface across local and remote modes.

```ts
interface HostController {
  readonly id: string;
  readonly label: string;
  readonly kind: 'local' | 'ssh' | 'web';
  ensureRunning(): Promise<void>;
  getBaseUrl(): Promise<string>;
  getStatus(): Promise<HostStatus>;
  openNewConversation(): Promise<string>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

interface HostStatus {
  reachable: boolean;
  mode: 'local-child-process' | 'ssh-tunnel' | 'web-remote';
  summary: string;
  webUrl?: string;
  daemonHealthy?: boolean;
  webHealthy?: boolean;
  lastError?: string;
}
```

`openNewConversation()` returns the URL that the main window should navigate to after focus/open.

### Host manager

Add a `HostManager` in the desktop package to:

- load/save config
- resolve `DesktopHostRecord` → `HostController`
- track the active host
- switch hosts safely
- expose host summaries for tray and settings UI

The rest of the desktop app should depend on `HostManager`, not on raw host records.

## Local backend process model

### Core rule

The Electron app owns the local daemon and web UI as child processes.

Do not use:

- launchd/systemd managed web UI service
- launchd/systemd managed daemon service
- detached background daemons started outside the Electron process tree
- normal "reuse already-running local instance" behavior

### Migration behavior

On first launch of the desktop app, if managed web UI or daemon services appear to be installed or running, the desktop app should surface a one-time migration warning:

- "Desktop app manages the backend directly now. Stop/uninstall old services if you no longer need them."

This can initially be informational rather than destructive.

## Local child-process implementation

### Daemon child process

Spawn the daemon directly in foreground mode from Electron main.

Command shape:

```bash
node packages/daemon/dist/index.js --foreground
```

Implementation notes:

- use `process.execPath` as the Node binary in development and packaged builds
- pipe stdout/stderr to a desktop-owned log file and an in-memory ring buffer for diagnostics
- monitor exit codes and restart only when the app is not intentionally shutting down

Do **not** use `startDaemonDetached()` for desktop-owned local mode.

### Web UI child process

Spawn the existing built web server directly.

Command shape:

```bash
node packages/web/dist-server/index.js
```

Required environment:

- `PA_WEB_PORT=<desktop-managed-port>`
- `PA_WEB_DIST=<resolved-packaged-or-workspace-dist-dir>`
- `PA_WEB_DISABLE_COMPANION=1`
- `PERSONAL_AGENT_REPO_ROOT=<repo-root-or-packaged-resource-root>`

Why disable companion here:

- the Electron app does not need the separate companion server
- it avoids extra ports and moving pieces for the desktop-owned local instance
- companion/mobile access can remain a separate path when needed

### Port strategy

Use a desktop-managed local port, defaulting to `3741` unless occupied.

Rules:

- local desktop web UI prefers a stable configured port
- if the preferred port is busy, the desktop app can either:
  - fail with a clear migration/conflict message, or
  - pick a fallback free port and record it for the session

Preferred behavior: fail with a clear conflict message first, because the product expectation is that the desktop app owns the local instance.

### Health checks

The local host controller should use simple HTTP health checks.

Suggested checks:

- `GET /api/status`
- `GET /api/daemon`

Startup flow:

1. spawn daemon
2. wait for daemon health
3. spawn web UI
4. wait for web UI health
5. mark local host as active

### Shutdown flow

On app quit:

1. stop accepting tray/window actions
2. ask local host controller to stop
3. send polite termination to web UI child
4. send polite termination to daemon child
5. escalate to kill only if the children do not exit in time

## Entry-point and path resolution

The desktop package needs one place that resolves runtime paths differently for dev and packaged modes.

Add a small resolver that returns:

- desktop app dist directory
- web server entry file
- web client dist directory
- daemon entry file
- repo root or resource root

In development it should resolve workspace paths such as:

- `packages/daemon/dist/index.js`
- `packages/web/dist-server/index.js`
- `packages/web/dist`

In packaged mode it should resolve bundled resources instead.

Do not scatter path guessing throughout the desktop package.

## Main window behavior

### One main window

Start with one main `BrowserWindow`.

Settings:

- `show: false` until ready
- `contextIsolation: true`
- `nodeIntegration: false`
- preload script enabled
- persistent session partition per host

### Open/focus rules

- if no main window exists, create one
- if the window exists but is hidden/minimized, restore and focus it
- if the active host changed, recreate or retarget the window with the correct partition and URL

### Close behavior

Intercept close so that:

- normal window close hides the window
- app quit performs real shutdown

## Tray behavior

### Initial tray menu

- Open personal-agent
- New conversation
- Connections…
- Restart backend
- Quit

### Tray status text

The tray should eventually show:

- active host label
- healthy/degraded state
- optional unread count

For the first implementation, menu text is enough; a richer icon state can come after.

## New conversation tray action

This should be implemented as a desktop-shell action, not a blind raw URL open.

Concrete behavior:

1. ask `HostManager` for the active host
2. ensure that host is running/reachable
3. create or focus the main window for that host
4. navigate the window to the host-provided new-conversation URL

For local and remote web hosts, the resulting route should be:

- `/conversations/new`

The reason to treat this as a native action first is reliability: the tray action should work even when no renderer is mounted yet.

## Preload bridge

The preload bridge is for desktop-shell behavior only.

### Exposed API

```ts
interface DesktopBridge {
  getEnvironment(): Promise<DesktopEnvironmentState>;
  getConnections(): Promise<DesktopConnectionsState>;
  connectToHost(hostId: string): Promise<void>;
  disconnectFromHost(): Promise<void>;
  restartActiveHost(): Promise<void>;
  openNewConversation(): Promise<void>;
  showConnectionsWindow(): Promise<void>;
}
```

### Environment payload

Suggested shape:

```ts
interface DesktopEnvironmentState {
  isElectron: true;
  activeHostId: string;
  activeHostLabel: string;
  activeHostKind: 'local' | 'ssh' | 'web';
  activeHostSummary: string;
  canManageConnections: true;
}
```

The renderer should read this to show the active host clearly.

## Renderer changes in `packages/web`

The web app should stay mostly transport-agnostic.

### Always-visible remote state

Add a lightweight always-visible host indicator in app chrome.

Requirements:

- visible on every desktop route
- text-first, not a decorative pill
- shows host label and connection type
- clearly marks remote hosts

Example:

- `Local host`
- `Remote host · GPU box (SSH)`
- `Remote host · Home desktop (Web)`

### Settings UI for connections

Add a **Connections** section to the existing Settings page rather than a new top-level page first.

That section should support:

- showing the active host
- listing saved hosts
- adding a new host
- editing an existing host
- removing a remote host
- setting the default host on launch
- connecting to a selected host
- disconnecting back to local
- test connection / diagnostic output

The first version should keep the editor simple.

Fields by kind:

#### Local

- label (optional, default `Local`)

#### SSH

- label
- ssh target
- remote repo root (optional)
- remote web UI port (default `3741`)
- auto-connect on launch

#### Web

- label
- base URL
- auto-connect on launch

### Pairing / desktop auth for web hosts

For direct web/Tailscale hosts, reuse the existing desktop pairing flow already present in the web UI.

That means:

- the Electron window simply loads the remote URL in that host's browser partition
- if the remote host requires desktop sign-in, the existing pairing screen appears
- session cookies live inside that host partition
- the desktop app config stores host metadata, not auth tokens

### Remote limitations in UI

The renderer should make remote mode obvious when it matters.

Initial rules:

- host indicator always visible
- connection diagnostics available in Settings → Connections
- any clearly local-only affordance should either hide or explain itself when on a remote host

Do not try to solve every local-vs-remote edge case in the first pass. Just avoid silent ambiguity.

## Remote controllers

## `WebHostController`

This is the simpler remote mode and should likely land before SSH.

Responsibilities:

- hold a configured `baseUrl`
- verify reachability with `/api/status`
- return the remote base URL
- rely on the renderer/browser partition for desktop pairing cookies
- surface useful errors for unreachable hosts or invalid HTTPS/Tailscale URLs

This mode is the path for Tailscale-served remote instances.

## `SshHostController`

This is the more capable remote mode.

Responsibilities:

- establish an SSH connection using the user's existing SSH config and agent
- optionally run remote startup commands if the remote web UI is not running
- open a local port-forward tunnel to the remote web UI port
- return a local forwarded base URL such as `http://127.0.0.1:<dynamic-port>`
- clean up the SSH child/tunnel on disconnect or host switch

Suggested startup strategy:

1. attempt HTTP health check through an SSH-forwarded port
2. if the remote web UI is not up, run remote startup commands
3. retry health check
4. surface a clean error if the host never becomes healthy

The remote startup commands can be refined later, but start with something simple and explicit.

Possible command approach:

```bash
cd <remoteRepoRoot> && pa daemon start && PA_WEB_PORT=<port> pa ui
```

If that is too brittle, add a dedicated remote bootstrap command later rather than overcomplicating the first implementation.

## Native vs renderer responsibility split

### Native desktop chrome owns

- app lifecycle
- tray
- host switching
- child-process ownership
- connection establishment and teardown
- window creation/focus
- emergency restart / diagnostics entrypoints

### Renderer owns

- displaying active host
- connection settings UI
- pairing UI for direct web hosts
- host diagnostics view fed through the preload bridge

This split keeps the product understandable: native shell handles machine-level orchestration, while the renderer handles product UI.

## Logging and diagnostics

Desktop mode needs its own machine-local logs.

Suggested files:

- `~/.local/state/personal-agent/desktop/logs/main.log`
- `~/.local/state/personal-agent/desktop/logs/web-ui.log`
- `~/.local/state/personal-agent/desktop/logs/daemon.log`
- `~/.local/state/personal-agent/desktop/logs/remote-<host-id>.log`

Expose recent diagnostics in Settings → Connections for the active or selected host.

## Testing plan

### Desktop package tests

Add focused unit tests for:

- config load/save and migration
- browser partition naming
- host manager switching behavior
- local process health state transitions
- tray action routing logic

### Existing web tests to add/update

Add or update tests for:

- active host indicator rendering
- desktop connections settings section
- renderer behavior when `window.personalAgentDesktop` is absent
- renderer behavior when Electron environment is present

### Manual validation

At minimum validate:

1. desktop app launch starts local daemon + web UI
2. main window opens and reloads normally
3. close hides to tray
4. quit stops local children
5. new conversation from tray opens correctly
6. switching to a web/Tailscale host preserves separate auth state
7. remote host label is always visible in the app

## Implementation order

### Phase 1

- create `packages/desktop`
- add Electron main/preload/window/tray skeleton
- add desktop config loader
- add host types and host manager

### Phase 2

- implement `LocalHostController`
- implement local child-process spawning and health checks
- wire tray open/restart/new-conversation actions

### Phase 3

- add preload bridge
- add renderer host indicator
- add Settings → Connections section backed by preload

### Phase 4

- implement `WebHostController`
- support direct web/Tailscale remote hosts
- validate existing desktop pairing flow inside Electron

### Phase 5

- implement `SshHostController`
- add SSH tunnel lifecycle and diagnostics
- add host-switch cleanup behavior

### Phase 6

- packaging and distribution polish
- optional login-item setup
- nicer tray status and connection feedback

## Strong default choices

If something is ambiguous during implementation, prefer these defaults:

- one main window, not multiple app windows
- one active host at a time
- Settings-page connections UI before a separate native manager window
- direct web/Tailscale remote support before SSH orchestration complexity
- informative failures over automatic fallback behavior
- host-specific browser partitions instead of shared renderer session state

That keeps the first implementation small, understandable, and aligned with the way `personal-agent` already works.
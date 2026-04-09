# Electron desktop app plan

This document outlines the plan to wrap `personal-agent` in an Electron desktop app.

The goal is to ship a menubar-first desktop app that owns the local backend while it is running, reuses the existing web UI instead of rebuilding a second renderer, and leaves a clean path for connecting to remote desktop instances later over SSH.

For the concrete package/file/runtime design, see [Electron desktop app implementation spec](./electron-desktop-app-spec.md).

## Goals

1. Ship a tray/menubar app for day-to-day desktop use.
2. Open the existing `personal-agent` web UI inside an Electron window.
3. Keep the local daemon and web UI tied to the desktop app lifecycle.
4. Preserve a clean path for remote-host support.
5. Avoid creating a second product surface when the web UI already exists.

## Non-goals for v1

- Replacing the browser-based web UI with a native Electron renderer.
- Talking to the daemon socket directly from the renderer.
- Building a custom remote protocol.
- Solving mobile/companion access through Electron.
- Making the backend survive after the desktop app quits.

## Core decision

Use Electron as a **host shell**, not as a second application stack.

That means:

- the Electron **main process** owns tray behavior, backend lifecycle, and host selection
- the Electron **renderer** is just the existing web UI loaded in a `BrowserWindow`
- the Electron **preload** exposes a very small desktop bridge for tray/window/host actions
- the local backend still uses the existing web server and daemon processes

This is the simplest approach that keeps the product coherent and reduces duplicated UI work.

## User experience target

### Local mode

When the desktop app launches:

1. the tray app starts
2. it ensures the local daemon and web UI are running
3. it opens or can open a main application window pointed at the local web UI
4. closing the window keeps the tray app alive
5. quitting the tray app stops the local services it started

This matches the desired constraint that the app only needs to be available while the menubar app is open.

### Remote mode

Later, the desktop app should also be able to:

1. connect to another machine over SSH
2. forward the remote web UI to a local port
3. optionally ensure the remote backend is running
4. load that remote instance in the same Electron window

The desktop shell should treat local and remote instances as different implementations of the same host interface.

## Architecture

### 1. `packages/desktop`

Add a new workspace package for Electron.

Expected responsibilities:

- app bootstrap
- tray / menubar integration
- window management
- backend host selection
- local process supervision
- secure preload bridge
- packaging entrypoints and assets

Keep web UI code in `packages/web` rather than forking or copying it.

### 2. Host abstraction

Introduce a narrow host-control layer in the desktop package.

```ts
interface HostController {
  id: string;
  label: string;
  kind: 'local' | 'ssh';
  ensureRunning(): Promise<void>;
  getStatus(): Promise<HostStatus>;
  getBaseUrl(): Promise<string>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

The important rule is that the tray app, window manager, and preload bridge should depend on this interface instead of assuming `localhost`.

Implementations:

- `LocalHostController` for the local machine
- `SshHostController` for remote machines later

### 3. Local backend ownership

For v1, the Electron app should manage the local backend directly instead of depending on long-lived system services.

The local controller should:

- always start its own daemon and web UI child processes
- treat the desktop app as the owner of the local backend lifecycle
- health-check those child processes and restart them when needed
- stop owned processes on app quit
- avoid a "reuse an existing local service" mode in the normal desktop flow

This keeps lifecycle simple, matches the intended desktop behavior, and avoids split-brain state between a desktop-owned instance and a separately managed local instance.

### 4. Window strategy

Start with one main `BrowserWindow`.

Requirements:

- loads the selected host's base URL
- reopens quickly from the tray
- closes to tray instead of quitting the app
- uses preload + context isolation
- keeps `nodeIntegration` disabled

A tray popover can be added later, but it should not block the first version.

### 5. Tray strategy

The tray is the primary desktop affordance.

Initial tray menu:

- Open personal-agent
- New conversation
- Restart backend
- Show status
- Quit

The tray title/icon state can later reflect:

- backend healthy / unhealthy
- unread attention count
- current host label

### 6. Preload bridge

Keep the IPC surface small and explicit.

Likely APIs:

- `desktop.getHostStatus()`
- `desktop.openMainWindow()`
- `desktop.restartBackend()`
- `desktop.switchHost()`
- `desktop.getDesktopEnvironment()`

The web app should keep using HTTP for application data. The preload bridge is only for desktop-shell features.

### 7. Web UI expectations

The current web UI is already close to what the Electron shell needs because it talks to relative `/api/*` routes.

Still, the desktop plan should assume a small cleanup pass in `packages/web` for things like:

- removing assumptions that the app always runs in a normal browser tab
- exposing a desktop-aware status surface if needed
- ensuring reload/reconnect behavior is solid during backend restarts
- keeping URL handling neutral between local and SSH-forwarded hosts

The desktop app should avoid adding Electron-only business logic to the main product UI when a plain browser flow still works.

## Remote support plan

### Why SSH

SSH is good enough for the first remote version because it avoids inventing another transport and matches the current machine-oriented architecture.

### Remote model

Remote support should use the web UI as the remote protocol surface.

There should be two remote connection modes:

1. **SSH-backed hosts**
2. **Tailscale/browser-backed hosts with pairing**

For SSH-backed hosts, `SshHostController` should:

1. connect to the remote machine over SSH
2. optionally run remote `pa daemon start` / `pa ui` commands when needed
3. establish local port forwarding to the remote web UI
4. return a local forwarded base URL to the Electron window

For Tailscale/browser-backed hosts, a separate host controller should:

1. store the remote base URL
2. handle desktop pairing/session bootstrap as needed
3. reuse the existing web authentication model instead of tunneling processes
4. return the paired remote base URL to the Electron window

This is simpler than trying to proxy raw daemon IPC into the desktop app and keeps remote access aligned with the current web UI architecture.

### Remote configuration

The desktop app needs a machine-local interface for managing remote connections.

That should include:

- a native or web-based desktop settings surface for adding/editing/removing hosts
- a current-host picker
- per-host connection diagnostics
- connect/disconnect actions
- default-host-on-launch behavior

Saved host entries should leave room for fields like:

- label
- connection kind (`ssh` or `web`)
- ssh target
- remote repo path or working directory
- remote web UI port
- remote base URL
- pairing/session metadata for web-connected hosts
- auto-connect on launch

Store this in machine-local desktop config, not the shared portable vault.

### Remote guardrails

Remote mode should make these boundaries explicit:

- local filesystem affordances are not valid for a remote host
- local-only automation integrations should stay local unless explicitly remote-safe
- the UI should clearly show which host is active
- connection problems should be visible both in native desktop chrome and inside the app UI

## Security model

Desktop app security should stay boring.

Rules:

- disable `nodeIntegration`
- enable `contextIsolation`
- use a narrow preload API
- treat remote hosts as untrusted transport boundaries
- do not pass secrets through the renderer when main-process ownership is enough
- avoid shelling out from renderer code

For SSH credentials, rely on the user's normal SSH setup rather than inventing a credential manager in v1.

## Packaging and distribution

The desktop package should eventually support:

- macOS app bundle with tray support first
- code signing/notarization later
- packaged app icons and launch behavior
- optional login-item autostart later

Do not block the first implementation on auto-update or login-item polish.

## Proposed repo changes

### New package

- `packages/desktop`

### Likely scripts

At the repo root and/or package level:

- desktop dev
- desktop build
- desktop package

### Possible supporting changes

- small web UI adjustments for desktop awareness
- small CLI/server changes if backend launch/status detection needs cleaner programmatic entrypoints
- docs updates for the new desktop interface

## Milestones

### Milestone 1: Electron shell skeleton

- create `packages/desktop`
- boot Electron main process
- add preload bridge
- open a `BrowserWindow` against a configurable URL
- add tray icon and basic menu

Exit criterion: a local development Electron shell can open the existing web UI manually.

### Milestone 2: Local host controller

- implement `LocalHostController`
- health-check local daemon and web UI
- start backend processes when absent
- track owned processes
- stop owned processes on app quit

Exit criterion: launching the desktop app reliably brings up a working local instance.

### Milestone 3: Menubar-first workflow

- close-to-tray behavior
- tray actions for open/new conversation/restart/quit
- backend status in tray menu
- better startup/failure messaging

Exit criterion: the tray app is usable as the normal way to launch `personal-agent`.

### Milestone 4: Web UI desktop cleanup

- validate reconnect behavior during backend restarts
- add optional desktop-only UI affordances through preload
- fix any browser assumptions that break inside Electron

Exit criterion: the existing web app feels stable inside Electron without a fork.

### Milestone 5: Remote host abstraction

- introduce saved host configuration
- implement host switching in the desktop shell
- make window/tray code host-agnostic

Exit criterion: desktop shell is structurally ready for remote mode even if SSH is not shipped yet.

### Milestone 6: SSH remote support

- implement `SshHostController`
- support SSH port forwarding to remote web UI
- optionally start remote backend if needed
- expose host picker and connection state

Exit criterion: one desktop app can switch between local and SSH-backed remote instances.

### Milestone 7: Packaging polish

- app icons
- packaged builds
- installer/distribution notes
- optional autostart/login item work

Exit criterion: packaged desktop builds are practical for daily use.

## Product decisions and follow-ups

The current product decisions are:

- the desktop app should always prefer its own local child processes
- remote access should support both SSH-backed hosts and Tailscale/browser-connected hosts with pairing
- the desktop app needs a remote-connections management interface or settings surface

Implementation follow-ups still worth deciding in detail:

- whether "new conversation" tray actions should deep-link to an existing route like `/conversations/new` or call a desktop bridge action that focuses/creates the target window first and then navigates
- how much remote-host state should appear inside the renderer versus only in native tray/window chrome

## Recommended implementation stance

Build the desktop app in this order:

1. Electron shell
2. local host controller with app-owned child processes
3. tray-first local workflow
4. web UI cleanup inside Electron
5. remote host model + connections settings surface
6. SSH and Tailscale/browser remote support
7. packaging polish

That order keeps the first shipped version simple while preserving a clean path for remote instances.
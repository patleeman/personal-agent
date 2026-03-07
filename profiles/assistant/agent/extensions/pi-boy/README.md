# pi-boy

A Game Boy / Game Boy Color emulator stuffed directly into the pi terminal UI.

This is a goofy side project. It is not serious. It is not trying to become the One True Emulator Experience. It exists because putting a Game Boy inside pi sounded funny, and then it worked.

Under the hood, pi-boy uses mGBA plus a tiny native bridge for video and audio. On the surface, it lets you launch a ROM in your terminal and feel mildly delighted that this is a thing you can do.

## Why pi-boy?

Because why not?

More specifically:

- because playing Game Boy in a terminal is inherently funny
- because pi can render it inline, which makes the whole thing even sillier
- because side projects are allowed to be a little unhinged
- because opening a normal emulator window would have been far less entertaining

## What it does

- plays `.gb` and `.gbc` ROMs inside pi
- uses mGBA through a bundled native bridge in `mgba-bridge/`
- renders with Kitty images when available
- falls back to ANSI rendering when Kitty is not available
- supports inline and overlay display modes
- lets you pick ROMs from a configured ROM directory
- supports path autocomplete for `/pi-boy:load_rom`
- includes a built-in self-test
- lets you toggle audio on and off with `M`
- tries to recover automatically if the bridge dies in a recoverable way

## What you need

- Node.js + npm
- a pi environment that loads this repo as an extension
- your own legally owned `.gb` or `.gbc` ROMs
- native build tools for the bundled mGBA bridge:
  - `cc`
  - `make`
  - `rsync`

Nice to have:

- a Kitty-compatible terminal for prettier rendering
- `ffplay` for the most reliable audio on macOS

> The bundled bridge currently builds around the macOS-style `mgba_libretro.dylib`, so the default path is most at home on macOS right now.

## Get it running

1. Install dependencies:

   ```bash
   npm install
   ```

2. Optional: build the native bridge now instead of waiting for first launch:

   ```bash
   npm run build:mgba
   ```

3. Launch pi from this repo so it discovers the extension via `package.json`.

4. In pi, open the setup menu:

   ```text
   /pi-boy:settings
   ```

5. Set a ROM directory and choose a ROM.

6. Start the tiny terminal handheld dream:

   ```text
   /pi-boy:start
   ```

Audio starts muted by default. Press `M` while playing if you want the full chaos.

## Commands

| Command | Description |
| --- | --- |
| `/pi-boy:settings` | Open the interactive settings menu for ROM directory, ROM selection, audio backend, render mode, ANSI block mode, overlay mode, and self-test. |
| `/pi-boy:load_rom [path]` | Save a ROM path directly. Without an argument, pi-boy opens the picker/input flow. Supports `.gb` / `.gbc` autocomplete. |
| `/pi-boy:start` | Start pi-boy with the current ROM selection (and auto-resume if a suspend state exists). |
| `/pi-boy:clear_suspend [path]` | Delete a ROM's suspend state. Without an argument, it opens a picker listing all suspend states. |

## Controls

| Input | Action |
| --- | --- |
| Arrow keys or `W A S D` | D-pad |
| `Z` or `J` | B |
| `X` or `K` | A |
| `Enter` or `P` | Start |
| `Tab` or `Backspace` | Select |
| `M` | Toggle audio |
| `Q` or `Esc` | Quit and suspend progress |

## Settings and config

pi-boy stores persistent data at:

- `~/.config/pi-boy/config.json` (settings)
- `~/.config/pi-boy/states/*.state` (auto suspend/resume states)

Most people should just use `/pi-boy:settings`. It can manage:

- ROM directory
- selected ROM
- audio backend (`auto`, `speaker`, `ffplay`)
- render mode (`auto`, `ansi`)
- ANSI block mode (`half`, `quarter`)
- overlay mode (`inline`, `overlay`)
- self-test
- clearing the saved ROM
- resetting all saved settings

### Environment overrides

Environment variables are optional. If you like configuring things the hard way, these override saved settings where applicable.

| Variable | Effect |
| --- | --- |
| `PI_BOY_ROM_PATH` | Default ROM path when no command argument is provided. |
| `PI_BOY_FORCE_ANSI=1` | Force ANSI rendering. |
| `PI_BOY_ANSI_BLOCK_MODE` | Set ANSI block mode to `half` or `quarter`. |
| `PI_BOY_AUDIO_BACKEND` | Set audio backend preference to `auto`, `speaker`, or `ffplay`. |
| `PI_BOY_FORCE_OVERLAY=1` | Force overlay mode instead of inline rendering. |
| `PI_BOY_MGBA_BRIDGE_BIN=/absolute/path/to/pi-boy-mgba-bridge` | Use a custom mGBA bridge binary. |
| `PI_BOY_MGBA_BRIDGE_REBUILD=1` | Rebuild the bundled bridge on the next start. |

## Rendering and audio weirdness

- `auto` render mode prefers Kitty image rendering when available.
- iTerm defaults to ANSI mode because image rendering is unstable there.
- `quarter` ANSI mode gives more detail, but is usually slower than `half` mode.
- Inline mode is the default; overlay mode is available from settings or via `PI_BOY_FORCE_OVERLAY=1`.
- Audio is opt-in and starts muted.
- Audio backend order:
  - macOS `auto`: `ffplay` → `speaker`
  - other platforms `auto`: `speaker` → `ffplay`

## How this nonsense works

pi-boy uses **mGBA** as its only emulator core.

The repo includes a native sidecar in `mgba-bridge/` that:

- builds the bundled libretro mGBA core
- exposes a local `pi-boy-mgba-bridge` executable
- streams video and audio back to the TypeScript extension

If the bridge exits in a recoverable way, pi-boy tries to restart it and reload the current ROM automatically.

## If you want to tinker with it

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Run TypeScript type checking. |
| `npm test` | Run tests. |
| `npm run build:mgba` | Build the bundled mGBA bridge manually. |
| `PI_BOY_TEST_ROM=/absolute/path/to/game.gb npm run test:smoke` | Run the real-ROM smoke test. |

## Notes

- pi-boy does **not** bundle ROMs.
- Only compatible `.gb` and `.gbc` ROMs are supported.
- The self-test lives inside `/pi-boy:settings`.
- Exiting with `Q`/`Esc` auto-suspends. Resume with `/pi-boy:start`.
- Use `/pi-boy:clear_suspend` to delete suspend state when you want a clean start.
- This project is for fun, which is honestly the main feature.

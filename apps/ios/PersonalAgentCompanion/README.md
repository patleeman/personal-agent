# Personal Agent iOS companion app

Native iOS companion client for the daemon-backed companion host API.

Location:

```text
apps/ios/PersonalAgentCompanion
```

## What it does

- pair to a companion host with manual pairing code entry or setup QR + bearer token
- persist paired hosts locally and keep the token in Keychain
- choose a host first, then work in a per-host Chat / Knowledge / Archived / Automations / Settings shell
- mirror host conversation ordering with pinned/open lists plus a dedicated Archived tab for archived and older hidden threads, and native pin/archive/unarchive/duplicate controls
- open a conversation and stream transcript updates over the multiplexed companion socket
- send prompts with text, prompt images, and saved drawing attachment refs
- restore queued steer/follow-up prompts, manage parallel jobs, and see live control/presence state from iPhone
- take over control, abort a turn, rename a conversation, browse local/remote directories for cwd changes, adjust model preferences from the live host catalog, and switch execution target
- browse conversation artifacts and commit checkpoints, and create new checkpoints from iOS
- browse and edit markdown notes in the host knowledge base, including folder navigation, note/folder creation, rename/delete actions, autosave + local draft recovery, single-surface markdown editing, note-link search/insert, inline image insertion, conflict handling, and mobile markdown editing tools like smart list continuation plus a keyboard toolbar
- save shared text, URLs, and images from iOS into the host knowledge base through the companion share extension; URL shares are imported as markdown notes with extracted readable content + frontmatter metadata, and image shares become markdown notes backed by vault assets
- browse saved drawing attachments, inspect revisions, and create/update drawing assets with a native PencilKit editor that exports Excalidraw-compatible source + preview assets
- manage automations from the phone, including background-agent callback delivery controls, with durable-run details still reachable from the companion surfaces
- manage paired devices, setup state, and SSH targets from iOS

The share flow is knowledge-first right now: the share extension hands text, web URLs, and images to the main app, and the main app imports them into `Inbox/` in the host vault.

## Build and test

From the repo root:

```bash
cd apps/ios/PersonalAgentCompanion
xcodebuild test \
  -project PersonalAgentCompanion.xcodeproj \
  -scheme PersonalAgentCompanion \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO
```

## Mock mode

For the fastest local UI smoke tests without a running host:

```bash
npm run ios:demo
```

If you want to open straight into a simulated in-progress turn so you can test steer, follow-up, and parallel prompts:

```bash
npm run ios:demo:running
```

That command:

- pulls a few recent real transcripts from this Mac into `apps/ios/PersonalAgentCompanion/demo-data/local-transcripts.json`
- prefers conversations that already contain tool calls
- boots the simulator
- reinstalls the app with a clean sandbox
- launches it in mock mode using those local transcripts as the demo seed
- auto-connects to the demo host
- with `ios:demo`, lands in the conversation list
- with `ios:demo:running`, opens the first demo conversation with a one-tap **Start simulated run** control so you can exercise steer, follow-up, and parallel prompt flows

If you just want to refresh the local demo transcript snapshot without launching the app:

```bash
npm run ios:demo:refresh
```

Manual mock-mode launch still works too:

```bash
cd apps/ios/PersonalAgentCompanion
xcodebuild build \
  -project PersonalAgentCompanion.xcodeproj \
  -scheme PersonalAgentCompanion \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO

APP=$(find ~/Library/Developer/Xcode/DerivedData/PersonalAgentCompanion-* \
  -path '*Build/Products/Debug-iphonesimulator/PersonalAgentCompanion.app' | head -1)

xcrun simctl boot 'iPhone 17 Pro'
xcrun simctl install booted "$APP"
SIMCTL_CHILD_PA_IOS_MOCK_MODE=1 \
SIMCTL_CHILD_PA_IOS_USE_DEVICE_DEMO_DATA=1 \
SIMCTL_CHILD_PA_IOS_AUTO_CONNECT_MOCK_HOST=1 \
SIMCTL_CHILD_PA_IOS_AUTO_OPEN_FIRST_MOCK_CONVERSATION=1 \
SIMCTL_CHILD_PA_IOS_DEMO_SNAPSHOT_FILE="$PWD/demo-data/local-transcripts.json" \
  xcrun simctl launch booted com.personalagent.ios.companion
```

If you want a fast Knowledge-editor smoke test instead of the conversation list, launch with:

```bash
SIMCTL_CHILD_PA_IOS_MOCK_MODE=1 \
SIMCTL_CHILD_PA_IOS_AUTO_CONNECT_MOCK_HOST=1 \
SIMCTL_CHILD_PA_IOS_AUTO_SELECT_KNOWLEDGE_TAB=1 \
SIMCTL_CHILD_PA_IOS_AUTO_OPEN_KNOWLEDGE_NOTE=notes/ios-companion.md \
  xcrun simctl launch booted com.personalagent.ios.companion
```

Optional host convenience env var:

```text
PA_IOS_DEFAULT_HOST=http://127.0.0.1:3843
```

## Fast local dev loop

Use the simulator against a loopback-only local companion host. This is the fast path for UI, conversation, and onboarding iteration.

From the repo root:

```bash
npm run ios:dev:prepare
npm run ios:dev
```

`npm run ios:dev` starts the local companion host, boots the simulator, installs the app, and launches it already paired.

If you want to manage the pieces separately, use:

Terminal 1:

```bash
npm run ios:dev:host
```

That starts a headless local companion host on:

```text
http://127.0.0.1:3845
```

Terminal 2:

```bash
npm run ios:dev:sim
```

That will:

- mint a fresh paired device token against the local host
- write the live-test config to `/tmp/personal-agent-ios-live-test-config.json`
- build the app into a stable derived-data path
- boot `iPhone 17 Pro`
- install the app into the simulator
- launch it already paired using bootstrap env vars

For onboarding/deeplink work, open a fresh setup link directly in the simulator:

```bash
npm run ios:dev:setup-url
```

That bypasses phone cameras and QR scanning while still exercising the real `pa-companion://pair?...` flow.

## Real host notes

The live app expects the desktop runtime or headless local dev host to be running on the target machine so the daemon companion server has an attached conversation runtime provider.

Typical fast local-dev path:

1. start the local dev host with `npm run ios:dev:host`
2. launch the simulator with `npm run ios:dev:sim`
3. only use a real phone for final LAN/Tailnet smoke tests

## Live integration test

The test target includes a real-host round-trip that:

- pairs against a live companion host
- creates a conversation
- creates and downloads an attachment
- fetches real conversation bootstrap state over the companion socket

Fast path from the repo root:

```bash
npm run ios:test:live
```

That targets only the real-host iOS integration tests against the local dev host and rewrites the config file automatically. By default it does not send a real model prompt, so it stays fast and works even when you do not have model credentials loaded.

Manual path: enable it with a config file before `xcodebuild test`:

```json
{
  "enabled": true,
  "baseURL": "http://127.0.0.1:3845",
  "pairingCode": "XXXX-XXXX-XXXX",
  "cwd": "/absolute/path/to/repo",
  "exercisePrompt": false
}
```

Write that to:

```text
/tmp/personal-agent-ios-live-test-config.json
```

The test will also honor direct process env when you run it under a harness that forwards test runtime environment:

```text
PA_IOS_LIVE_COMPANION_TEST=1
PA_IOS_LIVE_COMPANION_URL=http://127.0.0.1:3845
PA_IOS_LIVE_COMPANION_PAIRING_CODE=XXXX-XXXX-XXXX
PA_IOS_LIVE_COMPANION_CWD=/absolute/path/to/repo
PA_IOS_LIVE_COMPANION_EXERCISE_PROMPT=1
```

Set `PA_IOS_LIVE_COMPANION_EXERCISE_PROMPT=1` only when you want the live test to send a real model prompt and wait for a streamed assistant response.

## Bootstrap host env for simulator smoke tests

For local dev and validation, the app can seed a paired host from launch environment:

```text
PA_IOS_BOOTSTRAP_HOST_URL=http://127.0.0.1:3845
PA_IOS_BOOTSTRAP_BEARER_TOKEN=<paired device token>
PA_IOS_BOOTSTRAP_HOST_LABEL=Local Desktop Host
PA_IOS_BOOTSTRAP_HOST_INSTANCE_ID=host_...
PA_IOS_BOOTSTRAP_DEVICE_ID=device_...
PA_IOS_BOOTSTRAP_DEVICE_LABEL=iPhone Simulator
```

When these are present, the app inserts that host into local storage and stores the bearer token in Keychain so it is ready to pick from the host chooser.

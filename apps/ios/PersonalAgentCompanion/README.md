# Personal Agent iOS companion app

Native iOS companion client for the daemon-backed companion host API.

Location:

```text
apps/ios/PersonalAgentCompanion
```

## What it does

- pair to a companion host with manual pairing code entry or setup QR + bearer token
- persist paired hosts locally and keep the token in Keychain
- choose a host first, then work in a per-host Chat / Automations / Settings shell
- mirror host conversation ordering with pinned/open/archived sections and native pin/archive/duplicate controls
- open a conversation and stream transcript updates over the multiplexed companion socket
- send prompts with text, prompt images, and saved drawing attachment refs
- take over control, abort a turn, rename a conversation, change cwd, adjust model preferences, and switch execution target
- browse conversation artifacts and commit checkpoints
- browse saved drawing attachments, inspect revisions, and create/update attachment assets
- manage automations from the phone, with durable-run details still reachable from the companion surfaces
- manage paired devices and generate setup state for adding another device

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

For local UI smoke tests without a running host:

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
SIMCTL_CHILD_PA_IOS_MOCK_MODE=1 xcrun simctl launch booted com.personalagent.ios.companion
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

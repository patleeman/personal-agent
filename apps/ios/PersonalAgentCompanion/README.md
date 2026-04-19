# Personal Agent iOS companion app

Native iOS companion client for the daemon-backed companion host API.

Location:

```text
apps/ios/PersonalAgentCompanion
```

## What it does

- pair to a companion host with manual pairing code entry or setup QR + bearer token
- persist paired hosts locally and keep the token in Keychain
- mirror host conversation ordering with pinned/open sections
- open a conversation and stream transcript updates over the multiplexed companion socket
- send prompts with text, prompt images, and saved drawing attachment refs
- take over control, abort a turn, rename a conversation, and switch execution target
- browse saved drawing attachments, inspect revisions, and create/update attachment assets

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

## Real host notes

The live app expects the desktop runtime to be running on the target machine so the daemon companion server has an attached conversation runtime provider.

Typical local-dev path:

1. start the desktop runtime
2. in desktop Settings → Companion access, generate a setup QR
3. the desktop app will automatically enable local-network phone access if the companion server is still loopback-only
4. in the iOS app, open Pair host → Scan setup QR
5. or use manual host URL + pairing code entry if needed

## Live integration test

The test target includes a real-host round-trip that:

- pairs against a live companion host
- creates a conversation
- creates and downloads an attachment
- sends a real prompt over the companion socket
- waits for a live streamed assistant response

Enable it with a config file before `xcodebuild test`:

```json
{
  "enabled": true,
  "baseURL": "http://127.0.0.1:3845",
  "pairingCode": "XXXX-XXXX-XXXX",
  "cwd": "/absolute/path/to/repo"
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
```

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

When these are present, the app inserts that host into local storage, stores the bearer token in Keychain, and opens it automatically.

# Personal Agent iOS companion app

Native iOS companion client for the daemon-backed companion host API.

Location:

```text
apps/ios/PersonalAgentCompanion
```

## What it does

- pair to a companion host with pairing code + bearer token
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
2. generate a pairing code in Settings → Companion access
3. pair from the iOS app against the host URL

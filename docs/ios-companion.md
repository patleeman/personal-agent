# iOS Companion

The iOS Companion is a native iPhone app that pairs with the desktop daemon. It provides voice input, conversation browsing, and notifications on the go.

## Setup

1. Install the iOS Companion app on your iPhone (TestFlight or development build)
2. From the desktop app, open Settings → Companion → Show Pairing QR Code
3. Open the iOS app and tap "Scan QR Code"
4. Point the phone at the QR code displayed on the desktop
5. The phone connects to the daemon over the local network

The pairing is persistent — subsequent launches automatically reconnect.

## Features

### Voice Input

Tap the microphone button to dictate a prompt. Audio is sent to the daemon for transcription (using the same local Whisper model configured on the desktop).

### Conversation History

Browse recent conversations from your phone. View the transcript of any conversation. Continue conversations by adding new messages.

### Notifications

Receive push notifications for:

- Completed runs
- Fired reminders
- Automation callbacks
- Async attention alerts

Tap a notification to open the relevant conversation.

### Quick Prompts

Send a message to the agent from the iOS app without context switching to the desktop.

## Architecture

```
iOS App ──► Companion API (HTTP/WebSocket) ──► Daemon
                                                    │
                                              Desktop App
```

- The iOS app communicates with the daemon through the Companion API
- The daemon exposes an HTTP/WebSocket endpoint on the configured port
- Communication is over the local network (LAN, Tailnet, or VPN)
- Authentication is handled through the QR code pairing flow

## Development

The iOS project lives at `apps/ios/PersonalAgentCompanion` and is developed in Xcode with Swift.

When adding companion API calls, build query strings through `URLComponents`-backed endpoint helpers in `CompanionModels.swift`. Knowledge note and folder IDs can contain characters like `&`, so direct `.urlQueryAllowed` interpolation will corrupt requests.

### Prerequisites

- Xcode 16+
- iOS 17+ deployment target
- A configured development team for signing

### Running

```bash
npm run ios:dev
```

This script handles provisioning, building, and launching the app on a connected device or simulator. The dev companion host keeps daemon runtime files in an isolated `ios-dev-daemon` directory under `PA_IOS_DEV_STATE_ROOT` by default, so live iOS testing does not share the desktop app's `daemon/runtime.db`. Override `PA_IOS_DEV_DAEMON_ROOT` or `PA_IOS_DEV_DAEMON_SOCKET_PATH` only when you intentionally want a custom host daemon location.

## Companion API

The companion API is served by the daemon and can be exposed over LAN or Tailscale Serve:

- **Base URL**: `http(s)://<host>:<port>/companion/v1/`
- **Auth**: Bearer token obtained during QR/setup pairing
- **Socket**: `ws(s)://<host>:<port>/companion/v1/socket`

Core reads use HTTP (`/hello`, `/auth/pair`, `/conversations`, `/models`, `/knowledge/*`, `/tasks`, `/runs`). Live conversation control uses the single companion socket with commands such as `conversation.bootstrap`, `conversation.create`, `conversation.prompt`, and `conversation.resume`, plus `conversation` subscriptions for streaming transcript events.

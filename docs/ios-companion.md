# iOS Companion

The iOS companion app is the native phone client for a Personal Agent host.

It lives at:

```text
apps/ios/PersonalAgentCompanion/
```

Use the app README there for the detailed Xcode, simulator, mock-mode, and live-test commands. This doc exists to keep the top-level product docs aligned with the companion runtime model.

## Runtime model

- The daemon serves the companion HTTP/WebSocket API under `/companion/v1`.
- Default companion host is `127.0.0.1` and default port is `3843`.
- The iOS local-dev scripts run a dedicated local host on `127.0.0.1:3845`.
- Pairing creates a device token; the iOS app stores the token in Keychain.
- The desktop Settings page owns normal pairing, device revocation, and reachability checks.

## What the app can operate

The companion app can work with the same durable surfaces as desktop, through host APIs:

- conversations, archived threads, live transcript streaming, prompt sending, abort/takeover controls, and execution-target changes
- Knowledge files, folders, autosave, imports from the share extension, and vault image assets
- conversation attachments, drawings, artifacts, and checkpoints
- automations and durable-run detail surfaces
- paired devices and companion host settings

## Useful repo commands

```bash
npm run ios:demo
npm run ios:demo:running
npm run ios:demo:refresh
npm run ios:dev:prepare
npm run ios:dev
npm run ios:dev:host
npm run ios:dev:sim
npm run ios:dev:setup-url
npm run ios:test:live
```

## Related docs

- [Daemon](./daemon.md)
- [Desktop App](./desktop-app.md)
- [Configuration](./configuration.md)
- [`apps/ios/PersonalAgentCompanion/README.md`](../apps/ios/PersonalAgentCompanion/README.md)

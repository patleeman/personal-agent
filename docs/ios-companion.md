# iOS Companion

The iOS companion app is the native phone client for a Personal Agent host.

Source, setup, and workflows: [`apps/ios/PersonalAgentCompanion/README.md`](../apps/ios/PersonalAgentCompanion/README.md)

## Runtime model

- The daemon serves the companion HTTP/WebSocket API under `/companion/v1`.
- Default companion host is `127.0.0.1` and default port is `3843`.
- The iOS local-dev scripts run a dedicated local host on `127.0.0.1:3845`.
- Pairing creates a device token; the iOS app stores the token in Keychain.
- The desktop Settings page owns normal pairing, device revocation, and reachability checks.

## Related docs

- [Daemon](./daemon.md)
- [Desktop App](./desktop-app.md)
- [Configuration](./configuration.md)

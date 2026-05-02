# Contributing

Thanks for considering contributing. This is a small personal project, so keep expectations proportional.

## Setup

```bash
npm install
npm run build
```

The desktop app is macOS-only (ARM64). Start it with `npm run desktop:start`.

The iOS companion requires Xcode and an Apple Developer account to build for a device. The simulator is free.

## Dependencies

`personal-agent` depends on `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`, both published on the public npm registry. They install automatically with `npm install`.

## PRs

- One focused change per PR.
- Run `npm test` and `npm run lint` locally before opening.
- If the PR changes product behavior, update the relevant doc in `docs/` or `internal-skills/`.
- No need to ask before opening — just open it.

## Unsigned local builds

Electron-builder will try to sign the release build by default. For local development, `npm run desktop:start` and `npm run desktop:dev` skip signing. If you get signing errors, you can:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run desktop:start
```

## Need help?

Open an issue or discussion. I'll get to it when I can.

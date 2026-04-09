# Protected downloads via Cloudflare R2

`personal-agent` can ship installable binaries from a private Cloudflare R2 bucket behind a small token-gated Worker.

This is meant for light protection, not strong DRM. Anyone with the shared token can download the file, and a token embedded in a desktop app can always be extracted by a determined user.

## Current setup

The repo includes a Worker at `tools/cloudflare-download-gate/`.

It expects:

- a private R2 bucket named `personal-agent-downloads`
- a Worker secret named `DOWNLOAD_TOKEN`
- requests to use either:
  - `Authorization: Bearer <token>`
  - or `?token=<token>` for quick manual sharing

When authorized, the Worker streams the object from R2 and returns it as an attachment.

## Deploy the Worker

From the repo root:

```bash
npm run downloads:deploy
```

That deploys `personal-agent-download-gate` using `tools/cloudflare-download-gate/wrangler.toml`.

Set or rotate the download token with:

```bash
printf '%s' 'your-shared-download-token' | wrangler secret put DOWNLOAD_TOKEN --config tools/cloudflare-download-gate/wrangler.toml
```

## Upload files to the private bucket

Use the generic helper script when you want to upload arbitrary files. It writes to the remote R2 bucket, not Wrangler's local preview storage:

```bash
npm run downloads:upload -- --prefix releases/v0.1.3/ dist/release/Personal Agent-0.1.3-mac-arm64.dmg
```

For the packaged desktop release, prefer the purpose-built helper:

```bash
npm run downloads:upload:desktop-release
```

That command reads the current repo version, then uploads:

- `dist/release/latest-mac.yml`
- the matching macOS `.zip` and `.zip.blockmap`
- the matching macOS `.dmg`

It writes them to both:

- `releases/v<version>/` for archive/manual installs
- `updates/stable/` for the live in-app updater feed

## URL shape

After deployment, protected download URLs look like:

```text
https://<your-worker>.workers.dev/releases/v0.1.3/<artifact-name>.dmg
```

Use one of:

```bash
curl -H "Authorization: Bearer <token>" \
  "https://<your-worker>.workers.dev/releases/v0.1.3/<artifact-name>.dmg" \
  -o <artifact-name>.dmg
```

or for quick human sharing:

```text
https://<your-worker>.workers.dev/releases/v0.1.3/<artifact-name>.dmg?token=<token>
```

## Desktop auto-update

Packaged desktop builds now read a bundled `auto-update-config.json` resource that contains:

- the protected update feed base URL
- the shared bearer token used to fetch `latest-mac.yml` and the `.zip` update payload

The build helper `scripts/prepare-auto-update-config.mjs` writes that file before `npm run desktop:dist` or `npm run desktop:dist:dir`.

By default it reads the token from:

- `PERSONAL_AGENT_DOWNLOAD_TOKEN`, or
- `~/.config/personal-agent/personal-agent-download-token.txt`

If no token is available, the packaged app still builds, but in-app auto-update is disabled for that build.

## Suggested release flow

For a signed local macOS build:

1. run the local signed release build
2. run `npm run downloads:upload:desktop-release`
3. share the versioned protected Worker URL for manual installs
4. let packaged apps update themselves from `updates/stable/latest-mac.yml`

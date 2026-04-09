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

Use the helper script. It writes to the remote R2 bucket, not Wrangler's local preview storage:

```bash
npm run downloads:upload -- --prefix releases/v0.1.3/ dist/release/Personal.Agent-0.1.3-mac-arm64.dmg
```

You can upload multiple files in one command:

```bash
npm run downloads:upload -- --prefix releases/v0.1.3/ \
  dist/release/Personal.Agent-0.1.3-mac-arm64.dmg \
  dist/release/Personal.Agent-0.1.3-mac-arm64.zip
```

## URL shape

After deployment, protected download URLs look like:

```text
https://<your-worker>.workers.dev/releases/v0.1.3/Personal.Agent-0.1.3-mac-arm64.dmg
```

Use one of:

```bash
curl -H "Authorization: Bearer <token>" \
  https://<your-worker>.workers.dev/releases/v0.1.3/Personal.Agent-0.1.3-mac-arm64.dmg \
  -o Personal.Agent-0.1.3-mac-arm64.dmg
```

or for quick human sharing:

```text
https://<your-worker>.workers.dev/releases/v0.1.3/Personal.Agent-0.1.3-mac-arm64.dmg?token=<token>
```

## Suggested release flow

For a signed local macOS build:

1. run the local signed release build
2. upload the finished `.dmg` and optional `.zip` into `releases/v<version>/`
3. share the protected Worker URL instead of a public GitHub Release asset

If native app auto-update is added later, the same Worker can also protect `latest-mac.yml`, `.zip`, and `.blockmap` files.

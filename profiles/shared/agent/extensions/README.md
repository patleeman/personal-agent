# Pi Extensions

This directory is organized with one folder per extension.

Pi auto-discovers:
- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`

So each extension here uses `index.ts` as the entrypoint.

## Layout

```text
extensions/
├── package.json
├── README.md
├── context-bar.ts
└── web-tools/
    └── index.ts
```

## Notes

- `/reload` works with this structure.
- Keep extension entrypoints at exactly one level under `extensions/`.
- Shared dependencies are installed from `extensions/package.json`.

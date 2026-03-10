# Pi Extensions

This directory is organized with one focused entrypoint per extension.

Pi auto-discovers:
- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`

Top-level test files like `*.test.ts` and `*.spec.ts` are ignored.

So each extension here uses either a top-level `*.ts` entrypoint or an `index.ts` file one level down.

## Layout

```text
extensions/
├── at-autocomplete-performance/
│   └── index.ts
├── context-bar.ts
├── deferred-resume/
│   └── index.ts
├── exit-alias.ts
├── inbox-shell/
│   └── index.ts
├── memory/
│   └── index.ts
├── pa-header/
│   └── index.ts
├── tmux-manager/
│   └── index.ts
├── tmux-orchestration-prompt/
│   └── index.ts
├── web-tools/
│   └── index.ts
└── package.json
```

## Notes

- `/reload` works with this structure.
- Keep extension entrypoints at exactly one level under `extensions/`.
- Shared lightweight dependencies live in `extensions/package.json`.
- Heavier extension-specific dependencies should live beside that extension (for example `web-tools/package.json`).

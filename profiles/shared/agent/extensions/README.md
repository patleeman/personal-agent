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
├── todos/
│   └── index.ts
├── review/
│   └── index.ts
├── plan/
│   ├── index.ts
│   ├── README.md
│   ├── PLAN_EXTENSION.md
│   └── TESTING_PLAN.md
├── context-bar-footer/
│   └── index.ts
├── web-tools/
│   └── index.ts
├── custom-status-bar/
│   └── index.ts
└── memory/
    └── index.ts
```

## Notes

- `/reload` works with this structure.
- Keep extension entrypoints at exactly one level under `extensions/`.
- Shared dependencies are installed from `extensions/package.json`.

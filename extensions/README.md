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
├── _shared/
│   └── prompt-catalog.ts
├── web-tools/
│   └── index.ts
└── ...other built-in extension entrypoints
```

## Notes

- `/reload` works with this structure.
- Keep extension entrypoints at exactly one level under `extensions/`.
- Support files without `index.ts` can live in helper dirs like `_shared/`.
- Built-in extensions resolve shared runtime dependencies from the repo root `package.json` and top-level `node_modules`.
- Avoid adding nested extension package manifests unless an extension truly needs isolation from the main app dependency graph.
- If an extension does need isolated dependencies later, keep the package local to that extension directory and document why.
- `openai-native-compaction` is enabled by default for direct OpenAI Responses and ChatGPT/Codex responses models; set `PI_OPENAI_NATIVE_COMPACTION=0` to disable it or `PI_OPENAI_NATIVE_COMPACTION_NOTIFY=1` to surface Codex/OpenAI compaction UI notices.

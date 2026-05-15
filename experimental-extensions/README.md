# Personal Agent Experimental Extensions

This repo area is for rough Personal Agent extensions that should stay out of the bundled system extension set until they earn their keep.

Each folder under `extensions/` is a complete extension package. Build one with the root `build` script, then install it into a PA state root by copying the extension folder or using the `install` script.

```bash
pnpm run build -- --extension qwen-mlx
pnpm run install -- --extension qwen-mlx --target testing
```

Current experiments:

- `qwen-mlx` — general-purpose local Hugging Face MLX model setup, search, and server controls.
- `llama-cpp` — local GGUF model runner backed by bundled llama.cpp Metal binaries.
- `doom` — Doom inside PA. Because obviously.
- `system-codex` — Codex companion protocol server surface while the protocol is still baking.
- `system-session-exchange` — import/export flow for conversation session handoff experiments.
- `system-gateways` — Telegram gateway UI/runtime while gateway routing is still experimental.
- `system-images` — Image generation tooling while provider behavior and UX are still experimental.

Release builds package these under `Resources/experimental-extensions/extensions` and load them as experimental extensions, separate from bundled `extensions/system-*`.

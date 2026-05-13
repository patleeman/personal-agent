# Personal Agent Experimental Extensions

This repo area is for rough Personal Agent extensions that should stay out of the bundled system extension set until they earn their keep.

Each folder under `extensions/` is a complete extension package. Build one with the root `build` script, then install it into a PA state root by copying the extension folder or using the `install` script.

```bash
npm run build -- --extension qwen-mlx
npm run install -- --extension qwen-mlx --target testing
```

Current experiments:

- `qwen-mlx` — general-purpose local Hugging Face MLX model setup, search, and server controls.
- `doom` — Doom inside PA. Because obviously.
- `slack-mcp-gateway` — Slack channel to PA conversation gateway via Slack MCP.

These are intentionally not bundled from `extensions/system-*`.

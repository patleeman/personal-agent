# llama.cpp extension

Experimental PA extension for running local GGUF models through llama.cpp.

The extension bundles the llama.cpp runtime instead of installing compilers or Homebrew on user machines. Model files are downloaded or selected at runtime because GGUF files are large.

## Runtime layout

Packaged builds should include prebuilt, Metal-enabled macOS arm64 binaries here:

```text
bin/darwin-arm64/llama-cli
bin/darwin-arm64/llama-server
```

For local development, fetch the latest upstream macOS arm64 release binaries with:

```bash
npm run fetch:runtime
```

The backend checks the bundled runtime first. A custom binary path can be added later if we want a power-user escape hatch.

## Model cache

Hugging Face GGUF downloads are stored under:

```text
~/.cache/personal-agent/llama-cpp/models
```

The UI asks for an exact GGUF filename from the repo, then caches the file locally.

## Notes

- This is intentionally `defaultEnabled: false` while experimental.
- The first implementation shells out to `llama-cli` for one-shot prompts.
- `llama-server` should be the next step for persistent chat sessions and streaming.

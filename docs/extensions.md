# Extensions

Built-in extensions live under `packages/desktop/server/extensions/` and extend the Pi runtime with additional tools, capabilities, and system prompt injections.

Extensions are loaded as `ExtensionFactory` functions and passed directly to Pi at session creation. They are always active unless disabled through the extension API.

## Built-in extensions

### `web-tools`

Adds tools for web search and page fetching:

- `web_search` — search the web using Exa API or DuckDuckGo fallback
- `web_fetch` — fetch a URL and extract readable content as markdown

The Exa API key is resolved from `EXA_API_KEY` environment variable or from the auth store under the `exa` provider ID. Falls back to DuckDuckGo when Exa is unavailable.

### `knowledge-base`

Injects the knowledge system into every agent session. Responsible for loading instruction files from `<vault-root>`, discovering skills from configured skill directories, and composing the system prompt from the active profile's instruction files, profile templates, and skill wrappers.

Without this extension, the agent would not have access to the durable knowledge model (vault, skills, projects, instructions).

### `openai-native-compaction`

Enables native compaction for OpenAI Responses API and ChatGPT/Codex responses API models. Compaction uses the AI provider's native summarization endpoint to compress conversation history instead of running a compaction agent turn.

- Enabled by default for models using `openai-responses` or `openai-completions` API on OpenAI/ChatGPT providers
- Disable with `PI_OPENAI_NATIVE_COMPACTION=0`
- Surface compaction UI notices with `PI_OPENAI_NATIVE_COMPACTION_NOTIFY=1`

### `daemon-run-orchestration-prompt`

Injects the current date into the system prompt for daemon-backed background runs. This ensures scheduled tasks and automations have correct temporal context even when running unattended.

### `gpt-apply-patch`

Adds an `apply_patch` tool for applying structured patches to files. Used by the agent to apply targeted code changes. Integrates with the model's active tool set — tool visibility is synchronized based on the current model provider.

## How extensions affect agent behavior

Extensions can:

- Register new agent tools (e.g. `web_search`, `apply_patch`)
- Inject content into the system prompt (e.g. knowledge base content, current date)
- Hook into agent lifecycle events (e.g. `before_agent_start`)
- Modify active tool selection based on the model provider
- Access the auth store and model registry

## Extension authoring

The extension API is provided by `@mariozechner/pi-coding-agent`. Create an `ExtensionFactory` function `(pi: ExtensionAPI) => void` and add it to `buildLiveSessionExtensionFactories()` in `packages/desktop/server/app/profileState.ts`.

## Related docs

- [Repo Layout](./repo-layout.md)
- [Knowledge System](./knowledge-system.md)
- [Configuration](./configuration.md)

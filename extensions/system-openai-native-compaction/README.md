# OpenAI Native Compaction Extension

This backend-only extension owns OpenAI/Codex native Responses compaction behavior.

## What it contributes

- A pi agent extension factory declared as `backend.agentExtension` in `extension.json`.
- Provider/request lifecycle hooks that use OpenAI-native compaction when the active model and runtime support it.

## Runtime behavior

The extension has no frontend surface. When enabled, the host discovers its backend agent factory from the manifest and adds it to live session startup generically. Keep compaction-specific provider hook code here instead of importing this behavior directly from core runtime files.

## Testing

Compaction behavior is covered by `src/backend.test.ts`. Update those tests when changing model/provider detection or compaction hook behavior.

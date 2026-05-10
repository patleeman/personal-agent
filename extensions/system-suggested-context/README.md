# Suggested Context

Suggests related past conversations as pointer-only context before a new prompt starts.

This system extension owns the new-conversation panel UI for suggested context. Core still owns the generic conversation ranking and prompt-injection plumbing: selected related conversation IDs are sent with the prompt, then the live-session server converts them into `related_conversation_pointers` hidden context only while seeding an empty conversation.

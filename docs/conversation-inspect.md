# Conversation Inspect

The `conversation_inspect` tool gives the agent read-only access to other conversation transcripts. It can list, search, query, outline, and diff conversations without modifying any state.

## Actions

### list

List conversations with optional filters:

| Parameter        | Type                                         | Description                                       |
| ---------------- | -------------------------------------------- | ------------------------------------------------- |
| `scope`          | `"all"`, `"live"`, `"running"`, `"archived"` | Filter by conversation state                      |
| `cwd`            | string                                       | Filter by working directory                       |
| `query`          | string                                       | Filter by metadata text                           |
| `includeCurrent` | boolean                                      | Include the calling conversation (default: false) |

### search

Search transcript text across conversations:

| Parameter    | Type                                  | Description               |
| ------------ | ------------------------------------- | ------------------------- |
| `query`      | string                                | Text to search for        |
| `scope`      | string                                | Conversation scope filter |
| `cwd`        | string                                | Working directory filter  |
| `searchMode` | `"phrase"`, `"allTerms"`, `"anyTerm"` | How to match the query    |

### query

Query specific blocks within a single conversation:

| Parameter        | Type              | Description            |
| ---------------- | ----------------- | ---------------------- |
| `conversationId` | string            | Target conversation    |
| `types`          | string[]          | Block types to include |
| `roles`          | string[]          | Roles to include       |
| `tools`          | string[]          | Tool names to filter   |
| `text`           | string            | Text content filter    |
| `afterBlockId`   | string            | Start after this block |
| `beforeBlockId`  | string            | End before this block  |
| `order`          | `"asc"`, `"desc"` | Sort order             |
| `limit`          | number            | Max blocks to return   |

### outline

Get an outline of a conversation with anchors for navigation:

| Parameter        | Type   | Description         |
| ---------------- | ------ | ------------------- |
| `conversationId` | string | Target conversation |

Returns anchor points including the first user prompt, recent prompts, and key structural markers.

### diff

Compare two snapshots of a conversation to find what changed between calls.

### read_window

Read a context window around a specific block:

| Parameter        | Type   | Description                    |
| ---------------- | ------ | ------------------------------ |
| `conversationId` | string | Target conversation            |
| `aroundBlockId`  | string | Center block ID                |
| `window`         | number | Context lines before and after |

## Block Types

Blocks are structural units in a conversation transcript:

| Type       | Content                          |
| ---------- | -------------------------------- |
| `user`     | User messages                    |
| `text`     | Assistant text responses         |
| `tool_use` | Tool calls made by the assistant |
| `image`    | Image attachments                |
| `error`    | Tool execution errors            |
| `context`  | Context injections               |
| `summary`  | Conversation summaries           |

Roles: `user`, `assistant`, `tool`, `context`, `summary`, `image`, `error`.

## Search Modes

| Mode       | Behavior                                               |
| ---------- | ------------------------------------------------------ |
| `phrase`   | Match the exact phrase (default)                       |
| `allTerms` | Match blocks containing all whitespace-separated terms |
| `anyTerm`  | Match blocks containing any whitespace-separated term  |

## Read-Only Guarantee

The inspect tool cannot create, modify, or delete conversation state. It is strictly for reading transcripts, tool calls, results, and metadata across threads. No conversation state is altered.

## Use Cases

- The agent checks a related conversation for context before answering
- The agent searches past conversations for similar problems
- The agent reviews tool output from another thread
- The agent finds a specific piece of information across all conversations

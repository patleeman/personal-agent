# Conversation Tools Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/ask-user-question.md -->

# Ask User Question

The `ask_user_question` tool presents interactive prompts to the user through the desktop UI. It supports single questions with quick-reply options and multi-question forms with radio and checkbox styles.

## Question Styles

| Style                | Behavior                                          | Output                   |
| -------------------- | ------------------------------------------------- | ------------------------ |
| `radio`              | Single choice from options                        | One selected value       |
| `check` / `checkbox` | Multiple choice                                   | Array of selected values |
| Legacy text          | Single question with optional quick-reply buttons | Text + selected option   |

## Parameters

| Parameter   | Type     | Description                           |
| ----------- | -------- | ------------------------------------- |
| `question`  | string   | Legacy single-question text           |
| `details`   | string   | Context or description                |
| `options`   | string[] | Legacy quick-reply options (max 6)    |
| `questions` | object[] | Multi-question mode (max 8 questions) |

### Question object

When using `questions[]`, each question has:

| Field      | Type                               | Description                            |
| ---------- | ---------------------------------- | -------------------------------------- |
| `id`       | string                             | Stable identifier for tracking answers |
| `label`    | string                             | User-facing question                   |
| `question` | string                             | Alias for `label`                      |
| `details`  | string                             | Supporting context                     |
| `style`    | `"radio"`, `"check"`, `"checkbox"` | Input style                            |
| `options`  | array                              | Available answers (max 12)             |

### Option object

Options can be simple strings or objects:

```typescript
// Simple string
"red"

// Object with details
{
  "value": "red",
  "label": "Red Theme",
  "details": "Warm color scheme with high contrast"
}
```

## Examples

### Single question with quick replies

```json
{
  "question": "What color scheme?",
  "details": "Choose the theme color for the new dashboard",
  "options": ["red", "green", "blue"]
}
```

### Radio question

```json
{
  "questions": [
    {
      "id": "theme",
      "label": "Theme color",
      "style": "radio",
      "options": [
        { "value": "light", "label": "Light", "details": "Light background" },
        { "value": "dark", "label": "Dark", "details": "Dark background" }
      ]
    }
  ]
}
```

### Multi-question form

```json
{
  "questions": [
    {
      "id": "layout",
      "label": "Layout style",
      "style": "radio",
      "options": ["compact", "comfortable"]
    },
    {
      "id": "features",
      "label": "Enable features",
      "style": "check",
      "options": [
        { "value": "search", "label": "Web Search" },
        { "value": "images", "label": "Image Generation" },
        { "value": "browser", "label": "Browser" }
      ]
    }
  ],
  "details": "Configure your workspace preferences"
}
```

## Limits

| Limit                     | Value |
| ------------------------- | ----- |
| Max questions per call    | 8     |
| Max options per question  | 12    |
| Max options (legacy mode) | 6     |

## Desktop UI Rendering

In the desktop app, questions render as a modal dialog:

- **Radio** — radio buttons with one selection
- **Check/checkbox** — checkboxes with multiple selection
- **Legacy** — prompt text with optional quick-reply buttons below

The user must respond before the agent continues. The response is returned to the agent as structured data.

---

<!-- Source: docs/change-working-directory.md -->

# Change Working Directory

The `change_working_directory` tool switches the conversation's working directory. After the change, all tool calls (file reads, shell commands, file writes) execute relative to the new directory.

## Parameters

| Parameter        | Type   | Required | Description                                                   |
| ---------------- | ------ | -------- | ------------------------------------------------------------- |
| `cwd`            | string | yes      | Target directory. Relative paths resolve from the current cwd |
| `continuePrompt` | string | no       | Prompt to execute automatically after the directory switch    |

## Behavior

1. The tool validates that the target directory exists
2. If valid, the conversation's cwd is updated
3. All subsequent tool calls use the new cwd as their working directory
4. If `continuePrompt` is provided, that prompt is queued as a follow-up

```json
// Change to a subdirectory
{ "cwd": "packages/core/src" }

// Change to an absolute path and continue working
{ "cwd": "/Users/me/other-project", "continuePrompt": "Review the README" }
```

## Scope

- The change affects only the calling conversation
- Other conversations retain their own working directories
- The change persists for the lifetime of the conversation
- If `continuePrompt` is provided, it runs in the new directory automatically

## Validation

| Condition                          | Result                        |
| ---------------------------------- | ----------------------------- |
| Target directory exists            | Cwd is updated                |
| Target directory does not exist    | Error returned, cwd unchanged |
| Target is a file (not a directory) | Error returned                |
| Relative path with no current cwd  | Error returned                |

## Use Cases

- **Deep navigation** — move from project root to `packages/core/src` for focused work
- **Multi-project sessions** — switch between projects without starting a new conversation
- **Build operations** — change to a subdirectory to run build commands
- **File operations** — navigate to the directory containing the files being edited

## Compared to @ references

|          | `change_working_directory`              | `@` file reference          |
| -------- | --------------------------------------- | --------------------------- |
| Scope    | All subsequent tool calls               | Single message              |
| Cwd      | Permanently changed                     | Unchanged                   |
| Use case | Working in a different part of the tree | Referencing a specific file |

---

<!-- Source: docs/conversation-inspect.md -->

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

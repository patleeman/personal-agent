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

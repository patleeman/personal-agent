# Images Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/image-generation.md -->

# Image Generation

The agent can generate and edit images using the `image` tool. Images are rendered inline in the conversation and can be used as source material for further editing.

## Actions

| Action     | Description                                  |
| ---------- | -------------------------------------------- |
| `generate` | Create a new image from a text prompt        |
| `edit`     | Modify an existing image using source images |

## Parameters

| Parameter     | Type   | Default  | Description                                                              |
| ------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `prompt`      | string | required | Description of the image to generate                                     |
| `size`        | string | `"auto"` | Output dimensions: `"auto"`, `"1024x1024"`, `"1024x1536"`, `"1536x1024"` |
| `quality`     | string | `"auto"` | Quality: `"auto"`, `"low"`, `"medium"`, `"high"`                         |
| `background`  | string | `"auto"` | Background: `"auto"`, `"opaque"`, `"transparent"`                        |
| `source`      | string | `"none"` | Source images for editing                                                |
| `sourceCount` | number | —        | Max reference images (1-4)                                               |

## Source Images

When editing, the agent can reference recent images from the conversation:

| Source value         | What it includes                                     |
| -------------------- | ---------------------------------------------------- |
| `"none"`             | No source images                                     |
| `"latest"`           | The most recent image in the conversation            |
| `"latest-user"`      | The most recent user-provided image                  |
| `"latest-generated"` | The most recently generated image                    |
| `"recent"`           | Multiple recent images (controlled by `sourceCount`) |

## Examples

### Generate a new image

```json
{
  "action": "generate",
  "prompt": "A futuristic cityscape with flying cars and neon lights",
  "size": "1024x1024",
  "quality": "high"
}
```

### Edit an existing image

```json
{
  "action": "edit",
  "prompt": "Add a giant moon in the sky",
  "source": "latest-generated"
}
```

### Generate with multiple references

```json
{
  "action": "generate",
  "prompt": "Combine the style of image 1 with the subject of image 2",
  "source": "recent",
  "sourceCount": 2
}
```

## Provider Dependence

Image generation uses the configured model provider. The tool selects the appropriate model endpoint based on the provider:

- **OpenAI** — uses DALL-E or GPT-4o image generation
- **Anthropic** — uses Claude's image generation capabilities
- **Other providers** — may not support image generation

If the current provider does not support image generation, the tool returns an error.

## Output

Generated images appear as content in the conversation transcript. They can be referenced by subsequent image tool calls using `source: "latest-generated"`.

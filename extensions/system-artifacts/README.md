# Artifacts Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/artifacts.md -->

# Artifacts

Artifacts are rendered outputs visible inside a conversation. They support HTML, Mermaid diagrams, and LaTeX. Saving one inserts a transcript card you can open, and artifacts also appear in the workbench rail beside the conversation.

## Supported Types

| Type      | Description                           | Use Cases                                            |
| --------- | ------------------------------------- | ---------------------------------------------------- |
| `html`    | Self-contained rendered web content   | Interactive prototypes, styled documents, dashboards |
| `mermaid` | Diagrams rendered from Mermaid source | Flowcharts, sequence diagrams, architecture diagrams |
| `latex`   | Typeset mathematics and documents     | Formulas, scientific papers, technical docs          |

## Creating an Artifact

Use the `artifact` tool from a conversation:

```json
{
  "action": "save",
  "kind": "mermaid",
  "title": "Architecture Overview",
  "content": "graph TD\n    A[Client] --> B[Server]\n    B --> C[Database]",
  "open": true
}
```

Parameters:

| Parameter    | Type                             | Description                                                    |
| ------------ | -------------------------------- | -------------------------------------------------------------- |
| `artifactId` | string (optional)                | Stable ID for updates. Omit to generate a new one              |
| `kind`       | `"html"`, `"mermaid"`, `"latex"` | Artifact type                                                  |
| `title`      | string                           | Display title                                                  |
| `content`    | string                           | Source content                                                 |
| `open`       | boolean                          | Whether the artifact panel opens automatically (default: true) |

## Viewing Artifacts

Artifacts appear in the Artifacts tab of the workbench rail. The right sidebar entry for that tab is provided by this extension. Each artifact is rendered inline:

- **HTML** — rendered as a web page in a sandboxed iframe
- **Mermaid** — rendered as an SVG diagram
- **LaTeX** — rendered as typeset output

Multiple artifacts in a conversation are listed and selectable. Click an artifact to view it.

## Updating Artifacts

Reuse the same `artifactId` to update an existing artifact:

```json
{
  "action": "save",
  "artifactId": "arch-v1",
  "kind": "mermaid",
  "title": "Architecture Overview (updated)",
  "content": "graph TD\n    A[Client] --> B[Server]\n    B --> C[Database]\n    C --> D[Cache]"
}
```

The artifact panel refreshes to show the updated content.

## Deleting Artifacts

```json
{
  "action": "delete",
  "artifactId": "arch-v1"
}
```

## Listing Artifacts

```json
{
  "action": "list"
}
```

Returns all artifacts in the current conversation with their metadata.

## Use Cases

- **Architecture diagrams** — agent generates a Mermaid diagram of the system
- **Prototypes** — agent generates HTML for a UI mockup
- **Math explanations** — agent renders LaTeX formulas inline
- **Report generation** — agent creates formatted HTML documents
- **Iterative design** — agent updates the same artifact as the design evolves

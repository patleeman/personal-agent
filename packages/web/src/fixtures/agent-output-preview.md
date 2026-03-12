# Agent output markdown preview

This fixture exercises the kinds of markdown an agent might return in chat.
It includes **bold**, *italic*, ~~strikethrough~~, `inline code`, a [normal link](https://example.com), a bare URL https://www.datadoghq.com/, and project mentions like @web-ui and @markdown-preview.

## Lists

- Top-level bullet
- Nested content
  - Child bullet with `inline code`
  - Child bullet with a [link](https://docs.datadoghq.com/)
    1. Nested numbered item
    2. Another numbered item mentioning @projects
- Final bullet

1. First ordered item
2. Second ordered item
   - Mixed nested bullet
   - Another mixed bullet
3. Third ordered item

## Task list

- [x] Load the markdown fixture
- [x] Render block and inline markdown
- [ ] Verify edge cases manually after each UI change

## Quotes

> Agents often reply with quoted notes, callouts, or copied snippets.
>
> - Quoted bullet one
> - Quoted bullet two
>
> Keep spacing readable and nesting intact.

## Code blocks

```bash
pa ui --open
npm test -- --runInBand
```

```json
{
  "project": "personal-agent",
  "focus": "markdown rendering",
  "status": "in-progress",
  "checks": ["lists", "tables", "code", "mentions"]
}
```

```diff
- Old renderer handled a markdown-like subset.
+ New renderer handles richer markdown output directly.
```

## Table

| Surface | Example | Expected |
| :-- | :-- | --: |
| Heading | `## Section` | 1 |
| Code | Fenced block | 2 |
| Mention | `@web-ui` | 3 |
| Table | GFM table | 4 |

## Heading ladder

### Heading level 3

Paragraph under heading three.

#### Heading level 4

Paragraph under heading four.

##### Heading level 5

Paragraph under heading five.

###### Heading level 6

Paragraph under heading six.

---

## Escaping and unicode

Use escaped punctuation like \*literal asterisks\* and \`literal backticks\`.

Unicode should remain intact: café, naïve, 東京, ✅, and → arrows.

## Footnote

This sentence has a footnote reference.[^preview-note]

[^preview-note]: Footnotes help exercise smaller markdown affordances too.

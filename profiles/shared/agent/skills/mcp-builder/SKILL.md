---
name: mcp-builder
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).
---

# MCP Server Development Guide

Create MCP servers that enable LLMs to interact with external services through well-designed tools.

## Process Overview

### Phase 1: Research and Planning

**1.1 Understand Modern MCP Design**
- Balance API coverage with workflow tools
- Use clear, descriptive tool names with service prefixes (`github_create_issue`)
- Design for concise, focused data returns
- Provide actionable error messages

**1.2 Study MCP Protocol**
- Sitemap: `https://modelcontextprotocol.io/sitemap.xml`
- Fetch pages with `.md` suffix for markdown

**1.3 Study Framework Docs**
- **Recommended**: TypeScript with streamable HTTP (remote) or stdio (local)
- TypeScript SDK: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python SDK: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`

**1.4 Plan Implementation**
- Review target API documentation
- List endpoints to implement, prioritize common operations

---

### Phase 2: Implementation

**2.1 Project Structure**

TypeScript:
```
{service}-mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── tools/
│   ├── services/
│   └── schemas/
└── dist/
```

Python:
```
{service}_mcp/
├── __init__.py
├── server.py
├── tools/
├── services/
└── models/
```

**2.2 Core Infrastructure**
- API client with auth
- Error handling helpers
- Response formatting (JSON/Markdown)
- Pagination support

**2.3 Implement Tools**

Each tool needs:
- **Input Schema**: Zod (TS) or Pydantic (Python) with constraints
- **Output Schema**: Define structured output where possible
- **Description**: Concise summary, parameters, return schema
- **Annotations**: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`

---

### Phase 3: Review and Test

- No duplicated code
- Consistent error handling
- Full type coverage
- Clear tool descriptions

**Build/Test:**
- TypeScript: `npm run build`, test with MCP Inspector
- Python: `python -m py_compile server.py`, test with MCP Inspector

---

### Phase 4: Create Evaluations

Create 10 evaluation questions that are:
- Independent (not dependent on other questions)
- Read-only (non-destructive operations)
- Complex (multiple tool calls required)
- Realistic (real use cases)
- Verifiable (single clear answer)
- Stable (answer won't change)

Output format:
```xml
<evaluation>
  <qa_pair>
    <question>...</question>
    <answer>...</answer>
  </qa_pair>
</evaluation>
```

---

## Reference Files

Load as needed during development:

- [MCP Best Practices](./references/mcp_best_practices.md) - Naming, responses, pagination, security
- [TypeScript Guide](./references/node_mcp_server.md) - TS patterns, Zod schemas, examples
- [Python Guide](./references/python_mcp_server.md) - FastMCP, Pydantic, examples
- [Evaluation Guide](./references/evaluation.md) - Creating evaluation questions

## Quick Reference

### Tool Naming
- `{service}_{action}_{resource}` (snake_case)
- Examples: `slack_send_message`, `github_create_issue`

### Server Naming
- TypeScript: `{service}-mcp-server`
- Python: `{service}_mcp`

### Response Formats
- Markdown: Human-readable, headers, lists
- JSON: Complete structured data

### Pagination
Return: `total`, `count`, `offset`, `has_more`, `next_offset`

### Transport
- **Streamable HTTP**: Remote servers, multi-client
- **stdio**: Local tools, CLI integration

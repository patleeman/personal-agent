# TypeScript MCP Server Guide

## Quick Start

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "service-mcp-server",
  version: "1.0.0"
});

// Register tool
server.registerTool(
  "service_action",
  {
    title: "Action Title",
    description: "What it does",
    inputSchema: z.object({
      param: z.string().describe("Parameter description")
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async ({ param }) => {
    const result = await doSomething(param);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result
    };
  }
);

// Run
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Project Structure

```
{service}-mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Entry point
│   ├── types.ts          # Type definitions
│   ├── tools/            # Tool implementations
│   ├── services/         # API clients
│   ├── schemas/          # Zod schemas
│   └── constants.ts      # API_URL, CHARACTER_LIMIT
└── dist/
```

## Zod Schemas

```typescript
const SearchSchema = z.object({
  query: z.string()
    .min(2, "Query must be at least 2 characters")
    .max(200)
    .describe("Search string"),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Max results"),
  offset: z.number()
    .int()
    .min(0)
    .default(0)
    .describe("Pagination offset"),
  response_format: z.enum(["markdown", "json"])
    .default("markdown")
    .describe("Output format")
}).strict();

type SearchInput = z.infer<typeof SearchSchema>;
```

## Error Handling

```typescript
function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    switch (error.response?.status) {
      case 404: return "Error: Resource not found.";
      case 403: return "Error: Permission denied.";
      case 429: return "Error: Rate limit exceeded.";
      default: return `Error: API failed with status ${error.response?.status}`;
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
```

## Shared API Client

```typescript
async function makeApiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  data?: any,
  params?: any
): Promise<T> {
  const response = await axios({
    method,
    url: `${API_BASE_URL}/${endpoint}`,
    data,
    params,
    timeout: 30000,
    headers: { "Content-Type": "application/json" }
  });
  return response.data;
}
```

## HTTP Transport (Remote)

```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000);
```

## package.json

```json
{
  "name": "{service}-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js",
    "build": "tsc",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "axios": "^1.7.9",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Quality Checklist

- [ ] All tools use `registerTool` with `title`, `description`, `inputSchema`, `annotations`
- [ ] Zod schemas have constraints and `.strict()`
- [ ] No `any` types - use `unknown` or proper types
- [ ] Async functions have `Promise<T>` return types
- [ ] Common functionality extracted to shared functions
- [ ] `npm run build` succeeds
- [ ] Pagination implemented where needed
- [ ] CHARACTER_LIMIT enforced on large responses

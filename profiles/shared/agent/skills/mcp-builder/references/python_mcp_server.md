# Python MCP Server Guide

## Quick Start

```python
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional

mcp = FastMCP("service_mcp")

class SearchInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')

    query: str = Field(..., description="Search string", min_length=2, max_length=200)
    limit: Optional[int] = Field(default=20, ge=1, le=100)

@mcp.tool(
    name="service_search",
    annotations={
        "title": "Search Service",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False
    }
)
async def service_search(params: SearchInput) -> str:
    '''Search for items in the service.

    Args:
        params: Search parameters

    Returns:
        JSON string with results
    '''
    results = await search_api(params.query, params.limit)
    return json.dumps(results, indent=2)

if __name__ == "__main__":
    mcp.run()
```

## Pydantic Models

```python
from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional, List
from enum import Enum

class ResponseFormat(str, Enum):
    MARKDOWN = "markdown"
    JSON = "json"

class UserSearchInput(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra='forbid'
    )

    query: str = Field(...,
        description="Search string",
        min_length=2,
        max_length=200)
    limit: Optional[int] = Field(
        default=20,
        description="Max results",
        ge=1, le=100)
    offset: Optional[int] = Field(
        default=0,
        description="Pagination offset",
        ge=0)
    response_format: ResponseFormat = Field(
        default=ResponseFormat.MARKDOWN,
        description="Output format")

    @field_validator('query')
    @classmethod
    def validate_query(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Query cannot be empty")
        return v.strip()
```

## Error Handling

```python
import httpx

def handle_api_error(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        if status == 404:
            return "Error: Resource not found."
        elif status == 403:
            return "Error: Permission denied."
        elif status == 429:
            return "Error: Rate limit exceeded."
        return f"Error: API failed with status {status}"
    elif isinstance(e, httpx.TimeoutException):
        return "Error: Request timed out."
    return f"Error: {type(e).__name__}"
```

## Shared API Client

```python
import httpx

API_BASE_URL = "https://api.example.com/v1"

async def make_api_request(
    endpoint: str,
    method: str = "GET",
    **kwargs
) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.request(
            method,
            f"{API_BASE_URL}/{endpoint}",
            timeout=30.0,
            **kwargs
        )
        response.raise_for_status()
        return response.json()
```

## Context Injection

```python
from mcp.server.fastmcp import FastMCP, Context

@mcp.tool()
async def long_operation(query: str, ctx: Context) -> str:
    '''Tool with progress reporting.'''

    await ctx.report_progress(0.25, "Starting...")
    await ctx.log_info("Processing", {"query": query})

    results = await process(query)

    await ctx.report_progress(0.75, "Formatting...")
    return format_results(results)
```

## Resources

```python
@mcp.resource("file://documents/{name}")
async def get_document(name: str) -> str:
    '''Expose documents as MCP resources.'''
    with open(f"./docs/{name}") as f:
        return f.read()
```

## HTTP Transport

```python
if __name__ == "__main__":
    # stdio (default, local)
    mcp.run()

    # HTTP (remote)
    mcp.run(transport="streamable_http", port=8000)
```

## Docstring Format

```python
async def search_users(params: UserSearchInput) -> str:
    '''Search for users by name or email.

    Args:
        params (UserSearchInput): Search parameters
            - query (str): Search string
            - limit (int): Max results (1-100, default 20)
            - offset (int): Pagination offset (default 0)

    Returns:
        str: JSON with schema:
        {
            "total": int,
            "count": int,
            "offset": int,
            "users": [{"id": str, "name": str, "email": str}],
            "has_more": bool,
            "next_offset": int | null
        }

    Examples:
        - "Find marketing team" -> query="team:marketing"
        - "Search for John" -> query="john"

    Errors:
        - "Error: Rate limit exceeded" (429)
        - "No users found matching '<query>'"
    '''
```

## Quality Checklist

- [ ] All tools have `name` and `annotations` in decorator
- [ ] Pydantic models with `Field()` definitions and constraints
- [ ] Comprehensive docstrings with input/output schemas
- [ ] All async functions use `async def`
- [ ] HTTP calls use `async with httpx.AsyncClient()`
- [ ] Type hints throughout
- [ ] Common functionality in shared functions
- [ ] Pagination with `total`, `has_more`, `next_offset`
- [ ] `python server.py` runs successfully

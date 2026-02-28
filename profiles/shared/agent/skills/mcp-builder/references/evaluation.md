# MCP Evaluation Guide

## Purpose

The quality of an MCP server is measured by how well it enables LLMs to answer realistic, difficult questions—not by API coverage alone.

## Question Requirements

Create 10 questions that are:

| Requirement | Description |
|-------------|-------------|
| **Independent** | Not dependent on other questions |
| **Read-only** | Only non-destructive operations |
| **Complex** | Requires multiple tool calls |
| **Realistic** | Real use cases humans care about |
| **Verifiable** | Single clear answer, string comparison |
| **Stable** | Answer won't change over time |

## Bad Question Examples

Avoid questions with dynamic answers:
- "How many reactions on the latest post?" (changes)
- "Who is currently online?" (changes)
- "What's the most recent message?" (changes)

## Good Question Examples

```xml
<qa_pair>
  <question>Find the channel where the 2024 Q3 budget was discussed. What emoji reaction appears most frequently on messages in that thread?</question>
  <answer>:thumbsup:</answer>
</qa_pair>

<qa_pair>
  <question>In the engineering team's shared drive, find the document about API rate limiting. What is the maximum requests per minute mentioned?</question>
  <answer>1000</answer>
</qa_pair>
```

## Answer Types

Acceptable:
- Usernames, channel names
- Timestamps (specific format)
- File extensions
- Numerical quantities
- Boolean values
- Short strings

Avoid:
- Opaque IDs (unless necessary)
- Long text blocks
- Dynamically changing values

## Creation Process

1. **Inspect tools** - List all available tools
2. **Explore content** - Use READ-ONLY operations to discover data
3. **Generate questions** - Create complex, realistic scenarios
4. **Verify answers** - Solve each question yourself
5. **Test stability** - Ensure answers don't change

## Output Format

```xml
<evaluation>
  <qa_pair>
    <question>Complex question requiring multiple tool calls...</question>
    <answer>specific_answer</answer>
  </qa_pair>
  <qa_pair>
    <question>Another complex question...</question>
    <answer>another_answer</answer>
  </qa_pair>
  <!-- 10 total qa_pairs -->
</evaluation>
```

## Running Evaluations

```bash
python evaluate.py \
  --server ./server.py \
  --transport stdio \
  --eval questions.xml
```

Supports: stdio, SSE, HTTP transports.

Output includes:
- Accuracy percentage
- Per-question pass/fail
- Tool calls made
- Time taken

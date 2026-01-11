# Trace Diff Report

Generated: 2026-01-11T03:16:42.117Z

- **Baseline:** /Users/neiltripathi/Documents/Frontier Tower Hackathon/openai-agent-test/traces/baseline-trace.json
- **Current:** /Users/neiltripathi/Documents/Frontier Tower Hackathon/openai-agent-test/traces/chaos-trace.json

## Summary

| Metric | Value |
|--------|-------|
| Baseline calls | 18 |
| Current calls | 7 |
| Added calls | 0 |
| Removed calls | 11 |
| Changed calls | 3 |
| Latency regressions | 3 |

**Status:** Changes detected - review below.

## Removed Calls

These calls appear in baseline but not in current:

| Method | Parameters |
|--------|------------|
| initialize | `{"protocolVersion":"2025-11-25","capabilities":...` |
| initialize | `{"protocolVersion":"2025-11-25","capabilities":...` |
| initialize | `{"protocolVersion":"2025-11-25","capabilities":...` |
| initialize | `{"protocolVersion":"2025-11-25","capabilities":...` |
| tools/list | `undefined` |
| tools/list | `undefined` |
| tools/list | `undefined` |
| tools/list | `undefined` |
| tools/list | `undefined` |
| tools/call | `{"name":"write_file","arguments":{"path":"/priv...` |
| tools/call | `{"name":"read_text_file","arguments":{"path":"/...` |

## Changed Calls

These calls have different parameters or results:

### tools/call (call #1)

**Parameters changed:**

Baseline:
```json
{
  "name": "list_directory",
  "arguments": {
    "path": "/tmp/mcp-chaos-test"
  }
}
```

Current:
```json
{
  "name": "list_directory",
  "arguments": {
    "path": "/private/tmp/mcp-chaos-test"
  }
}
```

**Result changed:**

Baseline:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Access denied - path outside allowed directories: /tmp/mcp-chaos-test not in /private/tmp/mcp-chaos-test"
    }
  ],
  "isError": true
}
```

Current:
```json
{
  "content": [
    {
      "type": "text",
      "text": ""
    }
  ],
  "structuredContent": {
    "content": ""
  }
}
```

### tools/call (call #2)

**Parameters changed:**

Baseline:
```json
{
  "name": "write_file",
  "arguments": {
    "path": "/tmp/mcp-chaos-test/hello.txt",
    "content": "Hello from OpenAI agent!"
  }
}
```

Current:
```json
{
  "name": "write_file",
  "arguments": {
    "path": "/private/tmp/mcp-chaos-test/hello.txt",
    "content": "Hello from OpenAI agent!"
  }
}
```

**Result changed:**

Baseline:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Access denied - path outside allowed directories: /tmp/mcp-chaos-test/hello.txt not in /private/tmp/mcp-chaos-test"
    }
  ],
  "isError": true
}
```

Current:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Successfully wrote to /private/tmp/mcp-chaos-test/hello.txt"
    }
  ],
  "structuredContent": {
    "content": "Successfully wrote to /private/tmp/mcp-chaos-test/hello.txt"
  }
}
```

### tools/call (call #3)

**Parameters changed:**

Baseline:
```json
{
  "name": "list_directory",
  "arguments": {
    "path": "/private/tmp/mcp-chaos-test"
  }
}
```

Current:
```json
{
  "name": "read_text_file",
  "arguments": {
    "path": "/private/tmp/mcp-chaos-test/hello.txt"
  }
}
```

**Result changed:**

Baseline:
```json
{
  "content": [
    {
      "type": "text",
      "text": ""
    }
  ],
  "structuredContent": {
    "content": ""
  }
}
```

Current:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Hello from OpenAI agent!"
    }
  ],
  "structuredContent": {
    "content": "Hello from OpenAI agent!"
  }
}
```

## Latency Changes

Calls with >20% latency change:

| Method | Baseline (ms) | Current (ms) | Change |
|--------|---------------|--------------|--------|
| initialize | 493 | 376 | 23.7% faster |
| tools/list | 2 | 1 | 50.0% faster |
| tools/list | 2 | 1 | 50.0% faster |
| tools/call | 1 | 505 | 50400.0% slower |
| tools/call | 2 | 1003 | 50050.0% slower |
| tools/call | 2 | 503 | 25050.0% slower |

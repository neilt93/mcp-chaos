# mcp-debug

> Drop-in MCP proxy for automated stress tests, chaos injection, replay, and regression diffs for agent tool use.

## The Problem

- **MCP Inspector** is for manual debugging during development
- **LangSmith/Langfuse** are for production monitoring

Neither helps you **test before shipping**.

## The Solution

mcp-debug sits between your AI agent and MCP servers to:

- **Record** every tool call with full request/response traces
- **Test** servers with auto-generated edge cases from schemas
- **Compare** traces to catch regressions before they ship
- **Inject** faults to test resilience (delays, errors, corrupted responses)

## Install

```bash
npm install -g mcp-debug
```

## Quick Start

### Record a trace

```bash
mcp-debug proxy \
  --target "npx @modelcontextprotocol/server-filesystem /tmp" \
  --trace session.json
```

### Stress test a server

```bash
mcp-debug stress \
  --target "npx @modelcontextprotocol/server-filesystem /tmp" \
  --output stress-report.md
```

### Compare two traces

```bash
mcp-debug diff \
  --baseline v1.json \
  --current v2.json \
  --output diff-report.md
```

### Chaos testing (fault injection)

```bash
mcp-debug proxy \
  --target "npx @modelcontextprotocol/server-filesystem /tmp" \
  --trace session.json \
  --inject chaos.json
```

## Use with Cline

Configure your MCP settings to route through the proxy:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-debug",
      "args": [
        "proxy",
        "--target", "npx @modelcontextprotocol/server-filesystem /tmp",
        "--trace", "trace.json"
      ]
    }
  }
}
```

## CI Integration

```yaml
- name: MCP Reliability Test
  run: |
    mcp-debug stress --target "..." --output stress.md
    mcp-debug diff --baseline golden.json --current new.json --output diff.md
```

## How It Works

```
Client (Cline/Claude Desktop)
    │
    │ stdio (JSON-RPC 2.0)
    ▼
┌─────────────────────────────────┐
│       mcp-debug proxy           │
│  ┌───────────────────────────┐  │
│  │    Interceptor Layer      │  │
│  │  - Record all calls       │  │
│  │  - Inject faults          │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
    │
    │ stdio (spawns subprocess)
    ▼
Real MCP Server (filesystem, etc.)
```

## Commands

| Command | Description |
|---------|-------------|
| `proxy` | Forward MCP traffic and record traces |
| `stress` | Auto-generate stress tests from tool schemas |
| `diff` | Compare two traces for regressions |

## Chaos Config

```json
{
  "global": {
    "delayMs": 100
  },
  "tools": {
    "read_file": {
      "delayMs": 3000,
      "failRate": 0.1
    },
    "write_file": {
      "corruptResponse": true
    }
  }
}
```

## License

MIT

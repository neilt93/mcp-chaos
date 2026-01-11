# mcp-debug

**Catch MCP regressions before your users do.**

A testing toolkit for MCP (Model Context Protocol) servers and AI agents. Record, replay, diff, and stress test your MCP integrations before shipping.

## The Problem

When you build an MCP server or AI agent that uses tools, you have no visibility into:
- **What's actually happening** - AI agents call tools in opaque ways
- **If your update broke something** - No way to compare before/after behavior
- **How it handles edge cases** - Will it crash on malformed input? Timeouts?

## What mcp-debug Does

### 1. Proxy & Recording
Intercepts all MCP traffic and records to a database:
```
AI Agent → mcp-debug proxy → Your MCP Server
                ↓
          Records everything
```

### 2. Regression Detection
Compare runs to catch breaking changes:
- "Added 2 tool calls, removed 1"
- "Latency increased 35%"
- "Arguments changed for read_file"

### 3. Stress Testing
Find breaking points before users do:
- **Fuzz inputs**: empty strings, null, boundary values
- **Inject chaos**: delays, failures, timeouts
- **Score**: "85% passed, 10% graceful fail, 5% crashed"

## Positioning

| Tool | Purpose |
|------|---------|
| MCP Inspector | Manual debugging |
| LangSmith/Langfuse | Production monitoring |
| **mcp-debug** | **Pre-ship automated testing** |

---

## Quick Start

### 1. Install & Start Server

```bash
cd mcp-debug
npm install
cd ui && npm install && npm run build && cd ..

# Start the server (UI + API)
npx tsx src/cli.ts serve --port 3001
```

Open http://localhost:3001 to see the UI.

### 2. Create a Project & Agent

In the UI:
1. Click **"New Project"** → name it (e.g., "my-app")
2. Click **"Add Agent"** → set target command:
   ```
   npx -y @modelcontextprotocol/server-filesystem /tmp
   ```
3. Copy the **Agent ID**

### 3. Run with Proxy

Use the proxy to record all MCP traffic:

```bash
# Using agent ID
npx tsx src/cli.ts proxy --agent <agent-id>

# Or auto-create project/agent
npx tsx src/cli.ts proxy --project my-app --name filesystem --target "npx -y @modelcontextprotocol/server-filesystem /tmp"
```

The proxy speaks MCP on stdin/stdout - connect your AI agent to it.

### 4. View Results

- Open http://localhost:3001
- Select your project → agent → run
- See timeline of all tool calls, latencies, errors

---

## Example: OpenAI Agent Test

See `openai-agent-test/` for a complete Python example:

```bash
cd openai-agent-test
pip install -r requirements.txt

# Set your OpenAI key
export OPENAI_API_KEY=your-key

# Run the test agent
python test_agent.py
```

This agent:
1. Connects to mcp-debug proxy
2. Uses GPT-4 to interact with filesystem tools
3. All calls recorded for analysis

---

## Demo Chat UI

A browser-based chat demo with GPT-4 + MCP:

```bash
# Terminal 1: Start mcp-debug server
cd mcp-debug
npx tsx src/cli.ts serve --port 3001

# Terminal 2: Start chat demo
npx tsx demo/server.ts
```

Open http://localhost:3002 - chat with an AI that can read/write files, all recorded through mcp-debug.

---

## Features

### Web UI (http://localhost:3001)

| Tab | Description |
|-----|-------------|
| **Projects** | Manage projects, agents, view runs |
| **Trace Viewer** | Timeline & graph view of MCP events |
| **Trace Diff** | Compare runs across projects/agents |
| **Stress Lab** | Configure and run stress tests |

### Trace Diff

Compare any two runs to detect regressions:
- **Added/Removed** - Which tools were called differently
- **Changed Args** - Same tool, different arguments
- **Latency Changes** - Performance regressions (>20% flagged)

### Stress Testing

Two modes:
1. **Schema Mutation** - Auto-generate edge cases from tool schemas
2. **Replay with Chaos** - Re-run a recorded session with injected failures

Chaos options:
```json
{
  "delayMs": { "min": 100, "max": 500 },
  "failRate": 0.1,
  "timeoutMs": 5000
}
```

---

## CLI Reference

### `mcp-debug serve`
Start the web server:
```bash
npx tsx src/cli.ts serve --port 3001
```

### `mcp-debug proxy`
Forward MCP traffic and record:
```bash
# With existing agent
npx tsx src/cli.ts proxy --agent <agent-id>

# Auto-create project/agent
npx tsx src/cli.ts proxy --project myapp --name myagent --target "command"

# With chaos injection
npx tsx src/cli.ts proxy --agent <id> --inject chaos.json
```

### `mcp-debug stress`
Run stress tests:
```bash
npx tsx src/cli.ts stress --target "command" --output report.md
```

### `mcp-debug diff`
Compare traces:
```bash
npx tsx src/cli.ts diff --baseline trace1.json --current trace2.json
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id/agents` | List agents |
| POST | `/api/projects/:id/agents` | Create agent |
| GET | `/api/agents/:id/runs` | List runs |
| GET | `/api/runs/:id` | Get run details |
| GET | `/api/traces/:runId/events` | Get trace events |
| POST | `/api/agents/:id/stress` | Start stress test |

WebSocket at `/ws` for real-time updates.

---

## Project Structure

```
mcp-debug/
├── src/
│   ├── cli.ts                 # CLI entry point
│   ├── commands/              # proxy, stress, diff commands
│   ├── server/                # Express + WebSocket server
│   │   ├── db/                # SQLite schema & queries
│   │   └── routes/            # API endpoints
│   ├── tracer/                # Event recording
│   ├── stress/                # Stress test runner
│   └── chaos/                 # Chaos injection
├── ui/                        # React frontend
├── demo/                      # Chat demo server
└── data/                      # SQLite database

openai-agent-test/             # Python example agent
├── test_agent.py              # GPT-4 + MCP test
├── chaos.json                 # Example chaos config
└── reports/                   # Generated diff reports
```

---

## How It Works

1. **Proxy** spawns your MCP server as a child process
2. **JSON-RPC 2.0** messages pass through on stdin/stdout
3. **All events** recorded to SQLite (tool calls, results, latencies)
4. **WebSocket** pushes real-time updates to UI
5. **Diff algorithm** compares tool_call events by name and arguments

---

## License

MIT

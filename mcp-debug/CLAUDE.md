# mcp-debug

MCP reliability testing toolkit: proxy, stress testing, chaos injection, diff + web UI.

## Project Purpose

Pre-ship reliability testing for MCP tool servers and agent tool use. This is different from:
- MCP Inspector (manual debugging)
- LangSmith/Langfuse (production monitoring)

**mcp-debug** = automated testing + CI regression detection before shipping.

## Architecture

```
Project (e.g., "my-app")
  └── Agent (e.g., "filesystem-server")
        └── Runs
            ├── Proxy runs (real agent interactions, auto-recorded)
            └── Stress runs (synthetic tests with chaos injection)
```

- **Projects** group related agents
- **Agents** are configured MCP servers with target commands
- **Runs** have two types:
  - `proxy` - Real AI agent interactions, auto-recorded when proxy runs
  - `stress` - Synthetic stress tests (generated from schema or replayed with chaos)

## Stress Lab (Unified Stress Testing)

The Stress Lab unifies fuzz testing (malformed inputs) and chaos injection (delays/errors) into a single configurable system.

### Stress Profiles

Configurable presets that define how to stress test an MCP server:

```json
{
  "name": "Heavy Load",
  "description": "Simulate high latency and intermittent failures",
  "mutations": {
    "enabled": true,
    "types": ["boundary", "type_coercion", "missing_required"]
  },
  "chaos": {
    "delayMs": { "min": 100, "max": 500 },
    "failRate": 0.1,
    "timeoutMs": 5000
  }
}
```

### Two Modes

1. **Generate from Schema** - Auto-generate test cases from tool schemas
   - Boundary values (empty strings, max integers, null)
   - Type coercion (string "123" vs number 123)
   - Missing required fields
   - Invalid enum values
   - Deep nested object mutations

2. **Replay with Stress** - Take a recorded proxy run and replay it with chaos
   - Same inputs as real agent session
   - Add delays, failures, timeouts
   - Compare results to baseline
   - Identify breaking points

### Stress Run Stats

Each stress run tracks:
- `stress_passed` - Tool calls that returned valid results
- `stress_graceful` - Tool calls that failed gracefully (proper error response)
- `stress_crashed` - Tool calls that crashed or timed out
- `stress_score` - Overall robustness score (0-100)

## Quick Start

```bash
# 1. Start the server (serves UI + API)
npx tsx src/cli.ts serve --port 3001

# 2. Open UI at http://localhost:3001
#    - Create a Project (e.g., "my-app")
#    - Add an Agent with target command (e.g., "npx -y @modelcontextprotocol/server-filesystem /tmp")
#    - Copy the agent ID

# 3. Run proxy with agent (auto-records to DB)
npx tsx src/cli.ts proxy --agent <agent-id>

# Or run proxy directly with target (not linked to an agent)
npx tsx src/cli.ts proxy --target "npx -y @modelcontextprotocol/server-filesystem /tmp"

# 4. View runs in the UI - they appear automatically!
```

## CLI Commands

### `mcp-debug serve`
Start the web server with UI and API.

```bash
mcp-debug serve --port 3001
```

### `mcp-debug proxy`
Forward MCP traffic and auto-record to database.

```bash
# Using an agent (recommended)
mcp-debug proxy --agent <agent-id>

# Or with direct target
mcp-debug proxy --target "npx -y @modelcontextprotocol/server-filesystem /tmp"

# With chaos injection
mcp-debug proxy --agent <agent-id> --inject ./chaos.json

# Also save to file
mcp-debug proxy --agent <agent-id> --trace ./traces/session.json
```

### `mcp-debug stress`
Run stress tests on an MCP server.

```bash
# Generate tests from schema
mcp-debug stress \
  --target "npx -y @modelcontextprotocol/server-filesystem /tmp" \
  --output ./reports/stress.md

# Replay a recorded run with chaos
mcp-debug stress \
  --replay <run-id> \
  --chaos ./stress-profile.json
```

### `mcp-debug diff`
Compare two traces for regressions.

```bash
mcp-debug diff \
  --baseline ./traces/v1.json \
  --current ./traces/v2.json \
  --output ./reports/diff.md
```

## Web UI

The UI at `http://localhost:3001` has:

1. **Projects Tab** - Manage projects, agents, and view runs
   - Create projects to group agents
   - Add agents with target MCP server commands
   - View runs for each agent with type indicators (proxy=blue, stress=orange)
   - Click a run to see Timeline or Graph view
   - Real-time updates via WebSocket

2. **Stress Lab** - Per-agent stress testing interface
   - Configure stress profiles
   - Run stress tests (schema-generated or replay mode)
   - View stress run results with pass/graceful/crash breakdown
   - Compare baseline vs stressed runs

3. **Trace Viewer** - Select Project → Agent → Run to visualize traces
   - Timeline view with event details
   - Graph view showing MCP event flow with latency coloring
   - Live updates as new events are recorded

4. **Trace Diff** - Compare runs across projects and agents
   - Independent baseline/current run selectors
   - Compares tool_call events (not all events)
   - Shows added/removed tools, changed arguments
   - Latency comparison with percentage changes

## Database

SQLite database at `data/mcp-debug.db` stores:
- Projects
- Agents (linked to projects)
- Runs (linked to agents, with `run_type` = 'proxy' | 'stress')
- Trace events (linked to runs)
- Stress profiles (per-agent configurations)

All data is persisted automatically when using the proxy command.

## Project Structure

```
mcp-debug/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── commands/
│   │   ├── proxy.ts        # Proxy command (auto-records to DB)
│   │   ├── stress.ts       # Stress testing
│   │   └── diff.ts         # Trace comparison
│   ├── server/
│   │   ├── index.ts        # Express + WebSocket server
│   │   ├── db/
│   │   │   ├── schema.ts   # SQLite schema
│   │   │   └── queries.ts  # DB operations
│   │   └── routes/
│   │       ├── projects.ts # Project/Agent CRUD
│   │       ├── agents.ts   # Agent endpoints
│   │       ├── runs.ts     # Run endpoints
│   │       ├── traces.ts   # Trace events
│   │       └── stress.ts   # Stress testing endpoints
│   ├── tracer/
│   │   └── recorder.ts     # Records to DB + optional file
│   ├── stress/
│   │   ├── schema-mutator.ts  # Generate mutations from schemas
│   │   └── runner.ts          # Execute stress tests
│   └── chaos/
│       └── injector.ts     # Chaos injection
├── ui/
│   └── src/
│       ├── App.tsx
│       └── components/
│           ├── ProjectView.tsx   # Project/Agent/Run management
│           ├── StressLab.tsx     # Stress testing UI
│           ├── GraphView.tsx     # Graph visualization
│           └── ...
└── data/
    └── mcp-debug.db        # SQLite database
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/agents` | List agents in project |
| POST | `/api/projects/:id/agents` | Create agent |
| GET | `/api/agents/:id` | Get agent |
| DELETE | `/api/agents/:id` | Delete agent |
| GET | `/api/agents/:id/runs` | List runs for agent |
| POST | `/api/agents/:id/stress` | Start stress test |
| GET | `/api/agents/:id/stress/latest` | Get latest stress run |
| GET | `/api/runs` | List all runs |
| GET | `/api/runs/:id` | Get run details |
| GET | `/api/traces/:runId/events` | Get trace events |

## Chaos Config

```json
{
  "global": {
    "delayMs": 100
  },
  "tools": {
    "read_file": {
      "delayMs": 500,
      "failRate": 0.1
    }
  }
}
```

## Demo Chat Server

A complete chat demo that shows MCP in action with GPT-4:

```bash
# Start the mcp-debug server first
npx tsx src/cli.ts serve --port 3001

# Start the demo (requires OPENAI_API_KEY in .env)
npx tsx demo/server.ts

# Or with custom project/agent names
PROJECT=my-project AGENT_NAME=my-agent npx tsx demo/server.ts
```

The demo:
- Runs at http://localhost:3002
- Uses GPT-4o-mini with MCP filesystem tools
- Auto-creates project and agent if they don't exist
- Saves chat messages and tool calls as trace events
- "Reset Conversation" button starts a fresh run
- All interactions recorded through mcp-debug proxy

## Real-time Updates

The UI supports WebSocket-based real-time updates:
- New runs appear automatically when proxy starts
- Events update live as they're recorded
- Run status updates (running → completed) are pushed instantly

## Key Implementation Notes

- **Auto-recording**: Proxy automatically creates runs in the database
- **Stdio transport**: JSON-RPC 2.0 over stdin/stdout
- **Logging**: All logs go to stderr (stdout is MCP protocol)
- **Graph view**: Shows all MCP events (RPC requests/responses, tool calls) with nodes colored by latency
- **WebSocket**: Real-time updates via `/ws` endpoint with run, agent, and global subscriptions
- **Chat history**: Demo server saves user/assistant messages as `chat_message` trace events
- **Run types**: `proxy` (blue in UI) for real interactions, `stress` (orange) for stress tests
- **Run cleanup**: Stale runs are auto-completed when a new run of the same type starts
- **Trace diff**: Only compares `tool_call` events, groups by tool name for meaningful comparison

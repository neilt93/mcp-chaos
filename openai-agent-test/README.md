# OpenAI Agent Test

Example Python agent that uses MCP tools through mcp-debug proxy.

## Setup

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt

# Set OpenAI API key
export OPENAI_API_KEY=your-key-here
```

## Usage

Make sure mcp-debug server is running first:
```bash
cd ../mcp-debug
npx tsx src/cli.ts serve --port 3001
```

Then run the agent:
```bash
# Baseline run (no chaos)
python test_agent.py

# Run with chaos injection (delays, errors)
python test_agent.py --chaos
```

## What It Does

1. Connects to mcp-debug proxy
2. Proxy spawns MCP filesystem server
3. Agent uses GPT-4 to:
   - List files in work directory
   - Create a test file
   - Read the file back
4. All tool calls recorded to mcp-debug

## View Results

Open http://localhost:3001 and navigate to:
- Project: `openai-test`
- Agent: `filesystem`

You'll see all tool calls, latencies, and can compare runs.

## Chaos Config

Edit `chaos.json` to customize chaos injection:

```json
{
  "global": {
    "delayMs": 100
  },
  "tools": {
    "read_file": {
      "delayMs": 500,
      "failRate": 0.2
    }
  }
}
```

## Files

- `test_agent.py` - Main agent script
- `chaos.json` - Chaos injection config
- `traces/` - Recorded trace files
- `reports/` - Generated diff reports

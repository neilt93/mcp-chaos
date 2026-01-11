#!/usr/bin/env python3
"""
OpenAI agent that uses MCP tools through mcp-debug proxy.

This example demonstrates how to:
1. Connect an AI agent to MCP tools via mcp-debug proxy
2. Record all tool calls for analysis
3. Run with chaos injection to test error handling

Usage:
    # First install dependencies:
    pip install -r requirements.txt

    # Run baseline (no chaos):
    python test_agent.py

    # Run with chaos injection:
    python test_agent.py --chaos

    # View results in mcp-debug UI at http://localhost:3001
"""

import asyncio
import argparse
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from parent directory
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(env_path, override=True)

from agents import Agent, Runner
from agents.mcp import MCPServerStdio


# Directory for the agent to work in
WORK_DIR = "/private/tmp/mcp-debug-test"

# Path to mcp-debug project
MCP_DEBUG_DIR = Path(__file__).parent.parent / "mcp-debug"


async def run_agent(use_chaos: bool = False):
    """Run the test agent with or without chaos injection."""

    # Ensure work directory exists
    os.makedirs(WORK_DIR, exist_ok=True)

    # Build mcp-debug proxy command
    trace_file = "chaos-trace.json" if use_chaos else "baseline-trace.json"
    traces_dir = Path(__file__).parent / "traces"
    traces_dir.mkdir(exist_ok=True)
    trace_path = traces_dir / trace_file

    proxy_args = [
        "src/cli.ts",
        "proxy",
        "--project", "openai-test",
        "--name", "filesystem",
        "--target", f"npx -y @modelcontextprotocol/server-filesystem {WORK_DIR}",
        "--trace", str(trace_path),
    ]

    # Add chaos config if requested
    if use_chaos:
        chaos_config = Path(__file__).parent / "chaos.json"
        if chaos_config.exists():
            proxy_args.extend(["--inject", str(chaos_config)])
            print(f"Chaos mode enabled with config: {chaos_config}")
        else:
            print(f"Warning: Chaos config not found at {chaos_config}")

    print(f"Trace will be written to: {trace_path}")
    print(f"Working directory: {WORK_DIR}")
    print(f"View results at: http://localhost:3001")
    print()

    async with MCPServerStdio(
        name="Filesystem via mcp-debug",
        params={
            "command": "npx",
            "args": ["tsx"] + proxy_args,
            "cwd": str(MCP_DEBUG_DIR),
        },
    ) as server:
        agent = Agent(
            name="FileAgent",
            instructions="""You are a helpful assistant that can read and write files.
            When asked to perform file operations, use the available tools.
            Be concise in your responses.""",
            mcp_servers=[server],
        )

        # Test task: list files, create a file, read it back
        task = f"""
        Please do the following in {WORK_DIR}:
        1. List all files in the directory
        2. Create a file called 'hello.txt' with the content 'Hello from OpenAI agent!'
        3. Read the file back and confirm its contents
        """

        print("Running agent task...")
        print("-" * 50)

        result = await Runner.run(agent, task)

        print("-" * 50)
        print("Agent output:")
        print(result.final_output)
        print()
        print(f"Trace saved to: {trace_path}")
        print(f"View in UI: http://localhost:3001")


def main():
    parser = argparse.ArgumentParser(description="Run test agent with MCP tools")
    parser.add_argument(
        "--chaos",
        action="store_true",
        help="Enable chaos injection (delays, errors)",
    )
    args = parser.parse_args()

    asyncio.run(run_agent(use_chaos=args.chaos))


if __name__ == "__main__":
    main()

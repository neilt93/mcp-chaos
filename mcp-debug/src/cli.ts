#!/usr/bin/env node

import { Command } from 'commander';
import { proxyCommand } from './commands/proxy.js';
import { stressCommand } from './commands/stress.js';
import { diffCommand } from './commands/diff.js';
import { startServer } from './server/index.js';

const program = new Command();

program
  .name('mcp-debug')
  .description('Drop-in MCP proxy for automated stress tests, chaos injection, replay, and regression diffs')
  .version('0.1.0');

program
  .command('proxy')
  .description('Forward MCP traffic and record to database (auto-visible in UI)')
  .option('-t, --target <command>', 'Target MCP server command to proxy')
  .option('-a, --agent <id>', 'Agent ID to use (uses agent\'s target and chaos config)')
  .option('-p, --project <name>', 'Project name (auto-creates if needed, use with --name)')
  .option('-n, --name <name>', 'Agent name (auto-creates if needed, use with --project)')
  .option('--trace <path>', 'Optional path to also save trace as JSONL file')
  .option('--inject <path>', 'Path to chaos config JSON for fault injection')
  .action(proxyCommand);

program
  .command('stress')
  .description('Run stress tests on an MCP server')
  .requiredOption('-t, --target <command>', 'Target MCP server command to test')
  .option('-o, --output <path>', 'Path to save stress test report', './reports/stress.md')
  .option('--trace <path>', 'Path to save trace of stress test session')
  .option('--debug', 'Enable debug logging')
  .action(stressCommand);

program
  .command('diff')
  .description('Compare two traces for regressions')
  .requiredOption('-b, --baseline <path>', 'Path to baseline trace JSON')
  .requiredOption('-c, --current <path>', 'Path to current trace JSON')
  .option('-o, --output <path>', 'Path to save diff report', './reports/diff.md')
  .action(diffCommand);

program
  .command('serve')
  .description('Start the mcp-debug web server with UI and API')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action((options) => {
    startServer({ port: parseInt(options.port, 10) });
  });

program.parse();

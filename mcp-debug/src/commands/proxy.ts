import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { TraceRecorder } from '../tracer/recorder.js';
import { ChaosInjector } from '../chaos/injector.js';
import { logger } from '../utils/logger.js';
import { initDatabase } from '../server/db/schema.js';
import { RunQueries } from '../server/db/queries.js';
import type { ChaosConfig, ChaosApplied } from '../chaos/types.js';

interface ProxyOptions {
  target?: string;
  agent?: string;
  project?: string;
  name?: string;
  trace?: string;
  inject?: string;
}

/**
 * Parse a command string into command and args
 * Handles quoted strings properly
 */
function parseCommand(target: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < target.length; i++) {
    const char = target[i];

    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  const [cmd, ...args] = parts;
  return { cmd, args };
}

export async function proxyCommand(options: ProxyOptions): Promise<void> {
  const { agent: agentId, project: projectName, name: agentName, trace, inject } = options;
  let { target } = options;

  // Initialize database for recording
  const db = initDatabase();
  const dbQueries = new RunQueries(db);

  // If agent ID provided, look it up and use its config
  let agentDbId: string | undefined;
  let chaosConfig: ChaosConfig | undefined;

  if (agentId) {
    // Look up existing agent by ID
    const agent = dbQueries.getAgent(agentId);
    if (!agent) {
      logger.error('Agent not found', { agentId });
      process.exit(1);
    }
    target = agent.target;
    agentDbId = agent.id;
    if (agent.chaos_profile) {
      chaosConfig = JSON.parse(agent.chaos_profile);
    }
    logger.info('Using agent config', { name: agent.name, target: agent.target });
  } else if (projectName && agentName && target) {
    // Auto-create project and agent if --project and --name provided
    let project = dbQueries.getProjectByName(projectName);
    if (!project) {
      project = dbQueries.createProject(projectName);
      logger.info('Created project', { name: projectName, id: project.id });
    }

    let agent = dbQueries.getAgentByName(project.id, agentName);
    if (!agent) {
      agent = dbQueries.createAgent(project.id, agentName, target);
      logger.info('Created agent', { name: agentName, id: agent.id });
    } else {
      // Use existing agent's target if not overridden
      target = agent.target;
    }
    agentDbId = agent.id;
    if (agent.chaos_profile) {
      chaosConfig = JSON.parse(agent.chaos_profile);
    }
    logger.info('Using agent', { project: projectName, name: agentName, id: agent.id });
  }

  if (!target) {
    logger.error('Either --target, --agent, or (--project + --name + --target) is required');
    process.exit(1);
  }

  // Parse target into command and args
  const { cmd: targetCmd, args: targetArgs } = parseCommand(target);

  if (!targetCmd) {
    logger.error('No command specified in target');
    process.exit(1);
  }

  // Load chaos config from file if provided (overrides agent config)
  if (inject) {
    try {
      chaosConfig = JSON.parse(readFileSync(inject, 'utf-8'));
      logger.info('Loaded chaos config', { path: inject });
    } catch (err) {
      logger.error('Failed to load chaos config', { path: inject, error: err });
      process.exit(1);
    }
  }

  // Initialize recorder with database (file trace is now optional)
  const recorder = new TraceRecorder(target, targetCmd, targetArgs, trace || null, chaosConfig, dbQueries, agentDbId);
  const injector = chaosConfig ? new ChaosInjector(chaosConfig) : undefined;

  logger.info('Run created', { runId: recorder.getRunId() });

  logger.info('Starting target MCP server', { cmd: targetCmd, args: targetArgs });

  // Spawn target MCP server without shell
  const targetProcess = spawn(targetCmd, targetArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Handle spawn errors
  targetProcess.on('error', (err) => {
    logger.error('Failed to spawn target process', { error: err.message });
    process.exit(1);
  });

  logger.info('Started target MCP server', { pid: targetProcess.pid });

  // Handle target stderr (log it)
  targetProcess.stderr?.on('data', (data: Buffer) => {
    logger.debug(`[target stderr] ${data.toString().trim()}`);
  });

  // Forward stdin to target, intercepting requests
  const stdinReader = createInterface({ input: process.stdin });

  stdinReader.on('line', async (line: string) => {
    try {
      const message = JSON.parse(line);

      // Record the request
      if (message.method) {
        recorder.recordRpcRequest(message.id, message.method, message.params);
      }

      // Apply chaos to request if configured
      if (injector && message.method === 'tools/call') {
        const toolName = message.params?.name;
        const delay = injector.getDelay(toolName);
        if (delay > 0) {
          logger.info('Injecting delay', { toolName, delay });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Forward to target
      targetProcess.stdin?.write(line + '\n');
    } catch {
      // Not JSON, forward as-is
      targetProcess.stdin?.write(line + '\n');
    }
  });

  // Forward target stdout to our stdout, intercepting responses
  const targetReader = createInterface({ input: targetProcess.stdout! });

  targetReader.on('line', (line: string) => {
    try {
      const message = JSON.parse(line);

      // Record response
      if (message.id !== undefined) {
        let chaosInfo: ChaosApplied | undefined;

        // Check if chaos was applied (we'd need to track this from the request)
        if (injector) {
          // For now, just record the seed
          chaosInfo = { seed: injector.getSeed() };
        }

        recorder.recordRpcResponse(message.id, message.result, message.error, chaosInfo);
      }
    } catch {
      // Not JSON, ignore for recording
    }

    // Always forward to stdout
    process.stdout.write(line + '\n');
  });

  // Handle process exit
  const cleanup = () => {
    logger.info('Ending trace session', { path: trace });
    recorder.end();
    targetProcess.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  targetProcess.on('close', (code) => {
    logger.info('Target process exited', { code });
    recorder.end();
    process.exit(code ?? 0);
  });

  stdinReader.on('close', () => {
    cleanup();
  });
}

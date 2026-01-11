import { Router } from 'express';
import { spawn } from 'child_process';
import type { RunQueries } from '../db/queries.js';
import { generateMutations, type JsonSchema } from '../../stress/schema-mutator.js';
import { logger } from '../../utils/logger.js';

interface Tool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

type StressOutcome = 'pass' | 'graceful_fail' | 'crash_or_hang';

/**
 * Classify the outcome of a stress test
 */
function classifyOutcome(
  error: string | undefined,
  response: unknown,
  timedOut: boolean
): StressOutcome {
  if (timedOut) return 'crash_or_hang';
  if (!error) return 'pass';

  const gracefulPatterns = [
    /invalid/i, /required/i, /missing/i, /type.*expected/i,
    /must be/i, /should be/i, /cannot be/i, /not allowed/i,
    /validation/i, /argument/i, /parameter/i, /property/i, /schema/i,
  ];

  if (gracefulPatterns.some((pattern) => pattern.test(error))) {
    return 'graceful_fail';
  }

  const crashPatterns = [
    /crash/i, /segfault/i, /exception/i, /internal.*error/i,
    /unexpected/i, /panic/i, /fatal/i, /killed/i,
  ];

  if (crashPatterns.some((pattern) => pattern.test(error))) {
    return 'crash_or_hang';
  }

  return 'graceful_fail';
}

/**
 * Parse a command string into command and args
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
  if (current) parts.push(current);

  const [cmd, ...args] = parts;
  return { cmd, args };
}

/**
 * Run stress tests against an agent's target server
 */
async function runStressTests(queries: RunQueries, agentId: string, runId: string): Promise<void> {
  const agent = queries.getAgent(agentId);
  if (!agent) {
    queries.updateRunStatus(runId, 'failed');
    return;
  }

  const { cmd: targetCmd, args: targetArgs } = parseCommand(agent.target);
  if (!targetCmd) {
    queries.updateRunStatus(runId, 'failed');
    return;
  }

  logger.info('Starting stress test', { agentId, runId, target: agent.target });
  queries.updateRunStatus(runId, 'running');

  const targetProcess = spawn(targetCmd, targetArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  targetProcess.on('error', (err) => {
    logger.error('Failed to spawn target process', { error: err.message });
    queries.updateRunStatus(runId, 'failed');
  });

  targetProcess.stderr?.on('data', (data: Buffer) => {
    logger.debug(`[target] ${data.toString().trim()}`);
  });

  let messageId = 0;

  const sendRequest = (
    method: string,
    params?: unknown,
    timeoutMs = 10000
  ): Promise<{ result?: unknown; error?: string; timedOut: boolean }> => {
    return new Promise((resolve) => {
      const id = ++messageId;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });

      let resolved = false;

      const handler = (line: string) => {
        if (resolved) return;
        try {
          const response = JSON.parse(line);
          if (response.id === id) {
            resolved = true;
            targetProcess.stdout?.off('data', dataHandler);
            clearTimeout(timeout);

            if (response.error) {
              resolve({ error: response.error.message, timedOut: false });
            } else {
              resolve({ result: response.result, timedOut: false });
            }
          }
        } catch {
          // Not our response
        }
      };

      let buffer = '';
      const dataHandler = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(handler);
      };

      targetProcess.stdout?.on('data', dataHandler);
      targetProcess.stdin?.write(message + '\n');

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          targetProcess.stdout?.off('data', dataHandler);
          resolve({ error: 'Timeout waiting for response', timedOut: true });
        }
      }, timeoutMs);
    });
  };

  const sendNotification = (method: string, params?: unknown): void => {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    targetProcess.stdin?.write(message + '\n');
  };

  try {
    // Initialize MCP connection
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-debug-stress', version: '0.1.0' },
    });

    sendNotification('notifications/initialized', {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get available tools
    const toolsResponse = await sendRequest('tools/list', {});
    const toolsResult = toolsResponse.result as { tools: Tool[] } | undefined;
    const tools = toolsResult?.tools ?? [];

    logger.info(`Found ${tools.length} tools for stress testing`);

    let passed = 0;
    let graceful = 0;
    let crashed = 0;

    // Run stress tests for each tool
    for (const tool of tools) {
      if (!tool.inputSchema) continue;

      const mutations = generateMutations(tool.inputSchema);

      for (const mutation of mutations) {
        const startTime = Date.now();
        const response = await sendRequest('tools/call', {
          name: tool.name,
          arguments: mutation.input,
        });

        const outcome = classifyOutcome(response.error, response.result, response.timedOut);
        const latencyMs = Date.now() - startTime;

        // Store as trace event with stress_mutation type
        queries.insertTraceEvent(runId, {
          t: 'stress_mutation',
          ts: new Date().toISOString(),
          tool: tool.name,
          mutation: {
            type: mutation.type,
            description: mutation.description,
            input: mutation.input,
          },
          outcome,
          result: response.result,
          error: response.error ? { message: response.error } : undefined,
          latencyMs,
        } as any);

        if (outcome === 'pass') passed++;
        else if (outcome === 'graceful_fail') graceful++;
        else crashed++;
      }
    }

    // Calculate score
    const total = passed + graceful + crashed;
    const goodOutcomes = passed + graceful;
    const score = total > 0 ? Math.round((goodOutcomes / total) * 100) : 0;

    // Update run with stress stats
    queries.updateStressStats(runId, { passed, graceful, crashed, score });
    queries.updateRunStatus(runId, 'completed');

    logger.info('Stress test completed', { runId, passed, graceful, crashed, score });

  } catch (err) {
    logger.error('Stress test failed', { error: String(err) });
    queries.updateRunStatus(runId, 'failed');
  } finally {
    targetProcess.kill();
  }
}

export function createStressRouter(queries: RunQueries): Router {
  const router = Router();

  // Start a new stress test for an agent
  router.post('/agents/:agentId/stress', (req, res) => {
    try {
      const agent = queries.getAgent(req.params.agentId as string);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Create a run with type 'stress'
      const run = queries.createRun(agent.target, undefined, req.params.agentId as string, 'stress');

      // Run stress tests in background
      runStressTests(queries, req.params.agentId as string, run.id).catch((err) => {
        logger.error('Background stress test error', { error: String(err) });
      });

      res.status(202).json({ run });
    } catch (err) {
      console.error('Error starting stress test:', err);
      res.status(500).json({ error: 'Failed to start stress test' });
    }
  });

  // Get latest stress run for an agent
  router.get('/agents/:agentId/stress/latest', (req, res) => {
    try {
      const agent = queries.getAgent(req.params.agentId as string);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const run = queries.getLatestStressRun(req.params.agentId as string);
      if (!run) {
        res.status(404).json({ error: 'No stress runs found' });
        return;
      }

      // Get stress mutation events for this run
      const events = queries.getRunEvents(run.id);
      const stressEvents = events.filter(e => e.event_type === 'stress_mutation');

      res.json({ run, events: stressEvents });
    } catch (err) {
      console.error('Error getting latest stress run:', err);
      res.status(500).json({ error: 'Failed to get latest stress run' });
    }
  });

  return router;
}

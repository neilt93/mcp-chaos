import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger, setLogLevel } from '../utils/logger.js';
import { generateMutations, type Mutation, type JsonSchema } from '../stress/schema-mutator.js';
import { generateStressReport, type StressResult, type StressOutcome } from '../stress/reporter.js';
import { LegacyTraceRecorder } from '../tracer/recorder.js';

interface StressOptions {
  target: string;
  output: string;
  trace?: string;
  debug?: boolean;
}

interface Tool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
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

/**
 * Classify the outcome of a stress test
 */
function classifyOutcome(
  error: string | undefined,
  response: unknown,
  timedOut: boolean
): StressOutcome {
  // Timeout = crash_or_hang
  if (timedOut) {
    return 'crash_or_hang';
  }

  // No error = pass (server handled it)
  if (!error) {
    return 'pass';
  }

  // Check if error indicates graceful handling
  const gracefulPatterns = [
    /invalid/i,
    /required/i,
    /missing/i,
    /type.*expected/i,
    /must be/i,
    /should be/i,
    /cannot be/i,
    /not allowed/i,
    /validation/i,
    /argument/i,
    /parameter/i,
    /property/i,
    /schema/i,
  ];

  const isGraceful = gracefulPatterns.some((pattern) => pattern.test(error));

  if (isGraceful) {
    return 'graceful_fail';
  }

  // Check for crash indicators
  const crashPatterns = [
    /crash/i,
    /segfault/i,
    /exception/i,
    /internal.*error/i,
    /unexpected/i,
    /panic/i,
    /fatal/i,
    /killed/i,
  ];

  const isCrash = crashPatterns.some((pattern) => pattern.test(error));

  if (isCrash) {
    return 'crash_or_hang';
  }

  // Default to graceful_fail for other errors
  return 'graceful_fail';
}

export async function stressCommand(options: StressOptions): Promise<void> {
  const { target, output, trace, debug } = options;

  if (debug) {
    setLogLevel('debug');
  }

  // Parse target into command and args
  const { cmd: targetCmd, args: targetArgs } = parseCommand(target);

  if (!targetCmd) {
    logger.error('No command specified in target');
    process.exit(1);
  }

  logger.info('Starting stress test', { cmd: targetCmd, args: targetArgs });

  // Spawn target MCP server without shell
  const targetProcess = spawn(targetCmd, targetArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Handle spawn errors
  targetProcess.on('error', (err) => {
    logger.error('Failed to spawn target process', { error: err.message });
    process.exit(1);
  });

  // Log stderr from target
  targetProcess.stderr?.on('data', (data: Buffer) => {
    logger.debug(`[target] ${data.toString().trim()}`);
  });

  // Initialize recorder if trace path provided
  const recorder = trace ? new LegacyTraceRecorder(target) : undefined;

  // Message ID counter
  let messageId = 0;

  // Send JSON-RPC request and wait for response
  const sendRequest = (
    method: string,
    params?: unknown,
    timeoutMs = 10000
  ): Promise<{ result?: unknown; error?: string; timedOut: boolean }> => {
    return new Promise((resolve) => {
      const id = ++messageId;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });

      const startTime = Date.now();
      let resolved = false;

      const handler = (line: string) => {
        if (resolved) return;
        try {
          const response = JSON.parse(line);
          if (response.id === id) {
            resolved = true;
            targetProcess.stdout?.off('data', dataHandler);
            clearTimeout(timeout);
            const latencyMs = Date.now() - startTime;

            if (recorder) {
              recorder.recordCall(method, params, response.result, response.error, latencyMs);
            }

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

      // Timeout
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          targetProcess.stdout?.off('data', dataHandler);
          resolve({ error: 'Timeout waiting for response', timedOut: true });
        }
      }, timeoutMs);
    });
  };

  // Send JSON-RPC notification (no response expected)
  const sendNotification = (method: string, params?: unknown): void => {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    targetProcess.stdin?.write(message + '\n');
  };

  try {
    // Initialize MCP connection
    logger.info('Initializing MCP connection');
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-debug-stress', version: '0.1.0' },
    });

    // Send initialized notification (no response expected)
    sendNotification('notifications/initialized', {});

    // Small delay to let server process the notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get available tools
    logger.info('Fetching tool list');
    const toolsResponse = await sendRequest('tools/list', {});
    const toolsResult = toolsResponse.result as { tools: Tool[] } | undefined;
    const tools = toolsResult?.tools ?? [];

    logger.info(`Found ${tools.length} tools`);

    // Run stress tests for each tool
    const results: StressResult[] = [];

    for (const tool of tools) {
      logger.info(`Stress testing tool: ${tool.name}`);

      if (!tool.inputSchema) {
        logger.warn(`Tool ${tool.name} has no input schema, skipping`);
        continue;
      }

      const mutations = generateMutations(tool.inputSchema);
      logger.info(`Generated ${mutations.length} mutations for ${tool.name}`);

      for (const mutation of mutations) {
        const startTime = Date.now();
        const response = await sendRequest('tools/call', {
          name: tool.name,
          arguments: mutation.input,
        });

        const outcome = classifyOutcome(response.error, response.result, response.timedOut);

        results.push({
          tool: tool.name,
          mutation,
          outcome,
          response: response.result,
          error: response.error,
          latencyMs: Date.now() - startTime,
        });
      }
    }

    // Generate report
    const report = generateStressReport(tools, results);

    // Save report
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, report);
    logger.info(`Stress test report saved to ${output}`);

    // Save trace if configured
    if (recorder && trace) {
      recorder.save(trace);
      logger.info(`Trace saved to ${trace}`);
    }

    // Print summary
    const passed = results.filter((r) => r.outcome === 'pass').length;
    const graceful = results.filter((r) => r.outcome === 'graceful_fail').length;
    const crashed = results.filter((r) => r.outcome === 'crash_or_hang').length;
    console.error(`\nStress Test Summary:`);
    console.error(`  Pass: ${passed}`);
    console.error(`  Graceful fail: ${graceful}`);
    console.error(`  Crash/hang: ${crashed}`);
    console.error(`  Total: ${results.length}`);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error('Stress test failed', { error: errorMessage, stack: errorStack });
    process.exit(1);
  } finally {
    targetProcess.kill();
  }
}

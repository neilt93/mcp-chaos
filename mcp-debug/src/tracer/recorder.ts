import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  TraceEvent,
  ChaosConfig,
  ChaosApplied,
  RpcError,
  Trace,
  TraceCall,
} from './types.js';
import type { RunQueries } from '../server/db/queries.js';

// Simple notification client for WebSocket updates
async function notifyServer(
  serverUrl: string,
  type: string,
  runId: string,
  agentId?: string,
  event?: unknown,
  run?: unknown
): Promise<void> {
  try {
    await fetch(`${serverUrl}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, runId, agentId, event, run }),
    });
  } catch {
    // Ignore notification errors - server may not be running
  }
}

/**
 * JSONL Trace Recorder
 * Writes events line-by-line for crash safety and streaming
 * Optionally records to SQLite database for UI viewing
 */
export class TraceRecorder {
  private sessionId: string;
  private outputPath: string | null;
  private target: string;
  private targetCmd: string;
  private targetArgs: string[];
  private chaosConfig?: ChaosConfig;
  private callCount = 0;
  private errorCount = 0;
  private pendingCalls = new Map<string, { startTime: number; tool?: string }>();
  private dbQueries?: RunQueries;
  private runId?: string;
  private agentId?: string;
  private serverUrl: string;

  constructor(
    target: string,
    targetCmd: string,
    targetArgs: string[],
    outputPath: string | null,
    chaosConfig?: ChaosConfig,
    dbQueries?: RunQueries,
    agentId?: string,
    serverUrl = 'http://localhost:3001'
  ) {
    this.sessionId = uuidv4();
    this.target = target;
    this.targetCmd = targetCmd;
    this.targetArgs = targetArgs;
    this.outputPath = outputPath;
    this.chaosConfig = chaosConfig;
    this.dbQueries = dbQueries;
    this.agentId = agentId;
    this.serverUrl = serverUrl;

    // Create run in database if available
    if (dbQueries) {
      const run = dbQueries.createRun(target, chaosConfig, agentId);
      this.runId = run.id;
      this.sessionId = run.id; // Use the same ID
      dbQueries.updateRunStatus(run.id, 'running');

      // Notify server about new run
      notifyServer(serverUrl, 'run_created', run.id, agentId, undefined, run);
    }

    // Ensure directory exists for file output
    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true });
    }

    // Write session start event
    this.writeEvent({
      t: 'session_start',
      sessionId: this.sessionId,
      target,
      targetCmd,
      targetArgs,
      chaosConfig,
      ts: new Date().toISOString(),
    });
  }

  private writeEvent(event: TraceEvent): void {
    // Write to file if path provided
    if (this.outputPath) {
      appendFileSync(this.outputPath, JSON.stringify(event) + '\n');
    }

    // Write to database if available
    if (this.dbQueries && this.runId) {
      this.dbQueries.insertTraceEvent(this.runId, event);

      // Notify server about new event (for WebSocket broadcast)
      notifyServer(this.serverUrl, 'event', this.runId, this.agentId, event);
    }
  }

  recordRpcRequest(id: string | number | undefined, method: string, params: unknown): void {
    const ts = new Date().toISOString();

    this.writeEvent({
      t: 'rpc_request',
      id,
      method,
      params,
      ts,
    });

    // Track for latency calculation
    if (id !== undefined) {
      const callId = String(id);
      this.pendingCalls.set(callId, { startTime: Date.now() });

      // If this is a tools/call, extract tool name
      if (method === 'tools/call') {
        const toolName = (params as { name?: string })?.name;
        if (toolName) {
          this.pendingCalls.get(callId)!.tool = toolName;

          // Also emit tool_call event
          this.writeEvent({
            t: 'tool_call',
            tool: toolName,
            args: (params as { arguments?: unknown })?.arguments,
            ts,
            callId,
          });
        }
      }
    }
  }

  recordRpcResponse(
    id: string | number | undefined,
    result: unknown,
    error: RpcError | undefined,
    chaos?: ChaosApplied
  ): void {
    const ts = new Date().toISOString();
    let latencyMs: number | undefined;

    if (id !== undefined) {
      const callId = String(id);
      const pending = this.pendingCalls.get(callId);

      if (pending) {
        latencyMs = Date.now() - pending.startTime;

        // If this was a tool call, emit tool_result event
        if (pending.tool) {
          this.callCount++;
          if (error) this.errorCount++;

          this.writeEvent({
            t: 'tool_result',
            callId,
            ok: !error,
            result,
            error,
            ts,
            latencyMs,
            chaos,
          });
        }

        this.pendingCalls.delete(callId);
      }
    }

    this.writeEvent({
      t: 'rpc_response',
      id,
      result,
      error,
      ts,
      latencyMs,
    });
  }

  end(): void {
    this.writeEvent({
      t: 'session_end',
      sessionId: this.sessionId,
      ts: new Date().toISOString(),
      totalCalls: this.callCount,
      totalErrors: this.errorCount,
    });

    // Update run status in database
    if (this.dbQueries && this.runId) {
      this.dbQueries.updateRunStatus(this.runId, 'completed', {
        totalCalls: this.callCount,
        totalErrors: this.errorCount,
      });

      // Fetch the updated run and notify server
      const run = this.dbQueries.getRun(this.runId);
      notifyServer(this.serverUrl, 'run_updated', this.runId, this.agentId, undefined, run);
    }
  }

  getRunId(): string | undefined {
    return this.runId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Convert JSONL trace to legacy JSON format for UI compatibility
   */
  static jsonlToLegacy(jsonlPath: string): Trace {
    const content = readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events: TraceEvent[] = lines.map((line: string) => JSON.parse(line));

    let sessionStart: any = null;
    let sessionEnd: any = null;
    const calls: TraceCall[] = [];
    let callId = 0;

    // Match requests to responses
    const requests = new Map<string, { method: string; params: unknown; ts: string }>();

    for (const event of events) {
      if (event.t === 'session_start') {
        sessionStart = event;
      } else if (event.t === 'session_end') {
        sessionEnd = event;
      } else if (event.t === 'rpc_request' && event.id !== undefined) {
        requests.set(String(event.id), {
          method: event.method,
          params: event.params,
          ts: event.ts,
        });
      } else if (event.t === 'rpc_response' && event.id !== undefined) {
        const req = requests.get(String(event.id));
        if (req) {
          calls.push({
            id: ++callId,
            timestamp: req.ts,
            method: req.method,
            params: req.params,
            result: event.result,
            error: event.error,
            latencyMs: event.latencyMs ?? 0,
          });
          requests.delete(String(event.id));
        }
      }
    }

    return {
      sessionId: sessionStart?.sessionId ?? 'unknown',
      startTime: sessionStart?.ts ?? new Date().toISOString(),
      endTime: sessionEnd?.ts,
      target: sessionStart?.target ?? 'unknown',
      chaosConfig: sessionStart?.chaosConfig,
      calls,
    };
  }
}

/**
 * Legacy recorder for backward compatibility
 * Writes single JSON file (used by fuzz command currently)
 */
export class LegacyTraceRecorder {
  private trace: Trace;
  private callId = 0;

  constructor(target: string, chaosConfig?: ChaosConfig) {
    this.trace = {
      sessionId: uuidv4(),
      startTime: new Date().toISOString(),
      target,
      chaosConfig,
      calls: [],
    };
  }

  recordCall(
    method: string,
    params: unknown,
    result: unknown,
    error: RpcError | undefined,
    latencyMs: number,
    chaos?: ChaosApplied
  ): void {
    this.trace.calls.push({
      id: ++this.callId,
      timestamp: new Date().toISOString(),
      method,
      params,
      result,
      error,
      latencyMs,
      chaos,
    });
  }

  getTrace(): Trace {
    return this.trace;
  }

  save(outputPath: string): void {
    this.trace.endTime = new Date().toISOString();
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(this.trace, null, 2));
  }
}

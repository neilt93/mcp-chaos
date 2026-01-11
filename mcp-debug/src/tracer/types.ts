// JSON-RPC Error
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Chaos that was applied to an event
export interface ChaosApplied {
  delayMs?: number;
  errorInjected?: boolean;
  responseCorrupted?: boolean;
  seed?: number;
}

// Event types for JSONL trace format
export type TraceEvent =
  | RpcRequestEvent
  | RpcResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | SessionStartEvent
  | SessionEndEvent
  | StressMutationEvent
  | ChatMessageEvent;

export interface RpcRequestEvent {
  t: 'rpc_request';
  id?: string | number;
  method: string;
  params?: unknown;
  ts: string;
}

export interface RpcResponseEvent {
  t: 'rpc_response';
  id?: string | number;
  result?: unknown;
  error?: RpcError;
  ts: string;
  latencyMs?: number;
}

export interface ToolCallEvent {
  t: 'tool_call';
  tool: string;
  args: unknown;
  ts: string;
  callId: string;
}

export interface ToolResultEvent {
  t: 'tool_result';
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: RpcError;
  ts: string;
  latencyMs: number;
  chaos?: ChaosApplied;
}

export interface SessionStartEvent {
  t: 'session_start';
  sessionId: string;
  target: string;
  targetCmd: string;
  targetArgs: string[];
  chaosConfig?: ChaosConfig;
  ts: string;
}

export interface SessionEndEvent {
  t: 'session_end';
  sessionId: string;
  ts: string;
  totalCalls: number;
  totalErrors: number;
}

export interface StressMutationEvent {
  t: 'stress_mutation';
  ts: string;
  tool: string;
  mutation: {
    type: string;
    description: string;
    input: unknown;
  };
  outcome: 'pass' | 'graceful_fail' | 'crash_or_hang';
  result?: unknown;
  error?: RpcError;
  latencyMs: number;
}

export interface ChatMessageEvent {
  t: 'chat_message';
  ts: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments: unknown;
  }>;
}

// Chaos configuration
export interface ChaosConfig {
  seed?: number;
  global?: ChaosRule;
  tools?: Record<string, ChaosRule>;
}

export interface ChaosRule {
  delayMs?: number | ProbabilisticValue;
  failRate?: number;
  errorCode?: number;
  errorMessage?: string;
  corruptResponse?: boolean;
  timeoutMs?: number | ProbabilisticValue;
}

export interface ProbabilisticValue {
  p: number;      // Probability 0-1
  value?: number; // Fixed value
  min?: number;   // Or range
  max?: number;
}

// Legacy format for backward compatibility with UI
export interface Trace {
  sessionId: string;
  startTime: string;
  endTime?: string;
  target: string;
  chaosConfig?: ChaosConfig;
  calls: TraceCall[];
}

export interface TraceCall {
  id: number;
  timestamp: string;
  method: string;
  params?: unknown;
  result?: unknown;
  error?: RpcError;
  latencyMs: number;
  chaos?: ChaosApplied;
}

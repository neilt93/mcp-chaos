export interface TraceCall {
  id: number
  timestamp: string
  method: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  latencyMs: number
  chaos?: {
    delayInjected?: number
    errorInjected?: boolean
    responseCorrupted?: boolean
  }
}

export interface Trace {
  sessionId: string
  startTime: string
  endTime?: string
  target: string
  chaosConfig?: unknown
  calls: TraceCall[]
}

export interface NamedTrace {
  name: string
  trace: Trace
}

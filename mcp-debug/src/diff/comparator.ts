import type { Trace, TraceCall } from '../tracer/types.js';

export interface TraceComparison {
  baselineCalls: number;
  currentCalls: number;
  added: CallDiff[];
  removed: CallDiff[];
  changed: CallChange[];
  latencyChanges: LatencyChange[];
}

export interface CallDiff {
  method: string;
  params?: unknown;
  index: number;
}

export interface CallChange {
  method: string;
  index: number;
  baselineParams?: unknown;
  currentParams?: unknown;
  baselineResult?: unknown;
  currentResult?: unknown;
  paramsDiff?: string;
  resultDiff?: string;
}

export interface LatencyChange {
  method: string;
  index: number;
  baselineLatency: number;
  currentLatency: number;
  changePercent: number;
}

export function compareTraces(baseline: Trace, current: Trace): TraceComparison {
  const result: TraceComparison = {
    baselineCalls: baseline.calls.length,
    currentCalls: current.calls.length,
    added: [],
    removed: [],
    changed: [],
    latencyChanges: [],
  };

  // Create maps by method for easier comparison
  const baselineByMethod = groupByMethod(baseline.calls);
  const currentByMethod = groupByMethod(current.calls);

  // Find added methods
  for (const [method, calls] of currentByMethod) {
    if (!baselineByMethod.has(method)) {
      for (const call of calls) {
        result.added.push({
          method,
          params: call.params,
          index: call.id,
        });
      }
    }
  }

  // Find removed methods
  for (const [method, calls] of baselineByMethod) {
    if (!currentByMethod.has(method)) {
      for (const call of calls) {
        result.removed.push({
          method,
          params: call.params,
          index: call.id,
        });
      }
    }
  }

  // Compare calls with same methods
  for (const [method, baselineCalls] of baselineByMethod) {
    const currentCalls = currentByMethod.get(method);
    if (!currentCalls) continue;

    // Compare counts
    if (baselineCalls.length !== currentCalls.length) {
      // Different number of calls
      if (currentCalls.length > baselineCalls.length) {
        for (let i = baselineCalls.length; i < currentCalls.length; i++) {
          result.added.push({
            method,
            params: currentCalls[i].params,
            index: currentCalls[i].id,
          });
        }
      } else {
        for (let i = currentCalls.length; i < baselineCalls.length; i++) {
          result.removed.push({
            method,
            params: baselineCalls[i].params,
            index: baselineCalls[i].id,
          });
        }
      }
    }

    // Compare individual calls
    const minLength = Math.min(baselineCalls.length, currentCalls.length);
    for (let i = 0; i < minLength; i++) {
      const baselineCall = baselineCalls[i];
      const currentCall = currentCalls[i];

      // Check params diff
      const paramsEqual = JSON.stringify(baselineCall.params) === JSON.stringify(currentCall.params);
      const resultEqual = JSON.stringify(baselineCall.result) === JSON.stringify(currentCall.result);

      if (!paramsEqual || !resultEqual) {
        result.changed.push({
          method,
          index: i,
          baselineParams: baselineCall.params,
          currentParams: currentCall.params,
          baselineResult: baselineCall.result,
          currentResult: currentCall.result,
          paramsDiff: paramsEqual ? undefined : 'Parameters changed',
          resultDiff: resultEqual ? undefined : 'Result changed',
        });
      }

      // Check latency changes (>20% difference)
      const latencyChange = ((currentCall.latencyMs - baselineCall.latencyMs) / baselineCall.latencyMs) * 100;
      if (Math.abs(latencyChange) > 20) {
        result.latencyChanges.push({
          method,
          index: i,
          baselineLatency: baselineCall.latencyMs,
          currentLatency: currentCall.latencyMs,
          changePercent: latencyChange,
        });
      }
    }
  }

  return result;
}

function groupByMethod(calls: TraceCall[]): Map<string, TraceCall[]> {
  const map = new Map<string, TraceCall[]>();
  for (const call of calls) {
    const existing = map.get(call.method) ?? [];
    existing.push(call);
    map.set(call.method, existing);
  }
  return map;
}

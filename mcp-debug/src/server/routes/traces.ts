import { Router, Request, Response } from 'express';
import type { RunQueries } from '../db/queries.js';
import type { Trace, TraceCall } from '../../tracer/types.js';

export function createTracesRouter(queries: RunQueries): Router {
  const router = Router();

  // Get events for a run
  router.get('/:runId/events', (req: Request, res: Response) => {
    try {
      const runId = req.params.runId as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      const run = queries.getRun(runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      const events = queries.getRunEvents(runId, limit, offset);
      const total = queries.getRunEventCount(runId);

      res.json({ events, total, limit, offset });
    } catch (err) {
      console.error('Error getting events:', err);
      res.status(500).json({ error: 'Failed to get events' });
    }
  });

  // Get trace in legacy JSON format (for UI compatibility)
  router.get('/:runId/trace.json', (req: Request, res: Response) => {
    try {
      const runId = req.params.runId as string;

      const run = queries.getRun(runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      const events = queries.getRunEvents(runId);

      // Convert to legacy format
      const trace: Trace = {
        sessionId: run.id,
        startTime: run.started_at || run.created_at,
        endTime: run.ended_at || undefined,
        target: run.target,
        chaosConfig: run.chaos_profile ? JSON.parse(run.chaos_profile) : undefined,
        calls: [],
      };

      // Match requests to responses
      const requests = new Map<string, { method: string; params: unknown; ts: string }>();
      let callId = 0;

      for (const event of events) {
        if (event.event_type === 'rpc_request' && event.method) {
          // Use the event id as key for matching
          requests.set(String(event.id), {
            method: event.method,
            params: event.params_json ? JSON.parse(event.params_json) : undefined,
            ts: event.timestamp,
          });
        } else if (event.event_type === 'rpc_response') {
          // Find matching request (simplified - in reality would use JSON-RPC id)
          const reqKey = String(event.id - 1); // Assume response follows request
          const req = requests.get(reqKey);
          if (req) {
            const call: TraceCall = {
              id: ++callId,
              timestamp: req.ts,
              method: req.method,
              params: req.params,
              result: event.result_json ? JSON.parse(event.result_json) : undefined,
              error: event.error_json ? JSON.parse(event.error_json) : undefined,
              latencyMs: event.latency_ms || 0,
              chaos: event.chaos_applied ? JSON.parse(event.chaos_applied) : undefined,
            };
            trace.calls.push(call);
            requests.delete(reqKey);
          }
        }
      }

      res.json(trace);
    } catch (err) {
      console.error('Error getting trace:', err);
      res.status(500).json({ error: 'Failed to get trace' });
    }
  });

  return router;
}

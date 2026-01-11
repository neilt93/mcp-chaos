import { Router } from 'express';
import type { RunQueries } from '../db/queries.js';

export function createAgentsRouter(queries: RunQueries): Router {
  const router = Router();

  // Get an agent by ID
  router.get('/:id', (req, res) => {
    try {
      const agent = queries.getAgent(req.params.id);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      res.json({ agent });
    } catch (err) {
      console.error('Error getting agent:', err);
      res.status(500).json({ error: 'Failed to get agent' });
    }
  });

  // Delete an agent
  router.delete('/:id', (req, res) => {
    try {
      const deleted = queries.deleteAgent(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      console.error('Error deleting agent:', err);
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  });

  // List runs for an agent
  router.get('/:id/runs', (req, res) => {
    try {
      const agent = queries.getAgent(req.params.id);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const { status, limit, offset } = req.query;
      const runs = queries.listRuns({
        agentId: req.params.id,
        status: status as string,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });
      res.json({ runs });
    } catch (err) {
      console.error('Error listing runs:', err);
      res.status(500).json({ error: 'Failed to list runs' });
    }
  });

  return router;
}

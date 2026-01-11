import { Router, Request, Response } from 'express';
import type { RunQueries, RunFilters } from '../db/queries.js';

export function createRunsRouter(queries: RunQueries): Router {
  const router = Router();

  // List runs
  router.get('/', (req: Request, res: Response) => {
    try {
      const filters: RunFilters = {
        status: req.query.status as string | undefined,
        target: req.query.target as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      };

      const runs = queries.listRuns(filters);
      res.json({ runs });
    } catch (err) {
      console.error('Error listing runs:', err);
      res.status(500).json({ error: 'Failed to list runs' });
    }
  });

  // Get single run
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const run = queries.getRun(req.params.id as string);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json({ run });
    } catch (err) {
      console.error('Error getting run:', err);
      res.status(500).json({ error: 'Failed to get run' });
    }
  });

  // Create new run
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, target, chaosProfile } = req.body;

      if (!target) {
        res.status(400).json({ error: 'Target is required' });
        return;
      }

      const run = queries.createRun(target, chaosProfile, name);
      res.status(201).json({ run });
    } catch (err) {
      console.error('Error creating run:', err);
      res.status(500).json({ error: 'Failed to create run' });
    }
  });

  // Update run status
  router.patch('/:id/status', (req: Request, res: Response) => {
    try {
      const { status, totalCalls, totalErrors } = req.body;

      if (!['pending', 'running', 'completed', 'failed'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }

      queries.updateRunStatus(req.params.id as string, status, { totalCalls, totalErrors });
      const run = queries.getRun(req.params.id as string);
      res.json({ run });
    } catch (err) {
      console.error('Error updating run:', err);
      res.status(500).json({ error: 'Failed to update run' });
    }
  });

  // Delete run
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const deleted = queries.deleteRun(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      console.error('Error deleting run:', err);
      res.status(500).json({ error: 'Failed to delete run' });
    }
  });

  return router;
}

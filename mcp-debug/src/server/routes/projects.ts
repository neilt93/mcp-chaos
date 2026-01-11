import { Router } from 'express';
import type { RunQueries } from '../db/queries.js';

export function createProjectsRouter(queries: RunQueries): Router {
  const router = Router();

  // List all projects
  router.get('/', (req, res) => {
    try {
      const projects = queries.listProjects();
      res.json({ projects });
    } catch (err) {
      console.error('Error listing projects:', err);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  // Get a project by ID
  router.get('/:id', (req, res) => {
    try {
      const project = queries.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json({ project });
    } catch (err) {
      console.error('Error getting project:', err);
      res.status(500).json({ error: 'Failed to get project' });
    }
  });

  // Create a new project
  router.post('/', (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      // Check if project with this name already exists
      const existing = queries.getProjectByName(name);
      if (existing) {
        res.status(409).json({ error: 'Project with this name already exists' });
        return;
      }

      const project = queries.createProject(name, description);
      res.status(201).json({ project });
    } catch (err) {
      console.error('Error creating project:', err);
      res.status(500).json({ error: 'Failed to create project' });
    }
  });

  // Delete a project
  router.delete('/:id', (req, res) => {
    try {
      const deleted = queries.deleteProject(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      console.error('Error deleting project:', err);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  // List agents in a project
  router.get('/:id/agents', (req, res) => {
    try {
      const project = queries.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const agents = queries.listAgents(req.params.id);
      res.json({ agents });
    } catch (err) {
      console.error('Error listing agents:', err);
      res.status(500).json({ error: 'Failed to list agents' });
    }
  });

  // Create an agent in a project
  router.post('/:id/agents', (req, res) => {
    try {
      const project = queries.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const { name, target, chaosProfile } = req.body;
      if (!name || !target) {
        res.status(400).json({ error: 'name and target are required' });
        return;
      }

      // Check if agent with this name already exists in project
      const existing = queries.getAgentByName(req.params.id, name);
      if (existing) {
        res.status(409).json({ error: 'Agent with this name already exists in project' });
        return;
      }

      const agent = queries.createAgent(req.params.id, name, target, chaosProfile);
      res.status(201).json({ agent });
    } catch (err) {
      console.error('Error creating agent:', err);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  });

  return router;
}

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

import { initDatabase } from './db/schema.js';
import { RunQueries } from './db/queries.js';
import { createRunsRouter } from './routes/runs.js';
import { createTracesRouter } from './routes/traces.js';
import { createProjectsRouter } from './routes/projects.js';
import { createAgentsRouter } from './routes/agents.js';
import { createStressRouter } from './routes/stress.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  port: number;
}

// Store active WebSocket subscriptions
const runSubscriptions = new Map<string, Set<WebSocket>>();
const agentSubscriptions = new Map<string, Set<WebSocket>>();
const globalSubscriptions = new Set<WebSocket>();

export function broadcastToRun(runId: string, message: object): void {
  const clients = runSubscriptions.get(runId);
  if (clients) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}

export function broadcastToAgent(agentId: string, message: object): void {
  const clients = agentSubscriptions.get(agentId);
  if (clients) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}

export function broadcastGlobal(message: object): void {
  const data = JSON.stringify(message);
  for (const client of globalSubscriptions) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port } = options;

  // Initialize database
  const db = initDatabase();
  const queries = new RunQueries(db);
  logger.info('Database initialized');

  // Create Express app
  const app = express();
  app.use(express.json());

  // API routes
  app.use('/api/projects', createProjectsRouter(queries));
  app.use('/api/agents', createAgentsRouter(queries));
  app.use('/api/runs', createRunsRouter(queries));
  app.use('/api/traces', createTracesRouter(queries));
  app.use('/api', createStressRouter(queries));

  // Internal notification endpoint (for proxy to notify about events)
  app.post('/api/notify', (req, res) => {
    try {
      const { type, runId, agentId, event, run } = req.body;

      // If this is an event notification, save it to the database
      if (type === 'event' && runId && event) {
        queries.insertTraceEvent(runId, event);
      }

      // Broadcast to run subscribers
      if (runId) {
        broadcastToRun(runId, { type, runId, agentId, event, run });
      }

      // Broadcast to agent subscribers
      if (agentId) {
        broadcastToAgent(agentId, { type, runId, agentId, event, run });
      }

      // Broadcast to global subscribers
      broadcastGlobal({ type, runId, agentId, event, run });

      res.json({ ok: true });
    } catch (err) {
      logger.error('Notification error', { error: String(err) });
      res.status(500).json({ error: 'Notification failed' });
    }
  });

  // Diff endpoint
  app.get('/api/diff', (req, res) => {
    try {
      const baselineId = req.query.baseline as string;
      const currentId = req.query.current as string;

      if (!baselineId || !currentId) {
        res.status(400).json({ error: 'baseline and current query params required' });
        return;
      }

      const baselineRun = queries.getRun(baselineId);
      const currentRun = queries.getRun(currentId);

      if (!baselineRun || !currentRun) {
        res.status(404).json({ error: 'One or both runs not found' });
        return;
      }

      // Get events and convert to calls format for comparison
      const baselineEvents = queries.getRunEvents(baselineId);
      const currentEvents = queries.getRunEvents(currentId);

      // Simple comparison - count tool calls
      const baselineToolCalls = baselineEvents.filter(e => e.event_type === 'tool_call');
      const currentToolCalls = currentEvents.filter(e => e.event_type === 'tool_call');

      res.json({
        baseline: {
          id: baselineId,
          name: baselineRun.name,
          callCount: baselineToolCalls.length,
        },
        current: {
          id: currentId,
          name: currentRun.name,
          callCount: currentToolCalls.length,
        },
        summary: {
          baselineCalls: baselineToolCalls.length,
          currentCalls: currentToolCalls.length,
          difference: currentToolCalls.length - baselineToolCalls.length,
        },
      });
    } catch (err) {
      console.error('Error computing diff:', err);
      res.status(500).json({ error: 'Failed to compute diff' });
    }
  });

  // Serve static UI files in production
  const uiDistPath = join(__dirname, '../../ui/dist');
  if (existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));
    // Fallback to index.html for SPA routing (Express 5 syntax)
    app.use((req, res, next) => {
      if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
        res.sendFile(join(uiDistPath, 'index.html'));
      } else {
        next();
      }
    });
    logger.info('Serving static UI', { path: uiDistPath });
  } else {
    logger.info('UI dist not found, API-only mode', { path: uiDistPath });
  }

  // Create HTTP server
  const server = createServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket client connected');

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'subscribe') {
          if (message.runId) {
            if (!runSubscriptions.has(message.runId)) {
              runSubscriptions.set(message.runId, new Set());
            }
            runSubscriptions.get(message.runId)!.add(ws);
            ws.send(JSON.stringify({ type: 'subscribed', runId: message.runId }));
            logger.info('Client subscribed to run', { runId: message.runId });
          } else if (message.agentId) {
            if (!agentSubscriptions.has(message.agentId)) {
              agentSubscriptions.set(message.agentId, new Set());
            }
            agentSubscriptions.get(message.agentId)!.add(ws);
            ws.send(JSON.stringify({ type: 'subscribed', agentId: message.agentId }));
            logger.info('Client subscribed to agent', { agentId: message.agentId });
          } else if (message.global) {
            globalSubscriptions.add(ws);
            ws.send(JSON.stringify({ type: 'subscribed', global: true }));
            logger.info('Client subscribed to global updates');
          }
        }

        if (message.type === 'unsubscribe') {
          if (message.runId) {
            runSubscriptions.get(message.runId)?.delete(ws);
            ws.send(JSON.stringify({ type: 'unsubscribed', runId: message.runId }));
          } else if (message.agentId) {
            agentSubscriptions.get(message.agentId)?.delete(ws);
            ws.send(JSON.stringify({ type: 'unsubscribed', agentId: message.agentId }));
          } else if (message.global) {
            globalSubscriptions.delete(ws);
            ws.send(JSON.stringify({ type: 'unsubscribed', global: true }));
          }
        }
      } catch (err) {
        logger.error('WebSocket message error', { error: String(err) });
      }
    });

    ws.on('close', () => {
      // Remove from all subscriptions
      for (const clients of runSubscriptions.values()) {
        clients.delete(ws);
      }
      for (const clients of agentSubscriptions.values()) {
        clients.delete(ws);
      }
      globalSubscriptions.delete(ws);
      logger.info('WebSocket client disconnected');
    });
  });

  // Start server
  server.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}`);
    logger.info(`WebSocket available at ws://localhost:${port}/ws`);
    console.log(`\nmcp-debug server running at http://localhost:${port}`);
    console.log(`API: http://localhost:${port}/api/runs`);
    console.log(`WebSocket: ws://localhost:${port}/ws\n`);
  });
}

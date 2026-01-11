const API_BASE = '/api';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  target: string;
  chaos_profile: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  agent_id: string | null;
  name: string | null;
  target: string;
  run_type: 'proxy' | 'stress';
  chaos_profile: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  ended_at: string | null;
  total_calls: number;
  total_errors: number;
  // Stress test stats (only for run_type='stress')
  stress_passed: number;
  stress_graceful: number;
  stress_crashed: number;
  stress_score: number;
  created_at: string;
}

export interface TraceEvent {
  id: number;
  run_id: string;
  event_type: string;
  method: string | null;
  tool_name: string | null;
  params_json: string | null;
  result_json: string | null;
  error_json: string | null;
  latency_ms: number | null;
  timestamp: string;
  chaos_applied: string | null;
}

export interface RunFilters {
  status?: string;
  target?: string;
  limit?: number;
  offset?: number;
}


export const api = {
  projects: {
    list: async (): Promise<{ projects: Project[] }> => {
      const res = await fetch(`${API_BASE}/projects`);
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json();
    },

    get: async (id: string): Promise<{ project: Project }> => {
      const res = await fetch(`${API_BASE}/projects/${id}`);
      if (!res.ok) throw new Error('Failed to fetch project');
      return res.json();
    },

    create: async (data: { name: string; description?: string }): Promise<{ project: Project }> => {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create project');
      return res.json();
    },

    delete: async (id: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete project');
    },

    listAgents: async (projectId: string): Promise<{ agents: Agent[] }> => {
      const res = await fetch(`${API_BASE}/projects/${projectId}/agents`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      return res.json();
    },

    createAgent: async (projectId: string, data: { name: string; target: string; chaosProfile?: object }): Promise<{ agent: Agent }> => {
      const res = await fetch(`${API_BASE}/projects/${projectId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create agent');
      return res.json();
    },
  },

  agents: {
    get: async (id: string): Promise<{ agent: Agent }> => {
      const res = await fetch(`${API_BASE}/agents/${id}`);
      if (!res.ok) throw new Error('Failed to fetch agent');
      return res.json();
    },

    delete: async (id: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/agents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete agent');
    },

    listRuns: async (agentId: string, filters?: { status?: string; limit?: number }): Promise<{ runs: Run[] }> => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.limit) params.set('limit', String(filters.limit));
      const res = await fetch(`${API_BASE}/agents/${agentId}/runs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch runs');
      return res.json();
    },
  },

  runs: {
    list: async (filters?: RunFilters): Promise<{ runs: Run[] }> => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.target) params.set('target', filters.target);
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.offset) params.set('offset', String(filters.offset));

      const res = await fetch(`${API_BASE}/runs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch runs');
      return res.json();
    },

    get: async (id: string): Promise<{ run: Run }> => {
      const res = await fetch(`${API_BASE}/runs/${id}`);
      if (!res.ok) throw new Error('Failed to fetch run');
      return res.json();
    },

    create: async (data: { name?: string; target: string; chaosProfile?: object }): Promise<{ run: Run }> => {
      const res = await fetch(`${API_BASE}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create run');
      return res.json();
    },

    updateStatus: async (id: string, status: Run['status'], stats?: { totalCalls?: number; totalErrors?: number }): Promise<{ run: Run }> => {
      const res = await fetch(`${API_BASE}/runs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...stats }),
      });
      if (!res.ok) throw new Error('Failed to update run');
      return res.json();
    },

    delete: async (id: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/runs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete run');
    },
  },

  traces: {
    getEvents: async (runId: string, limit?: number, offset?: number): Promise<{ events: TraceEvent[]; total: number }> => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (offset) params.set('offset', String(offset));

      const res = await fetch(`${API_BASE}/traces/${runId}/events?${params}`);
      if (!res.ok) throw new Error('Failed to fetch events');
      return res.json();
    },

    getTrace: async (runId: string): Promise<object> => {
      const res = await fetch(`${API_BASE}/traces/${runId}/trace.json`);
      if (!res.ok) throw new Error('Failed to fetch trace');
      return res.json();
    },
  },

  diff: {
    compare: async (baselineId: string, currentId: string): Promise<object> => {
      const res = await fetch(`${API_BASE}/diff?baseline=${baselineId}&current=${currentId}`);
      if (!res.ok) throw new Error('Failed to compare runs');
      return res.json();
    },
  },

  stress: {
    startStress: async (agentId: string): Promise<{ run: Run }> => {
      const res = await fetch(`${API_BASE}/agents/${agentId}/stress`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start stress test');
      return res.json();
    },

    getLatestStress: async (agentId: string): Promise<{ run: Run; events: TraceEvent[] }> => {
      const res = await fetch(`${API_BASE}/agents/${agentId}/stress/latest`);
      if (!res.ok) throw new Error('Failed to fetch latest stress run');
      return res.json();
    },
  },
};

// WebSocket connection for live updates
export type UpdateMessage = {
  type: 'event' | 'run_created' | 'run_updated';
  runId?: string;
  agentId?: string;
  event?: TraceEvent;
  run?: Run;
};

export class LiveConnection {
  private ws: WebSocket | null = null;
  private runListeners: Map<string, Set<(msg: UpdateMessage) => void>> = new Map();
  private agentListeners: Map<string, Set<(msg: UpdateMessage) => void>> = new Map();
  private globalListeners: Set<(msg: UpdateMessage) => void> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      this.ws.onopen = () => {
        // Resubscribe to all existing subscriptions
        for (const runId of this.runListeners.keys()) {
          this.ws?.send(JSON.stringify({ type: 'subscribe', runId }));
        }
        for (const agentId of this.agentListeners.keys()) {
          this.ws?.send(JSON.stringify({ type: 'subscribe', agentId }));
        }
        if (this.globalListeners.size > 0) {
          this.ws?.send(JSON.stringify({ type: 'subscribe', global: true }));
        }
        resolve();
      };
      this.ws.onerror = (err) => reject(err);

      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as UpdateMessage;

          // Dispatch to run listeners
          if (data.runId) {
            const handlers = this.runListeners.get(data.runId);
            if (handlers) {
              for (const handler of handlers) {
                handler(data);
              }
            }
          }

          // Dispatch to agent listeners
          if (data.agentId) {
            const handlers = this.agentListeners.get(data.agentId);
            if (handlers) {
              for (const handler of handlers) {
                handler(data);
              }
            }
          }

          // Dispatch to global listeners
          for (const handler of this.globalListeners) {
            handler(data);
          }
        } catch (e) {
          console.error('WebSocket message error:', e);
        }
      };

      this.ws.onclose = () => {
        // Auto-reconnect after 2 seconds
        this.reconnectTimer = setTimeout(() => {
          this.connect().catch(console.error);
        }, 2000);
      };
    });
  }

  subscribeToRun(runId: string, handler: (msg: UpdateMessage) => void): () => void {
    if (!this.runListeners.has(runId)) {
      this.runListeners.set(runId, new Set());
      this.ws?.send(JSON.stringify({ type: 'subscribe', runId }));
    }
    this.runListeners.get(runId)!.add(handler);

    return () => {
      this.runListeners.get(runId)?.delete(handler);
      if (this.runListeners.get(runId)?.size === 0) {
        this.runListeners.delete(runId);
        this.ws?.send(JSON.stringify({ type: 'unsubscribe', runId }));
      }
    };
  }

  subscribeToAgent(agentId: string, handler: (msg: UpdateMessage) => void): () => void {
    if (!this.agentListeners.has(agentId)) {
      this.agentListeners.set(agentId, new Set());
      this.ws?.send(JSON.stringify({ type: 'subscribe', agentId }));
    }
    this.agentListeners.get(agentId)!.add(handler);

    return () => {
      this.agentListeners.get(agentId)?.delete(handler);
      if (this.agentListeners.get(agentId)?.size === 0) {
        this.agentListeners.delete(agentId);
        this.ws?.send(JSON.stringify({ type: 'unsubscribe', agentId }));
      }
    };
  }

  subscribeGlobal(handler: (msg: UpdateMessage) => void): () => void {
    if (this.globalListeners.size === 0) {
      this.ws?.send(JSON.stringify({ type: 'subscribe', global: true }));
    }
    this.globalListeners.add(handler);

    return () => {
      this.globalListeners.delete(handler);
      if (this.globalListeners.size === 0) {
        this.ws?.send(JSON.stringify({ type: 'unsubscribe', global: true }));
      }
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
    this.runListeners.clear();
    this.agentListeners.clear();
    this.globalListeners.clear();
  }
}

// Singleton instance for app-wide use
export const liveConnection = new LiveConnection();

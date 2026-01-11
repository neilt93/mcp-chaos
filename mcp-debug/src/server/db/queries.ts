import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { TraceEvent } from '../../tracer/types.js';

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

export interface TraceEventRow {
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
  agentId?: string;
  runType?: 'proxy' | 'stress';
  limit?: number;
  offset?: number;
}


export class RunQueries {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ========== Project Methods ==========

  createProject(name: string, description?: string): Project {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, description)
      VALUES (?, ?, ?)
    `);
    stmt.run(id, name, description || null);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    return stmt.get(id) as Project | null;
  }

  getProjectByName(name: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE name = ?');
    return stmt.get(name) as Project | null;
  }

  listProjects(): Project[] {
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
    return stmt.all() as Project[];
  }

  deleteProject(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ========== Agent Methods ==========

  createAgent(projectId: string, name: string, target: string, chaosProfile?: object): Agent {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, project_id, name, target, chaos_profile)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, projectId, name, target, chaosProfile ? JSON.stringify(chaosProfile) : null);
    return this.getAgent(id)!;
  }

  getAgent(id: string): Agent | null {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
    return stmt.get(id) as Agent | null;
  }

  getAgentByName(projectId: string, name: string): Agent | null {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE project_id = ? AND name = ?');
    return stmt.get(projectId, name) as Agent | null;
  }

  listAgents(projectId: string): Agent[] {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE project_id = ? ORDER BY created_at DESC');
    return stmt.all(projectId) as Agent[];
  }

  deleteAgent(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM agents WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ========== Run Methods ==========

  /**
   * Mark any stale "running" runs for an agent as completed.
   * Called before creating a new run to clean up orphaned runs.
   * Only cleans up runs of the same type to avoid affecting legitimately running processes.
   * Also updates total_calls from actual event counts.
   */
  cleanupStaleRuns(agentId?: string, runType?: 'proxy' | 'stress'): number {
    if (!agentId) return 0;

    // First update total_calls from actual event counts for stale runs
    this.db.prepare(`
      UPDATE runs
      SET total_calls = (
        SELECT COUNT(*) FROM trace_events
        WHERE trace_events.run_id = runs.id AND trace_events.event_type = 'tool_call'
      )
      WHERE agent_id = ? AND status = 'running' AND run_type = ?
    `).run(agentId, runType || 'proxy');

    // Then mark as completed (only same run type)
    const stmt = this.db.prepare(`
      UPDATE runs
      SET status = 'completed', ended_at = datetime('now')
      WHERE agent_id = ? AND status = 'running' AND run_type = ?
    `);
    const result = stmt.run(agentId, runType || 'proxy');
    return result.changes;
  }

  createRun(target: string, chaosProfile?: object, agentId?: string, runType: 'proxy' | 'stress' = 'proxy'): Run {
    // Clean up any stale "running" runs of the same type for this agent first
    const cleaned = this.cleanupStaleRuns(agentId, runType);
    if (cleaned > 0) {
      // Log will happen in the caller
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO runs (id, agent_id, target, run_type, chaos_profile, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `);

    stmt.run(id, agentId || null, target, runType, chaosProfile ? JSON.stringify(chaosProfile) : null, now);

    return this.getRun(id)!;
  }

  getRun(id: string): Run | null {
    const stmt = this.db.prepare('SELECT * FROM runs WHERE id = ?');
    return stmt.get(id) as Run | null;
  }

  listRuns(filters: RunFilters = {}): Run[] {
    let sql = 'SELECT * FROM runs WHERE 1=1';
    const params: unknown[] = [];

    if (filters.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filters.agentId);
    }

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.runType) {
      sql += ' AND run_type = ?';
      params.push(filters.runType);
    }

    if (filters.target) {
      sql += ' AND target LIKE ?';
      params.push(`%${filters.target}%`);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Run[];
  }

  updateRunStatus(
    id: string,
    status: Run['status'],
    stats?: { totalCalls?: number; totalErrors?: number }
  ): void {
    let sql = 'UPDATE runs SET status = ?';
    const params: unknown[] = [status];

    if (status === 'running') {
      sql += ', started_at = ?';
      params.push(new Date().toISOString());
    }

    if (status === 'completed' || status === 'failed') {
      sql += ', ended_at = ?';
      params.push(new Date().toISOString());
    }

    if (stats?.totalCalls !== undefined) {
      sql += ', total_calls = ?';
      params.push(stats.totalCalls);
    }

    if (stats?.totalErrors !== undefined) {
      sql += ', total_errors = ?';
      params.push(stats.totalErrors);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }

  deleteRun(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM runs WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  insertTraceEvent(runId: string, event: TraceEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO trace_events (
        run_id, event_type, method, tool_name, params_json,
        result_json, error_json, latency_ms, timestamp, chaos_applied
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let method: string | null = null;
    let toolName: string | null = null;
    let params: string | null = null;
    let result: string | null = null;
    let error: string | null = null;
    let latency: number | null = null;
    let chaos: string | null = null;

    if (event.t === 'rpc_request') {
      method = event.method;
      params = event.params ? JSON.stringify(event.params) : null;
    } else if (event.t === 'rpc_response') {
      result = event.result ? JSON.stringify(event.result) : null;
      error = event.error ? JSON.stringify(event.error) : null;
      latency = event.latencyMs ?? null;
    } else if (event.t === 'tool_call') {
      toolName = event.tool;
      params = event.args ? JSON.stringify(event.args) : null;
    } else if (event.t === 'tool_result') {
      result = event.result ? JSON.stringify(event.result) : null;
      error = event.error ? JSON.stringify(event.error) : null;
      latency = event.latencyMs;
      chaos = event.chaos ? JSON.stringify(event.chaos) : null;
    } else if (event.t === 'stress_mutation') {
      toolName = event.tool;
      // Store mutation details and outcome in params_json
      params = JSON.stringify({
        mutation: event.mutation,
        outcome: event.outcome,
      });
      result = event.result ? JSON.stringify(event.result) : null;
      error = event.error ? JSON.stringify(event.error) : null;
      latency = event.latencyMs;
    } else if (event.t === 'chat_message') {
      // Store chat message with role and content
      params = JSON.stringify({
        role: event.role,
        content: event.content,
        toolCalls: event.toolCalls,
      });
    }

    stmt.run(
      runId,
      event.t,
      method,
      toolName,
      params,
      result,
      error,
      latency,
      event.ts,
      chaos
    );
  }

  getRunEvents(runId: string, limit?: number, offset?: number): TraceEventRow[] {
    let sql = 'SELECT * FROM trace_events WHERE run_id = ? ORDER BY id ASC';
    const params: unknown[] = [runId];

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    if (offset) {
      sql += ' OFFSET ?';
      params.push(offset);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as TraceEventRow[];
  }

  getRunEventCount(runId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM trace_events WHERE run_id = ?');
    const result = stmt.get(runId) as { count: number };
    return result.count;
  }

  // ========== Stress Stats Methods ==========

  updateStressStats(
    runId: string,
    stats: { passed: number; graceful: number; crashed: number; score: number }
  ): void {
    const stmt = this.db.prepare(`
      UPDATE runs SET
        stress_passed = ?,
        stress_graceful = ?,
        stress_crashed = ?,
        stress_score = ?,
        total_calls = ?
      WHERE id = ?
    `);
    const totalCalls = stats.passed + stats.graceful + stats.crashed;
    stmt.run(stats.passed, stats.graceful, stats.crashed, stats.score, totalCalls, runId);
  }

  getLatestStressRun(agentId: string): Run | null {
    const stmt = this.db.prepare(`
      SELECT * FROM runs
      WHERE agent_id = ? AND run_type = 'stress'
      ORDER BY created_at DESC LIMIT 1
    `);
    return stmt.get(agentId) as Run | null;
  }
}

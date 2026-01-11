import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../../data/mcp-debug.db');

export function initDatabase(): Database.Database {
  // Ensure data directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    -- Projects group related agents
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Agents are configured MCP servers within a project
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target TEXT NOT NULL,
      chaos_profile TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    );

    -- Runs are recorded sessions for an agent
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      name TEXT,
      target TEXT NOT NULL,
      run_type TEXT NOT NULL DEFAULT 'proxy',
      chaos_profile TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      ended_at TEXT,
      total_calls INTEGER DEFAULT 0,
      total_errors INTEGER DEFAULT 0,
      -- Stress test stats (only populated for stress runs)
      stress_passed INTEGER DEFAULT 0,
      stress_graceful INTEGER DEFAULT 0,
      stress_crashed INTEGER DEFAULT 0,
      stress_score INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      method TEXT,
      tool_name TEXT,
      params_json TEXT,
      result_json TEXT,
      error_json TEXT,
      latency_ms INTEGER,
      timestamp TEXT NOT NULL,
      chaos_applied TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_type ON runs(run_type);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_run ON trace_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_events_method ON trace_events(method);
    CREATE INDEX IF NOT EXISTS idx_events_tool ON trace_events(tool_name);
  `);

  return db;
}

export type { Database };

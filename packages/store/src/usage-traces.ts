import type { DatabaseSync } from "node:sqlite";
import type { UsageTraceV2 } from "@component-atlas/core";

interface JsonRow {
  payload: string;
}

export function migrateUsageTraces(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_traces_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      state TEXT NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS usage_traces_v2_session
      ON usage_traces_v2(project_id, session_id_hash);
    CREATE INDEX IF NOT EXISTS usage_traces_v2_project
      ON usage_traces_v2(project_id, updated_at DESC);
  `);
}

export function saveUsageTrace(
  database: DatabaseSync,
  trace: UsageTraceV2,
  retention = 2_000,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO usage_traces_v2 (
        id, project_id, session_id_hash, updated_at, state, source, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, session_id_hash) DO UPDATE SET
        id = excluded.id,
        updated_at = excluded.updated_at,
        state = excluded.state,
        source = excluded.source,
        payload = excluded.payload
    `).run(
      trace.id,
      trace.projectId,
      trace.sessionIdHash,
      trace.updatedAt,
      trace.state,
      trace.source,
      JSON.stringify(trace),
    );
    database.prepare(`
      DELETE FROM usage_traces_v2
      WHERE project_id = ? AND id NOT IN (
        SELECT id FROM usage_traces_v2
        WHERE project_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      )
    `).run(trace.projectId, trace.projectId, Math.max(1, Math.min(retention, 5_000)));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listUsageTraces(
  database: DatabaseSync,
  projectId: string,
  limit = 100,
): UsageTraceV2[] {
  const rows = database.prepare(`
    SELECT payload FROM usage_traces_v2
    WHERE project_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(projectId, Math.max(1, Math.min(limit, 5_000))) as unknown as JsonRow[];
  return rows.map((row) => JSON.parse(row.payload) as UsageTraceV2);
}

export function findUsageTrace(
  database: DatabaseSync,
  projectId: string,
  sessionIdHash: string,
): UsageTraceV2 | undefined {
  const row = database.prepare(`
    SELECT payload FROM usage_traces_v2
    WHERE project_id = ? AND session_id_hash = ?
    LIMIT 1
  `).get(projectId, sessionIdHash) as unknown as JsonRow | undefined;
  return row ? JSON.parse(row.payload) as UsageTraceV2 : undefined;
}

export function clearUsageTraces(
  database: DatabaseSync,
  projectId: string,
): number {
  return Number(
    database.prepare("DELETE FROM usage_traces_v2 WHERE project_id = ?")
      .run(projectId).changes,
  );
}

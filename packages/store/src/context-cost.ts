import type { DatabaseSync } from "node:sqlite";
import type { ContextCostAuditRecord } from "@component-atlas/core";

interface JsonRow {
  payload: string;
}

export function migrateContextCostAudits(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS context_cost_audits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      task_type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS context_cost_audits_project
      ON context_cost_audits(project_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS context_cost_audits_task_type
      ON context_cost_audits(project_id, task_type, recorded_at DESC);
  `);
}

export function saveContextCostAudit(
  database: DatabaseSync,
  record: ContextCostAuditRecord,
  retention = 500,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(`
        INSERT INTO context_cost_audits (
          id, project_id, recorded_at, task_type, payload
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          recorded_at = excluded.recorded_at,
          task_type = excluded.task_type,
          payload = excluded.payload
      `)
      .run(
        record.id,
        record.projectId,
        record.recordedAt,
        record.taskType,
        JSON.stringify(record),
      );
    database
      .prepare(`
        DELETE FROM context_cost_audits
        WHERE project_id = ? AND id NOT IN (
          SELECT id FROM context_cost_audits
          WHERE project_id = ?
          ORDER BY recorded_at DESC
          LIMIT ?
        )
      `)
      .run(record.projectId, record.projectId, Math.max(1, Math.min(retention, 2_000)));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listContextCostAudits(
  database: DatabaseSync,
  projectId: string,
  limit = 100,
): ContextCostAuditRecord[] {
  const rows = database
    .prepare(`
      SELECT payload FROM context_cost_audits
      WHERE project_id = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `)
    .all(projectId, Math.max(1, Math.min(limit, 2_000))) as unknown as JsonRow[];
  return rows.map((row) => JSON.parse(row.payload) as ContextCostAuditRecord);
}

export function clearContextCostAudits(
  database: DatabaseSync,
  projectId: string,
): number {
  return Number(
    database
      .prepare("DELETE FROM context_cost_audits WHERE project_id = ?")
      .run(projectId).changes,
  );
}

import type { DatabaseSync } from "node:sqlite";
import type {
  ActionResolution,
  TaskEvaluationRecord,
} from "@component-atlas/core";

interface JsonRow {
  payload: string;
}

export function saveTaskEvaluation(
  database: DatabaseSync,
  record: TaskEvaluationRecord,
  retention = 50,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO task_evaluations (id, project_id, recorded_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
    `).run(record.id, record.projectId, record.recordedAt, JSON.stringify(record));
    database.prepare(`
      DELETE FROM task_evaluations
      WHERE project_id = ? AND id NOT IN (
        SELECT id FROM task_evaluations WHERE project_id = ?
        ORDER BY recorded_at DESC LIMIT ?
      )
    `).run(record.projectId, record.projectId, retention);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listTaskEvaluations(
  database: DatabaseSync,
  projectId: string,
  limit = 20,
): TaskEvaluationRecord[] {
  const rows = database.prepare(`
    SELECT payload FROM task_evaluations WHERE project_id = ?
    ORDER BY recorded_at DESC LIMIT ?
  `).all(projectId, Math.max(1, Math.min(limit, 50))) as unknown as JsonRow[];
  return rows.map((row) => JSON.parse(row.payload) as TaskEvaluationRecord);
}

export function clearTaskEvaluations(
  database: DatabaseSync,
  projectId: string,
): number {
  return Number(
    database.prepare("DELETE FROM task_evaluations WHERE project_id = ?")
      .run(projectId).changes,
  );
}

export function saveActionResolutions(
  database: DatabaseSync,
  resolutions: ActionResolution[],
): ActionResolution[] {
  database.exec("BEGIN IMMEDIATE");
  try {
    const select = database.prepare(`
      SELECT payload FROM action_resolutions
      WHERE project_id = ? AND checkout_id = ? AND idempotency_key = ?
    `);
    const insert = database.prepare(`
      INSERT INTO action_resolutions (
        id, project_id, checkout_id, item_id, resolved_at,
        idempotency_key, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const saved = resolutions.map((resolution) => {
      const existing = select.get(
        resolution.projectId,
        resolution.checkoutId,
        resolution.idempotencyKey,
      ) as JsonRow | undefined;
      if (existing) return JSON.parse(existing.payload) as ActionResolution;
      insert.run(
        resolution.id,
        resolution.projectId,
        resolution.checkoutId,
        resolution.itemId,
        resolution.resolvedAt,
        resolution.idempotencyKey,
        JSON.stringify(resolution),
      );
      return resolution;
    });
    database.exec("COMMIT");
    return saved;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listActionResolutions(
  database: DatabaseSync,
  projectId: string,
  checkoutId: string,
  limit = 500,
): ActionResolution[] {
  const rows = database.prepare(`
    SELECT payload FROM action_resolutions
    WHERE project_id = ? AND checkout_id = ?
    ORDER BY resolved_at DESC LIMIT ?
  `).all(
    projectId,
    checkoutId,
    Math.max(1, Math.min(limit, 1_000)),
  ) as unknown as JsonRow[];
  return rows.map((row) => JSON.parse(row.payload) as ActionResolution);
}

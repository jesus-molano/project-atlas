import type { DatabaseSync } from "node:sqlite";
import type { FrontendEntity } from "@component-atlas/core";

interface JsonRow {
  payload: string;
}

export function migrateSemanticNodes(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS semantic_nodes (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_path TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY(project_id, id)
    );
    CREATE INDEX IF NOT EXISTS semantic_nodes_kind
      ON semantic_nodes(project_id, kind, source_path);
  `);
}

export function replaceSemanticNodes(
  database: DatabaseSync,
  projectId: string,
  entities: FrontendEntity[],
): void {
  database
    .prepare("DELETE FROM semantic_nodes WHERE project_id = ?")
    .run(projectId);
  const insert = database.prepare(`
    INSERT INTO semantic_nodes (id, project_id, kind, source_path, payload)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const entity of entities) {
    insert.run(
      entity.id,
      projectId,
      entity.kind,
      entity.relativePath,
      JSON.stringify(entity),
    );
  }
}

export function loadSemanticNodes(
  database: DatabaseSync,
  projectId: string,
): FrontendEntity[] {
  const rows = database
    .prepare(
      "SELECT payload FROM semantic_nodes WHERE project_id = ? ORDER BY kind, source_path, id",
    )
    .all(projectId) as unknown as JsonRow[];
  return rows.map((row) => JSON.parse(row.payload) as FrontendEntity);
}

import type { DatabaseSync } from "node:sqlite";
import type { DesignLinkRecord } from "@component-atlas/design";

interface JsonRow {
  payload: string;
}

export function migrateDesignLinks(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS design_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_key TEXT NOT NULL,
      node_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      source TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS design_links_node
      ON design_links(project_id, file_key, node_id, scope, created_at DESC);
  `);
}

export function saveDesignLink(
  database: DatabaseSync,
  link: DesignLinkRecord,
): void {
  const existing = database
    .prepare(`
      SELECT payload FROM design_links
      WHERE project_id = ? AND file_key = ? AND node_id = ? AND scope = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(link.projectId, link.fileKey, link.nodeId, link.scope) as
    | JsonRow
    | undefined;
  if (existing) {
    const current = JSON.parse(existing.payload) as DesignLinkRecord;
    if (current.componentId !== link.componentId) {
      throw new Error(
        `Design link conflict for ${link.fileKey}:${link.nodeId}; explicit resolution is required.`,
      );
    }
    if (
      current.source === "code-connect-exact" &&
      link.source !== "code-connect-exact"
    ) {
      return;
    }
  }
  database
    .prepare(`
      INSERT INTO design_links (
        id, project_id, file_key, node_id, component_id, source, scope,
        created_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        component_id = excluded.component_id,
        source = excluded.source,
        created_at = excluded.created_at,
        payload = excluded.payload
    `)
    .run(
      link.id,
      link.projectId,
      link.fileKey,
      link.nodeId,
      link.componentId,
      link.source,
      link.scope,
      link.createdAt,
      JSON.stringify(link),
    );
}

export function listDesignLinks(
  database: DatabaseSync,
  projectId: string,
  fileKey?: string,
): DesignLinkRecord[] {
  const rows = fileKey
    ? (database
        .prepare(`
          SELECT payload FROM design_links
          WHERE project_id = ? AND file_key = ?
          ORDER BY created_at DESC
        `)
        .all(projectId, fileKey) as unknown as JsonRow[])
    : (database
        .prepare(`
          SELECT payload FROM design_links
          WHERE project_id = ?
          ORDER BY created_at DESC
        `)
        .all(projectId) as unknown as JsonRow[]);
  return rows.map((row) => JSON.parse(row.payload) as DesignLinkRecord);
}

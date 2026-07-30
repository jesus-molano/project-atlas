import type { DatabaseSync } from "node:sqlite";
import type { ProjectThemeFingerprint } from "@component-atlas/core";

interface JsonRow {
  payload: string;
}

export function migrateThemeFingerprints(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS theme_fingerprints (
      project_id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      fingerprint_hash TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
}

export function saveThemeFingerprint(
  database: DatabaseSync,
  projectId: string,
  fingerprint: ProjectThemeFingerprint | undefined,
): void {
  if (!fingerprint) {
    database
      .prepare("DELETE FROM theme_fingerprints WHERE project_id = ?")
      .run(projectId);
    return;
  }
  database
    .prepare(`
      INSERT INTO theme_fingerprints (
        project_id, generated_at, fingerprint_hash, payload
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        generated_at = excluded.generated_at,
        fingerprint_hash = excluded.fingerprint_hash,
        payload = excluded.payload
    `)
    .run(
      projectId,
      fingerprint.generatedAt,
      fingerprint.hash,
      JSON.stringify(fingerprint),
    );
}

export function loadThemeFingerprint(
  database: DatabaseSync,
  projectId: string,
): ProjectThemeFingerprint | undefined {
  const row = database
    .prepare("SELECT payload FROM theme_fingerprints WHERE project_id = ?")
    .get(projectId) as JsonRow | undefined;
  return row
    ? (JSON.parse(row.payload) as ProjectThemeFingerprint)
    : undefined;
}

import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentDecision,
  type ComponentGraph,
  type ComponentNode,
  type Framework,
  type GraphEdge,
  type ProjectMetadata,
} from "@component-atlas/core";

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  framework: Framework;
  package_manager: string | null;
  scanned_at: string;
  source_files: number;
}

interface JsonRow {
  payload: string;
}

function applicationDataRoot(): string {
  if (process.env.COMPONENT_ATLAS_HOME) {
    return path.resolve(process.env.COMPONENT_ATLAS_HOME);
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "ComponentAtlas");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "ComponentAtlas");
  }
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "component-atlas",
  );
}

export function databasePath(projectId: string): string {
  return path.join(applicationDataRoot(), "projects", projectId, "atlas.sqlite");
}

export class AtlasStore {
  readonly filePath: string;
  readonly database: DatabaseSync;

  constructor(projectId: string) {
    this.filePath = databasePath(projectId);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.database = new DatabaseSync(this.filePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        framework TEXT NOT NULL,
        package_manager TEXT,
        scanned_at TEXT NOT NULL,
        source_files INTEGER NOT NULL,
        schema_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS components (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        effective_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        visibility TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS components_name
        ON components(project_id, name, effective_name);
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS edges_source ON edges(project_id, source, kind);
      CREATE INDEX IF NOT EXISTS edges_target ON edges(project_id, target, kind);
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decision TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  }

  replaceGraph(graph: ComponentGraph): void {
    const projectStatement = this.database.prepare(`
      INSERT INTO project (
        id, name, root_path, framework, package_manager, scanned_at,
        source_files, schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        root_path = excluded.root_path,
        framework = excluded.framework,
        package_manager = excluded.package_manager,
        scanned_at = excluded.scanned_at,
        source_files = excluded.source_files,
        schema_version = excluded.schema_version
    `);
    const componentStatement = this.database.prepare(`
      INSERT INTO components (
        id, project_id, name, effective_name, relative_path, visibility, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const edgeStatement = this.database.prepare(`
      INSERT INTO edges (id, project_id, kind, source, target, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      projectStatement.run(
        graph.project.id,
        graph.project.name,
        graph.project.rootPath,
        graph.project.framework,
        graph.project.packageManager ?? null,
        graph.project.scannedAt,
        graph.project.sourceFiles,
        graph.schemaVersion,
      );
      this.database
        .prepare("DELETE FROM components WHERE project_id = ?")
        .run(graph.project.id);
      this.database.prepare("DELETE FROM edges WHERE project_id = ?").run(graph.project.id);
      for (const component of graph.components) {
        componentStatement.run(
          component.id,
          graph.project.id,
          component.name,
          component.effectiveName,
          component.relativePath,
          component.visibility,
          JSON.stringify(component),
        );
      }
      for (const edge of graph.edges) {
        edgeStatement.run(
          edge.id,
          graph.project.id,
          edge.kind,
          edge.source,
          edge.target,
          JSON.stringify(edge),
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadGraph(projectId: string): ComponentGraph | undefined {
    const project = this.database
      .prepare("SELECT * FROM project WHERE id = ?")
      .get(projectId) as ProjectRow | undefined;
    if (!project) return undefined;
    const components = this.database
      .prepare("SELECT payload FROM components WHERE project_id = ? ORDER BY name")
      .all(projectId) as unknown as JsonRow[];
    const edges = this.database
      .prepare("SELECT payload FROM edges WHERE project_id = ? ORDER BY kind, source")
      .all(projectId) as unknown as JsonRow[];
    const metadata: ProjectMetadata = {
      id: project.id,
      name: project.name,
      rootPath: project.root_path,
      framework: project.framework,
      scannedAt: project.scanned_at,
      sourceFiles: project.source_files,
      ...(project.package_manager
        ? { packageManager: project.package_manager }
        : {}),
    };
    return {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: metadata,
      components: components.map((row) => JSON.parse(row.payload) as ComponentNode),
      edges: edges.map((row) => JSON.parse(row.payload) as GraphEdge),
    };
  }

  saveDecision(decision: ComponentDecision): void {
    this.database
      .prepare(`
        INSERT INTO decisions (id, project_id, created_at, decision, payload)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
      `)
      .run(
        decision.id,
        decision.projectId,
        decision.createdAt,
        decision.decision,
        JSON.stringify(decision),
      );
  }

  listDecisions(projectId: string): ComponentDecision[] {
    const rows = this.database
      .prepare(
        "SELECT payload FROM decisions WHERE project_id = ? ORDER BY created_at DESC",
      )
      .all(projectId) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.payload) as ComponentDecision);
  }

  close(): void {
    this.database.close();
  }
}

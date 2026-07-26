import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentDecision,
  type ComponentGraph,
  type ComponentNode,
  type DesignToken,
  type Framework,
  type GraphEdge,
  type ProjectMetadata,
  type ProjectCapabilityReport,
  type ProjectScanState,
  type TaskEvaluationRecord,
} from "@component-atlas/core";
import {
  normalizeDesignIndex,
  type DesignFileIndex,
} from "@component-atlas/design";
import type {
  MemoryItem,
  MemoryProposal,
  MemoryStatus,
  MemoryType,
} from "@component-atlas/memory";

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

interface MemoryCountRow {
  count: number;
}

export interface AtlasStoredSnapshot {
  graph: ComponentGraph | undefined;
  designIndexes: DesignFileIndex[];
  memoryItems: MemoryItem[];
  memoryProposals: MemoryProposal[];
  componentDecisions: ComponentDecision[];
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

export function databaseExists(projectId: string): boolean {
  return existsSync(databasePath(projectId));
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
      CREATE TABLE IF NOT EXISTS tokens (
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, name)
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decision TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS design_indexes (
        project_id TEXT NOT NULL,
        file_key TEXT NOT NULL,
        version TEXT,
        last_modified TEXT,
        indexed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, file_key)
      );
      CREATE INDEX IF NOT EXISTS design_indexes_project
        ON design_indexes(project_id, indexed_at);
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        authority TEXT NOT NULL,
        confidence REAL NOT NULL,
        scope TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        review_after TEXT,
        origin TEXT NOT NULL,
        source_path TEXT,
        source_hash TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_items_project
        ON memory_items(project_id, status, type, updated_at);
      CREATE INDEX IF NOT EXISTS memory_items_source
        ON memory_items(project_id, origin, source_path);
      CREATE TABLE IF NOT EXISTS memory_relations (
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, source_id, kind, target_id)
      );
      CREATE INDEX IF NOT EXISTS memory_relations_target
        ON memory_relations(project_id, target_id, kind);
      CREATE TABLE IF NOT EXISTS memory_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_proposals_project
        ON memory_proposals(project_id, status, created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        project_id UNINDEXED,
        title,
        summary,
        body,
        tags
      );
      CREATE TABLE IF NOT EXISTS checkout_graphs (
        project_id TEXT NOT NULL,
        checkout_id TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, checkout_id)
      );
      CREATE TABLE IF NOT EXISTS scan_states (
        project_id TEXT NOT NULL,
        checkout_id TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, checkout_id)
      );
      CREATE TABLE IF NOT EXISTS capability_reports (
        project_id TEXT PRIMARY KEY,
        checked_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_evaluations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_evaluations_project
        ON task_evaluations(project_id, recorded_at DESC);
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
    const tokenStatement = this.database.prepare(`
      INSERT INTO tokens (project_id, name, payload)
      VALUES (?, ?, ?)
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
      this.database.prepare("DELETE FROM tokens WHERE project_id = ?").run(graph.project.id);
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
      for (const token of graph.tokens) {
        tokenStatement.run(graph.project.id, token.name, JSON.stringify(token));
      }
      if (graph.project.identity?.checkoutId) {
        this.database
          .prepare(`
            INSERT INTO checkout_graphs (
              project_id, checkout_id, scanned_at, payload
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(project_id, checkout_id) DO UPDATE SET
              scanned_at = excluded.scanned_at,
              payload = excluded.payload
          `)
          .run(
            graph.project.id,
            graph.project.identity.checkoutId,
            graph.project.scannedAt,
            JSON.stringify(graph),
          );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadGraph(projectId: string, checkoutId?: string): ComponentGraph | undefined {
    if (checkoutId) {
      const checkout = this.database
        .prepare(
          "SELECT payload FROM checkout_graphs WHERE project_id = ? AND checkout_id = ?",
        )
        .get(projectId, checkoutId) as JsonRow | undefined;
      return checkout
        ? (JSON.parse(checkout.payload) as ComponentGraph)
        : undefined;
    }
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
    const tokens = this.database
      .prepare("SELECT payload FROM tokens WHERE project_id = ? ORDER BY name")
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
      tokens: tokens.map((row) => JSON.parse(row.payload) as DesignToken),
    };
  }

  saveScanState(state: ProjectScanState): void {
    this.database
      .prepare(`
        INSERT INTO scan_states (
          project_id, checkout_id, completed_at, payload
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, checkout_id) DO UPDATE SET
          completed_at = excluded.completed_at,
          payload = excluded.payload
      `)
      .run(
        state.projectId,
        state.checkoutId,
        state.completedAt,
        JSON.stringify(state),
      );
  }

  loadScanState(
    projectId: string,
    checkoutId: string,
  ): ProjectScanState | undefined {
    const row = this.database
      .prepare(
        "SELECT payload FROM scan_states WHERE project_id = ? AND checkout_id = ?",
      )
      .get(projectId, checkoutId) as JsonRow | undefined;
    return row ? (JSON.parse(row.payload) as ProjectScanState) : undefined;
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

  readProjectSnapshot(projectId: string, checkoutId?: string): AtlasStoredSnapshot {
    this.database.exec("BEGIN");
    try {
      const snapshot = {
        graph: this.loadGraph(projectId, checkoutId),
        designIndexes: this.listDesignIndexes(projectId),
        memoryItems: this.listMemoryItems(projectId),
        memoryProposals: this.listMemoryProposals(projectId),
        componentDecisions: this.listDecisions(projectId),
      };
      this.database.exec("COMMIT");
      return snapshot;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  saveCapabilityReport(report: ProjectCapabilityReport): void {
    if (
      report.observations.length > 32 ||
      report.observations.some((item) => item.checkedAt !== report.checkedAt)
    ) {
      throw new Error("Capability report is invalid or exceeds its bounded size.");
    }
    this.database
      .prepare(`
        INSERT INTO capability_reports (project_id, checked_at, payload)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          checked_at = excluded.checked_at,
          payload = excluded.payload
      `)
      .run(report.projectId, report.checkedAt, JSON.stringify(report));
  }

  loadCapabilityReport(projectId: string): ProjectCapabilityReport | undefined {
    const row = this.database
      .prepare("SELECT payload FROM capability_reports WHERE project_id = ?")
      .get(projectId) as JsonRow | undefined;
    return row ? (JSON.parse(row.payload) as ProjectCapabilityReport) : undefined;
  }

  saveTaskEvaluation(record: TaskEvaluationRecord, retention = 50): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO task_evaluations (
            id, project_id, recorded_at, payload
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
        `)
        .run(
          record.id,
          record.projectId,
          record.recordedAt,
          JSON.stringify(record),
        );
      this.database
        .prepare(`
          DELETE FROM task_evaluations
          WHERE project_id = ? AND id NOT IN (
            SELECT id FROM task_evaluations
            WHERE project_id = ?
            ORDER BY recorded_at DESC
            LIMIT ?
          )
        `)
        .run(record.projectId, record.projectId, retention);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listTaskEvaluations(projectId: string, limit = 20): TaskEvaluationRecord[] {
    const rows = this.database
      .prepare(`
        SELECT payload FROM task_evaluations
        WHERE project_id = ?
        ORDER BY recorded_at DESC
        LIMIT ?
      `)
      .all(projectId, Math.max(1, Math.min(limit, 50))) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.payload) as TaskEvaluationRecord);
  }

  clearTaskEvaluations(projectId: string): number {
    return Number(
      this.database
        .prepare("DELETE FROM task_evaluations WHERE project_id = ?")
        .run(projectId).changes,
    );
  }

  saveDesignIndex(projectId: string, index: DesignFileIndex): void {
    this.database
      .prepare(`
        INSERT INTO design_indexes (
          project_id, file_key, version, last_modified, indexed_at, payload
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, file_key) DO UPDATE SET
          version = excluded.version,
          last_modified = excluded.last_modified,
          indexed_at = excluded.indexed_at,
          payload = excluded.payload
      `)
      .run(
        projectId,
        index.file.key,
        index.file.version ?? null,
        index.file.lastModified ?? null,
        index.indexedAt,
        JSON.stringify(index),
      );
  }

  loadDesignIndex(
    projectId: string,
    fileKey: string,
  ): DesignFileIndex | undefined {
    const row = this.database
      .prepare(
        "SELECT payload FROM design_indexes WHERE project_id = ? AND file_key = ?",
      )
      .get(projectId, fileKey) as JsonRow | undefined;
    return row
      ? normalizeDesignIndex(JSON.parse(row.payload) as DesignFileIndex)
      : undefined;
  }

  listDesignIndexes(projectId: string): DesignFileIndex[] {
    const rows = this.database
      .prepare(
        "SELECT payload FROM design_indexes WHERE project_id = ? ORDER BY indexed_at DESC",
      )
      .all(projectId) as unknown as JsonRow[];
    return rows.map((row) =>
      normalizeDesignIndex(JSON.parse(row.payload) as DesignFileIndex),
    );
  }

  private rebuildMemoryFts(projectId: string): void {
    this.database
      .prepare("DELETE FROM memory_fts WHERE project_id = ?")
      .run(projectId);
    const items = this.listMemoryItems(projectId);
    const insert = this.database.prepare(`
      INSERT INTO memory_fts (id, project_id, title, summary, body, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insert.run(
        item.id,
        projectId,
        item.title,
        item.summary,
        item.body ?? "",
        item.tags.join(" "),
      );
    }
  }

  private writeMemoryItem(
    projectId: string,
    item: MemoryItem,
    origin: string,
    sourceHash?: string,
  ): void {
    if (item.projectId !== projectId) {
      throw new Error(
        `Memory item ${item.id} belongs to a different project scope.`,
      );
    }
    this.database
      .prepare(`
        INSERT INTO memory_items (
          id, project_id, namespace, type, title, summary, status, authority,
          confidence, scope, updated_at, review_after, origin, source_path,
          source_hash, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          namespace = excluded.namespace,
          type = excluded.type,
          title = excluded.title,
          summary = excluded.summary,
          status = excluded.status,
          authority = excluded.authority,
          confidence = excluded.confidence,
          scope = excluded.scope,
          updated_at = excluded.updated_at,
          review_after = excluded.review_after,
          origin = excluded.origin,
          source_path = excluded.source_path,
          source_hash = excluded.source_hash,
          payload = excluded.payload
      `)
      .run(
        item.id,
        projectId,
        item.namespace,
        item.type,
        item.title,
        item.summary,
        item.status,
        item.authority,
        item.confidence,
        item.scope,
        item.updatedAt,
        item.reviewAfter ?? null,
        origin,
        item.bodyPath ?? null,
        sourceHash ?? null,
        JSON.stringify(item),
      );
    this.database
      .prepare("DELETE FROM memory_relations WHERE project_id = ? AND source_id = ?")
      .run(projectId, item.id);
    const relationStatement = this.database.prepare(`
      INSERT INTO memory_relations (
        project_id, source_id, kind, target_id, payload
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const relation of item.relations) {
      relationStatement.run(
        projectId,
        item.id,
        relation.kind,
        relation.targetId,
        JSON.stringify(relation),
      );
    }
  }

  replaceMarkdownMemory(
    projectId: string,
    items: Array<{ item: MemoryItem; sourceHash: string }>,
  ): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const stale = this.database
        .prepare(
          "SELECT id FROM memory_items WHERE project_id = ? AND origin = 'markdown'",
        )
        .all(projectId) as unknown as Array<{ id: string }>;
      for (const row of stale) {
        this.database
          .prepare(
            "DELETE FROM memory_relations WHERE project_id = ? AND source_id = ?",
          )
          .run(projectId, row.id);
      }
      this.database
        .prepare(
          "DELETE FROM memory_items WHERE project_id = ? AND origin = 'markdown'",
        )
        .run(projectId);
      for (const entry of items) {
        this.writeMemoryItem(
          projectId,
          entry.item,
          "markdown",
          entry.sourceHash,
        );
      }
      this.rebuildMemoryFts(projectId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  saveMemoryItem(
    projectId: string,
    item: MemoryItem,
    origin = "confirmed",
  ): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.writeMemoryItem(projectId, item, origin);
      this.rebuildMemoryFts(projectId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadMemoryItem(projectId: string, id: string): MemoryItem | undefined {
    const row = this.database
      .prepare(
        "SELECT payload FROM memory_items WHERE project_id = ? AND id = ?",
      )
      .get(projectId, id) as JsonRow | undefined;
    return row ? (JSON.parse(row.payload) as MemoryItem) : undefined;
  }

  listMemoryItems(projectId: string): MemoryItem[] {
    const rows = this.database
      .prepare(
        "SELECT payload FROM memory_items WHERE project_id = ? ORDER BY updated_at DESC, id",
      )
      .all(projectId) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.payload) as MemoryItem);
  }

  searchMemoryCandidates(
    projectId: string,
    query: string,
    limit = 100,
  ): MemoryItem[] {
    const terms = query
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .match(/[A-Za-z0-9]{2,}/g)
      ?.slice(0, 12);
    if (!terms || terms.length === 0) {
      return this.listMemoryItems(projectId).slice(0, limit);
    }
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ");
    try {
      const rows = this.database
        .prepare(`
          SELECT items.payload
          FROM memory_fts
          JOIN memory_items AS items
            ON items.project_id = memory_fts.project_id
           AND items.id = memory_fts.id
          WHERE memory_fts MATCH ? AND items.project_id = ?
          ORDER BY bm25(memory_fts)
          LIMIT ?
        `)
        .all(match, projectId, limit) as unknown as JsonRow[];
      return rows.map((row) => JSON.parse(row.payload) as MemoryItem);
    } catch {
      return this.listMemoryItems(projectId).slice(0, limit);
    }
  }

  memoryCounts(projectId: string): {
    total: number;
    active: number;
    proposed: number;
    superseded: number;
    byType: Partial<Record<MemoryType, number>>;
    byStatus: Partial<Record<MemoryStatus, number>>;
  } {
    const totalRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM memory_items WHERE project_id = ?")
      .get(projectId) as unknown as MemoryCountRow;
    const grouped = this.database
      .prepare(
        "SELECT type, status, COUNT(*) AS count FROM memory_items WHERE project_id = ? GROUP BY type, status",
      )
      .all(projectId) as unknown as Array<{
        type: MemoryType;
        status: MemoryStatus;
        count: number;
      }>;
    const byType: Partial<Record<MemoryType, number>> = {};
    const byStatus: Partial<Record<MemoryStatus, number>> = {};
    for (const row of grouped) {
      byType[row.type] = (byType[row.type] ?? 0) + row.count;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
    }
    return {
      total: totalRow.count,
      active: byStatus.active ?? 0,
      proposed: byStatus.proposed ?? 0,
      superseded: byStatus.superseded ?? 0,
      byType,
      byStatus,
    };
  }

  saveMemoryProposal(proposal: MemoryProposal): void {
    this.database
      .prepare(`
        INSERT INTO memory_proposals (
          id, project_id, status, created_at, payload
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          payload = excluded.payload
      `)
      .run(
        proposal.id,
        proposal.projectId,
        proposal.status,
        proposal.createdAt,
        JSON.stringify(proposal),
      );
  }

  loadMemoryProposal(
    projectId: string,
    proposalId: string,
  ): MemoryProposal | undefined {
    const row = this.database
      .prepare(
        "SELECT payload FROM memory_proposals WHERE project_id = ? AND id = ?",
      )
      .get(projectId, proposalId) as JsonRow | undefined;
    return row ? (JSON.parse(row.payload) as MemoryProposal) : undefined;
  }

  listMemoryProposals(
    projectId: string,
    status?: MemoryProposal["status"],
  ): MemoryProposal[] {
    const rows = (
      status
        ? this.database
            .prepare(
              "SELECT payload FROM memory_proposals WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
            )
            .all(projectId, status)
        : this.database
            .prepare(
              "SELECT payload FROM memory_proposals WHERE project_id = ? ORDER BY created_at DESC",
            )
            .all(projectId)
    ) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.payload) as MemoryProposal);
  }

  close(): void {
    this.database.close();
  }
}

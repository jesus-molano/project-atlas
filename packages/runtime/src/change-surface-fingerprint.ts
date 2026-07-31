import { createHash } from "node:crypto";
import path from "node:path";
import type { ComponentGraph } from "@component-atlas/core";

export interface ScopedChangeSurfaceFingerprints {
  graph: string;
  theme?: string;
  scopedTheme?: string;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

/** Stable JSON used by both the lock writer and every later verifier. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function normalizedPath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function repositoryRelativePath(graph: ComponentGraph, value: string): string {
  const relative = path.isAbsolute(value)
    ? path.relative(graph.project.rootPath, value)
    : value;
  const normalized = normalizedPath(relative);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sorted<T>(values: T[], selector: (value: T) => string): T[] {
  return values.toSorted((left, right) => {
    const leftKey = selector(left);
    const rightKey = selector(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

/**
 * Fingerprints the graph evidence outside the files a task is explicitly
 * allowed to change. Volatile scan metadata is deliberately excluded.
 */
export function computeScopedChangeSurfaceFingerprints(
  graph: ComponentGraph,
  allowedFiles: string[],
): ScopedChangeSurfaceFingerprints {
  const allowed = new Set(
    allowedFiles.map((file) => repositoryRelativePath(graph, file)),
  );
  const inScope = (file: string): boolean =>
    allowed.has(repositoryRelativePath(graph, file));

  const components = graph.components.filter(
    (component) => !inScope(component.relativePath),
  );
  const entities = graph.entities.filter((entity) => !inScope(entity.relativePath));
  const externalNodeIds = new Set([
    ...components.map((component) => component.id),
    ...entities.map((entity) => entity.id),
  ]);
  const excludedNodeIds = new Set([
    ...graph.components
      .filter((component) => inScope(component.relativePath))
      .map((component) => component.id),
    ...graph.entities
      .filter((entity) => inScope(entity.relativePath))
      .map((entity) => entity.id),
  ]);

  const graphPayload = {
    schemaVersion: graph.schemaVersion,
    components: sorted(components, (component) => component.id).map(
      (component) => ({
        id: component.id,
        relativePath: repositoryRelativePath(graph, component.relativePath),
        sourceHash: component.sourceHash,
      }),
    ),
    entities: sorted(entities, (entity) => entity.id).map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      relativePath: repositoryRelativePath(graph, entity.relativePath),
      sourceHash: entity.sourceHash,
      ...(entity.endpoint
        ? {
            endpoint: {
              client: entity.endpoint.client,
              method: entity.endpoint.method,
              path: entity.endpoint.path,
              operationId: entity.endpoint.operationId,
              openApiStatus: entity.endpoint.openApiStatus,
            },
          }
        : {}),
    })),
    edges: sorted(
      graph.edges.filter(
        (edge) =>
          !excludedNodeIds.has(edge.source) &&
          !excludedNodeIds.has(edge.target) &&
          (!edge.provenance?.sourcePath || !inScope(edge.provenance.sourcePath)) &&
          (externalNodeIds.has(edge.source) || externalNodeIds.has(edge.target)),
      ),
      (edge) => edge.id,
    ).map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      source: edge.source,
      target: edge.target,
      resolution: edge.resolution,
      provenance: edge.provenance
        ? {
            sourcePath: repositoryRelativePath(
              graph,
              edge.provenance.sourcePath,
            ),
            symbol: edge.provenance.symbol,
          }
        : undefined,
    })),
  };

  const fingerprint = graph.themeFingerprint;
  if (!fingerprint) return { graph: digest(graphPayload) };

  const scopedThemePayload = {
    schemaVersion: fingerprint.schemaVersion,
    tokens: sorted(
      graph.tokens.filter((token) => !inScope(token.sourcePath)),
      (token) => `${repositoryRelativePath(graph, token.sourcePath)}\0${token.name}`,
    ).map((token) => ({
      sourcePath: repositoryRelativePath(graph, token.sourcePath),
      name: token.name,
      kind: token.kind,
      value: token.value,
    })),
    provenance: sorted(
      fingerprint.provenance.filter((entry) => !inScope(entry.source)),
      (entry) => `${entry.kind}\0${entry.source}\0${entry.hash}`,
    ).map((entry) => ({
      kind: entry.kind,
      source: path.isAbsolute(entry.source)
        ? repositoryRelativePath(graph, entry.source)
        : normalizedPath(entry.source),
      hash: entry.hash,
      receiptId: entry.receiptId,
    })),
  };

  return {
    graph: digest(graphPayload),
    theme: fingerprint.hash,
    scopedTheme: digest(scopedThemePayload),
  };
}

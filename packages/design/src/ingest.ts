import { createHash } from "node:crypto";
import {
  createSourceReceipt,
  sourceIdentityFromReference,
  sourceIdentityMatches,
  taskSourceId,
  type SourceReceipt,
} from "@component-atlas/core";
import {
  DESIGN_INDEX_SCHEMA_VERSION,
  type BuildFigmaDesignIndexInput,
  type DesignAnnotation,
  type DesignCodeConnection,
  type DesignComponentSummary,
  type DesignDevStatus,
  type DesignDevStatusAvailability,
  type DesignFileIndex,
  type DesignIndexEnrichment,
  type DesignIndexNode,
  type DesignLibrarySummary,
  type DesignMetadataSource,
  type DesignResourceLink,
} from "./types.js";
import { figmaNodeUrl, parseFigmaReference } from "./figma-url.js";
import { normalizeDesignVariableCatalog } from "./variables.js";

export { normalizeDesignVariableCatalog } from "./variables.js";

interface RawDesignNode {
  id: string;
  name: string;
  type: string;
  attributes: Record<string, unknown>;
  children: RawDesignNode[];
}

const INDEXED_NODE_TYPES = new Set([
  "SECTION",
  "FRAME",
  "COMPONENT_SET",
  "COMPONENT",
  "INSTANCE",
]);
const PAGE_NODE_TYPES = new Set(["CANVAS", "PAGE"]);
const MAX_INDEXED_NODES = 2_000;
const MAX_METADATA_NODES = 10_000;
const MAX_METADATA_DEPTH = 128;
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function persistentResourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(
      url.hostname,
    );
  } catch {
    return false;
  }
}

function normalizedType(value: string): string {
  return value.replaceAll("-", "_").toUpperCase();
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:xml)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

function parseXmlAttributes(source: string): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key && value !== undefined) attributes[key] = decodeXml(value);
  }
  return attributes;
}

function parseMetadataXml(payload: string): RawDesignNode[] {
  const xml = stripCodeFence(payload);
  const roots: RawDesignNode[] = [];
  const stack: RawDesignNode[] = [];
  let generatedId = 0;
  let parsedNodes = 0;
  const tags = xml.matchAll(/<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g);
  for (const match of tags) {
    const closing = match[1] === "/";
    const tagName = match[2];
    const tail = match[3] ?? "";
    if (!tagName || tagName.startsWith("!") || tagName.startsWith("?")) continue;
    if (closing) {
      if (stack.length === 0) {
        throw new Error("Figma MCP metadata contains an unmatched closing tag.");
      }
      stack.pop();
      continue;
    }
    parsedNodes += 1;
    if (parsedNodes > MAX_METADATA_NODES) {
      throw new Error(
        `Figma metadata exceeds the ${MAX_METADATA_NODES}-node safety limit.`,
      );
    }
    if (stack.length >= MAX_METADATA_DEPTH) {
      throw new Error(
        `Figma metadata exceeds the ${MAX_METADATA_DEPTH}-level safety limit.`,
      );
    }
    const attributes = parseXmlAttributes(tail);
    const id =
      text(attributes.id) ??
      text(attributes["node-id"]) ??
      `xml:${generatedId += 1}`;
    const node: RawDesignNode = {
      id,
      name: text(attributes.name) ?? tagName,
      type: normalizedType(text(attributes.type) ?? tagName),
      attributes,
      children: [],
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (!/\/\s*$/.test(tail)) stack.push(node);
  }
  if (roots.length === 0) {
    throw new Error(
      "Figma MCP metadata did not contain parseable XML nodes. Pass page or node metadata, not a prose summary.",
    );
  }
  if (stack.length > 0) {
    throw new Error("Figma MCP metadata contains unclosed XML nodes.");
  }
  return roots;
}

interface RestTraversalState {
  nodes: number;
  visited: WeakSet<object>;
}

function rawNodeFromRest(
  value: unknown,
  depth = 0,
  state: RestTraversalState = { nodes: 0, visited: new WeakSet<object>() },
): RawDesignNode | undefined {
  const item = record(value);
  const id = text(item?.id);
  const type = text(item?.type);
  if (!item || !id || !type) return undefined;
  if (depth > MAX_METADATA_DEPTH) {
    throw new Error(
      `Figma metadata exceeds the ${MAX_METADATA_DEPTH}-level safety limit.`,
    );
  }
  if (state.visited.has(item)) {
    throw new Error(`Figma metadata contains a cyclic node at ${id}.`);
  }
  state.visited.add(item);
  state.nodes += 1;
  if (state.nodes > MAX_METADATA_NODES) {
    throw new Error(
      `Figma metadata exceeds the ${MAX_METADATA_NODES}-node safety limit.`,
    );
  }
  return {
    id,
    name: text(item.name) ?? type,
    type: normalizedType(type),
    attributes: item,
    children: array(item.children)
      .map((child) => rawNodeFromRest(child, depth + 1, state))
      .filter((child): child is RawDesignNode => Boolean(child)),
  };
}

function parseMetadata(
  metadata: BuildFigmaDesignIndexInput["metadata"],
  format: BuildFigmaDesignIndexInput["format"],
): {
  kind: DesignMetadataSource;
  roots: RawDesignNode[];
  rest?: Record<string, unknown>;
  serialized: string;
} {
  if (typeof metadata === "string") {
    const trimmed = metadata.trim();
    const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
    if (format === "figma-rest" || (format !== "figma-mcp-xml" && looksJson)) {
      const parsed = JSON.parse(trimmed) as unknown;
      const rest = record(parsed);
      if (!rest) throw new Error("Figma REST metadata must be a JSON object.");
      const document = rawNodeFromRest(rest.document);
      if (!document) throw new Error("Figma REST metadata is missing document nodes.");
      return {
        kind: "figma-rest",
        roots: [document],
        rest,
        serialized: JSON.stringify(parsed),
      };
    }
    return {
      kind: "figma-mcp-xml",
      roots: parseMetadataXml(trimmed),
      serialized: trimmed,
    };
  }
  const document = rawNodeFromRest(metadata.document);
  if (!document) throw new Error("Figma REST metadata is missing document nodes.");
  return {
    kind: "figma-rest",
    roots: [document],
    rest: metadata,
    serialized: JSON.stringify(metadata),
  };
}

function statusFrom(value: unknown): {
  status: DesignDevStatus;
  description?: string;
} {
  const item = record(value);
  const raw =
    text(item?.type) ??
    text(item?.status) ??
    text(value) ??
    "NONE";
  const normalized = raw.replaceAll("_", "-").toLowerCase();
  const status: DesignDevStatus =
    normalized === "ready-for-dev"
      ? "ready-for-dev"
      : normalized === "completed"
        ? "completed"
        : "none";
  const description =
    text(item?.description) ?? text(item?.["change-description"]);
  return { status, ...(description ? { description } : {}) };
}

function statusAttribute(node: RawDesignNode): unknown {
  return (
    node.attributes.devStatus ??
    node.attributes["dev-status"] ??
    node.attributes.dev_status
  );
}

function metadataExposesDevStatus(nodes: RawDesignNode[]): boolean {
  const pending = [...nodes];
  const visited = new Set<RawDesignNode>();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (statusAttribute(node) !== undefined) return true;
    pending.push(...node.children);
  }
  return false;
}

function devStatusAvailability(
  source: DesignMetadataSource,
  roots: RawDesignNode[],
  enrichment: DesignIndexEnrichment | undefined,
): DesignDevStatusAvailability {
  if (enrichment?.devStatusAvailability) {
    return enrichment.devStatusAvailability;
  }
  if (enrichment?.devStatusByNode) return "available";
  if (source === "figma-rest") return "available";
  return metadataExposesDevStatus(roots)
    ? "available"
    : "source-unavailable";
}

function nodeStatus(
  node: RawDesignNode,
  enrichment: DesignIndexEnrichment | undefined,
  availability: DesignDevStatusAvailability,
): {
  status: DesignDevStatus;
  availability: DesignDevStatusAvailability;
  provenance: DesignIndexNode["devStatusProvenance"];
  description?: string;
} {
  const override = record(enrichment?.devStatusByNode)?.[node.id];
  const parsed =
    override !== undefined
      ? statusFrom(override)
      : statusFrom(statusAttribute(node));
  const explicitProvenance = enrichment?.devStatusProvenanceByNode?.[node.id];
  const provenance =
    explicitProvenance ??
    (availability === "source-unavailable"
      ? "source-unavailable"
      : parsed.status === "none"
        ? "absent"
        : "observed");
  return { ...parsed, availability, provenance };
}

function annotationFrom(value: unknown): DesignAnnotation | undefined {
  const item = record(value);
  if (!item) return undefined;
  const label = text(item.label) ?? text(item.name);
  const candidateUrl = text(item.url);
  const url =
    candidateUrl && persistentResourceUrl(candidateUrl)
      ? candidateUrl
      : undefined;
  const propertyText = array(item.properties)
    .map((property) => {
      const entry = record(property);
      return text(entry?.text) ?? text(entry?.value);
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("; ");
  const fallback = JSON.stringify(item);
  const annotationText =
    text(item.text) ??
    text(item.description) ??
    text(item.message) ??
    (propertyText ||
      (fallback.length <= 240 ? fallback : `${fallback.slice(0, 237)}...`));
  if (!annotationText) return undefined;
  return {
    ...(label ? { label } : {}),
    text: annotationText,
    ...(url ? { url } : {}),
  };
}

function nodeAnnotations(node: RawDesignNode): DesignAnnotation[] {
  return array(node.attributes.annotations)
    .map(annotationFrom)
    .filter((item): item is DesignAnnotation => Boolean(item))
    .slice(0, 8);
}

function resourcesByNode(
  enrichment: DesignIndexEnrichment | undefined,
): Map<string, DesignResourceLink[]> {
  const result = new Map<string, DesignResourceLink[]>();
  for (const value of enrichment?.devResources ?? []) {
    const item = record(value);
    const nodeId = text(item?.node_id) ?? text(item?.nodeId);
    const url = text(item?.url);
    if (!nodeId || !url || !persistentResourceUrl(url)) continue;
    const links = result.get(nodeId) ?? [];
    links.push({
      name: text(item?.name) ?? text(item?.title) ?? "Related resource",
      url,
    });
    result.set(nodeId, links);
  }
  return result;
}

function normalizeCodeConnections(
  enrichment: DesignIndexEnrichment | undefined,
): Map<string, DesignCodeConnection[]> {
  const result = new Map<string, DesignCodeConnection[]>();
  for (const [nodeId, value] of Object.entries(enrichment?.codeConnect ?? {})) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      const item = record(entry);
      const componentName =
        text(item?.componentName) ?? text(item?.component_name) ?? text(item?.name);
      if (!componentName) continue;
      const source = text(item?.source);
      const label = text(item?.label);
      const version = text(item?.version);
      const connection: DesignCodeConnection = {
        nodeId,
        componentName,
        ...(source ? { source } : {}),
        ...(label ? { label } : {}),
        ...(version ? { version } : {}),
      };
      const connections = result.get(nodeId) ?? [];
      connections.push(connection);
      result.set(nodeId, connections);
    }
  }
  return result;
}

function normalizeLibraries(
  enrichment: DesignIndexEnrichment | undefined,
): DesignLibrarySummary[] {
  const source = enrichment?.libraries;
  if (!source) return [];
  const candidates = Array.isArray(source)
    ? source
    : Object.values(record(source) ?? {}).flatMap((value) => array(value));
  const libraries = candidates
    .map((value): DesignLibrarySummary | undefined => {
      const item = record(value);
      const name = text(item?.name);
      if (!item || !name) return undefined;
      const key = text(item.key);
      const description = text(item.description);
      const librarySource = text(item.sourceType) ?? text(item.source);
      return {
        name,
        ...(key ? { key } : {}),
        ...(description ? { description } : {}),
        ...(librarySource ? { source: librarySource } : {}),
      };
    })
    .filter((item): item is DesignLibrarySummary => Boolean(item));
  return [...new Map(libraries.map((item) => [item.key ?? item.name, item])).values()];
}

function componentSummary(
  fallbackId: string,
  value: unknown,
): DesignComponentSummary | undefined {
  const item = record(value);
  const name = text(item?.name);
  if (!item || !name) return undefined;
  const propertyDefinitions =
    record(item.componentPropertyDefinitions) ?? record(item.variantProperties);
  const description = text(item.description);
  const componentSetId = text(item.componentSetId);
  return {
    nodeId: text(item.node_id) ?? text(item.nodeId) ?? fallbackId,
    name,
    ...(description ? { description } : {}),
    ...(componentSetId ? { componentSetId } : {}),
    variantProperties: Object.keys(propertyDefinitions ?? {}).slice(0, 20),
  };
}

function componentSummaries(
  value: unknown,
): DesignComponentSummary[] {
  const entries = record(value);
  if (!entries) return [];
  return Object.entries(entries)
    .map(([id, component]) => componentSummary(id, component))
    .filter((item): item is DesignComponentSummary => Boolean(item))
    .slice(0, 500);
}

function componentNamesIn(
  node: RawDesignNode,
  componentLookup: Map<string, string>,
): string[] {
  const names = new Set<string>();
  const pending = [node];
  const visited = new Set<RawDesignNode>();
  while (pending.length > 0 && names.size < 12) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (
      current !== node &&
      ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(current.type)
    ) {
      const componentId =
        text(current.attributes.componentId) ??
        text(current.attributes["component-id"]);
      names.add(componentId ? componentLookup.get(componentId) ?? current.name : current.name);
    }
    pending.push(...current.children);
  }
  return [...names].slice(0, 12);
}

function codeConnectionsIn(
  node: RawDesignNode,
  codeConnections: Map<string, DesignCodeConnection[]>,
): DesignCodeConnection[] {
  const connections: DesignCodeConnection[] = [];
  const pending = [node];
  const visited = new Set<RawDesignNode>();
  while (pending.length > 0 && connections.length < 12) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    connections.push(...(codeConnections.get(current.id) ?? []));
    pending.push(...current.children);
  }
  return [
    ...new Map(
      connections.map((connection) => [
        `${connection.nodeId}:${connection.componentName}:${connection.source ?? ""}`,
        connection,
      ]),
    ).values(),
  ].slice(0, 12);
}

function variantProperties(node: RawDesignNode): string[] {
  const properties =
    record(node.attributes.variantProperties) ??
    record(node.attributes.componentProperties) ??
    record(node.attributes["variant-properties"]);
  const fromObject = Object.keys(properties ?? {});
  const fromAttributes = Object.keys(node.attributes).filter((key) =>
    /variant|property/i.test(key),
  );
  return [...new Set([...fromObject, ...fromAttributes])].slice(0, 20);
}

function bounds(node: RawDesignNode): {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
} {
  const box = record(node.attributes.absoluteBoundingBox);
  const x = numberValue(box?.x ?? node.attributes.x);
  const y = numberValue(box?.y ?? node.attributes.y);
  const width = numberValue(box?.width ?? node.attributes.width);
  const height = numberValue(box?.height ?? node.attributes.height);
  return {
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function flattenNodes(
  roots: RawDesignNode[],
  fileUrl: string,
  scopeNodeId: string | undefined,
  scopePage:
    | {
        id: string;
        name: string;
      }
    | undefined,
  enrichment: DesignIndexEnrichment | undefined,
  componentLookup: Map<string, string>,
  statusAvailability: DesignDevStatusAvailability,
  sourceReceiptId: string,
): { nodes: DesignIndexNode[]; pages: DesignFileIndex["pages"] } {
  const nodes: DesignIndexNode[] = [];
  const pages: DesignFileIndex["pages"] = [];
  const resources = resourcesByNode(enrichment);
  const codeConnections = normalizeCodeConnections(enrichment);
  const visitedRawNodes = new Set<RawDesignNode>();
  let traversedRawNodes = 0;
  const unknownPage = scopePage ?? {
    id: `page:${scopeNodeId ?? "unknown"}`,
    name: "Page unavailable from scoped metadata",
  };
  const walk = (
    raw: RawDesignNode,
    page: { id: string; name: string },
    parentId: string | undefined,
    currentPath: string[],
    depth = 0,
  ): string | undefined => {
    if (visitedRawNodes.has(raw)) {
      throw new Error(`Figma metadata contains a cyclic node at ${raw.id}.`);
    }
    if (depth > MAX_METADATA_DEPTH) {
      throw new Error(
        `Figma metadata exceeds the ${MAX_METADATA_DEPTH}-level safety limit.`,
      );
    }
    visitedRawNodes.add(raw);
    traversedRawNodes += 1;
    if (traversedRawNodes > MAX_METADATA_NODES) {
      throw new Error(
        `Figma metadata exceeds the ${MAX_METADATA_NODES}-node safety limit.`,
      );
    }
    if (nodes.length >= MAX_INDEXED_NODES) return undefined;
    const isPage = PAGE_NODE_TYPES.has(raw.type);
    const activePage = isPage ? { id: raw.id, name: raw.name } : page;
    const basePath = isPage ? [raw.name] : currentPath;
    const status = nodeStatus(raw, enrichment, statusAvailability);
    if (isPage) {
      pages.push({
        id: raw.id,
        name: raw.name,
        nodeIds: [],
        devStatus: status.status,
        devStatusAvailability: status.availability,
        devStatusProvenance: status.provenance,
        ...(status.description
          ? { devStatusDescription: status.description }
          : {}),
        readyForDev: 0,
        completed: 0,
      });
    }
    const keep =
      !isPage &&
      (INDEXED_NODE_TYPES.has(raw.type) || status.status !== "none");
    let currentParent = parentId;
    let indexedNode: DesignIndexNode | undefined;
    if (keep) {
      const nodePath = [...basePath, raw.name];
      indexedNode = {
        id: raw.id,
        name: raw.name,
        type: raw.type,
        url: figmaNodeUrl(fileUrl, raw.id),
        pageId: activePage.id,
        pageName: activePage.name,
        ...(parentId ? { parentId } : {}),
        depth: Math.max(1, nodePath.length - 1),
        path: nodePath,
        ...bounds(raw),
        devStatus: status.status,
        devStatusAvailability: status.availability,
        devStatusProvenance: status.provenance,
        ...(status.description
          ? { devStatusDescription: status.description }
          : {}),
        annotations: nodeAnnotations(raw),
        resources: resources.get(raw.id) ?? [],
        componentNames: componentNamesIn(raw, componentLookup),
        variantProperties: variantProperties(raw),
        codeConnections: codeConnectionsIn(raw, codeConnections),
        childIds: [],
        sourceReceiptIds: [sourceReceiptId],
      };
      nodes.push(indexedNode);
      currentParent = raw.id;
    }
    const childPath = keep ? [...basePath, raw.name] : basePath;
    for (const child of raw.children) {
      const childId = walk(
        child,
        activePage,
        currentParent,
        childPath,
        depth + 1,
      );
      if (indexedNode && childId) indexedNode.childIds.push(childId);
    }
    return indexedNode?.id;
  };
  for (const root of roots) walk(root, unknownPage, undefined, []);
  return { nodes, pages };
}

function sourceHash(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex").slice(0, 24);
}

function metadataPathToNode(
  roots: RawDesignNode[],
  targetId: string,
): string[] | undefined {
  const visit = (
    node: RawDesignNode,
    ancestors: string[],
  ): string[] | undefined => {
    const path = [...ancestors, node.id];
    if (node.id === targetId) return path;
    for (const child of node.children) {
      const match = visit(child, path);
      if (match) return match;
    }
    return undefined;
  };
  for (const root of roots) {
    const match = visit(root, []);
    if (match) return match;
  }
  return undefined;
}

function assertObservedFigmaScope(
  input: BuildFigmaDesignIndexInput,
  roots: RawDesignNode[],
): void {
  const relation = input.sourceReceipt?.scopeRelation;
  if (!relation) return;
  const targetPath = metadataPathToNode(roots, relation.targetId);
  if (!targetPath) {
    throw new Error(
      "The observed Figma scope is absent from the supplied metadata.",
    );
  }
  if (relation.kind === "same-scope") return;
  const sourceIsFile =
    input.sourceReceipt?.requested.fileKey === relation.sourceId;
  const sourcePrecedesTarget =
    targetPath.includes(relation.sourceId) &&
    targetPath.indexOf(relation.sourceId) <
      targetPath.indexOf(relation.targetId);
  const scopedPageProvesContainment =
    input.scopePageId === relation.sourceId;
  if (!sourceIsFile && !sourcePrecedesTarget && !scopedPageProvesContainment) {
    throw new Error(
      "The supplied metadata does not prove that the observed Figma scope is contained by the confirmed source.",
    );
  }
}

export function finalizeDesignIndex(index: DesignFileIndex): DesignFileIndex {
  const pageMetadata = new Map(
    index.pages.map((page) => [page.id, page] as const),
  );
  const pageNames = new Map(index.pages.map((page) => [page.id, page.name]));
  for (const node of index.nodes) pageNames.set(node.pageId, node.pageName);
  const pages = [...pageNames]
    .map(([id, name]) => {
      const pageNodes = index.nodes.filter((node) => node.pageId === id);
      const metadata = pageMetadata.get(id);
      return {
        id,
        name,
        nodeIds: pageNodes.map((node) => node.id),
        devStatus: metadata?.devStatus ?? "none",
        devStatusAvailability:
          metadata?.devStatusAvailability ??
          (pageNodes[0]?.devStatusAvailability ?? "source-unavailable"),
        devStatusProvenance:
          metadata?.devStatusProvenance ??
          (pageNodes[0]?.devStatusProvenance ?? "source-unavailable"),
        ...(metadata?.devStatusDescription
          ? { devStatusDescription: metadata.devStatusDescription }
          : {}),
        readyForDev: pageNodes.filter(
          (node) => node.devStatus === "ready-for-dev",
        ).length,
        completed: pageNodes.filter(
          (node) => node.devStatus === "completed",
        ).length,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const availableSources = index.sources.filter(
    (source) => source.devStatusAvailability === "available",
  ).length;
  const retainedObservableStatus =
    index.nodes.some(
      (node) => node.devStatusAvailability === "available",
    ) ||
    pages.some((page) => page.devStatusAvailability === "available");
  const coverage =
    availableSources === 0 && retainedObservableStatus
      ? "partial"
      : availableSources === 0
      ? "source-unavailable"
      : availableSources === index.sources.length
        ? "available"
        : "partial";
  return {
    ...index,
    indexedAt: index.sources
      .map((source) => source.indexedAt)
      .sort()
      .at(-1) ?? index.indexedAt,
    devStatus: {
      availability: coverage,
      ...(coverage === "source-unavailable"
        ? {
            note:
              "Dev status is not available through the indexed source. This does not mean the Figma nodes have no Ready for Dev status.",
          }
        : coverage === "partial"
          ? {
              note:
                "Dev status is available for only part of the indexed metadata. Unknown nodes must not be treated as having no status.",
            }
          : {}),
    },
    pages,
    stats: {
      pages: pages.length,
      nodes: index.nodes.length,
      readyForDev: index.nodes.filter(
        (node) => node.devStatus === "ready-for-dev",
      ).length,
      completed: index.nodes.filter(
        (node) => node.devStatus === "completed",
      ).length,
      components: index.components.length,
      componentSets: index.componentSets.length,
      codeConnections: index.nodes.reduce(
        (total, node) => total + node.codeConnections.length,
        0,
      ),
      variableCollections: index.variables.totalCollections,
      variables: index.variables.totalVariables,
    },
  };
}

function cachedSourceReceipt(
  index: DesignFileIndex,
  source: DesignFileIndex["sources"][number],
): SourceReceipt {
  const reference = source.scopeNodeId
    ? figmaNodeUrl(index.file.url, source.scopeNodeId)
    : index.file.url;
  const requested = sourceIdentityFromReference("figma", reference);
  return createSourceReceipt({
    sourceDecisionId: taskSourceId("figma", reference),
    provider: "figma",
    requested,
    resolved: {
      ...requested,
      ...(index.file.version ? { version: index.file.version } : {}),
    },
    adapter: "atlas-cache",
    route: "project-atlas-design-index",
    operation: "migrate_cached_metadata",
    scope: source.scopeNodeId
      ? {
          kind: "node",
          id: source.scopeNodeId,
          parentId: index.file.key,
        }
      : { kind: "file", id: index.file.key },
    contentHash: source.hash,
    observedAt: source.indexedAt,
    coverage: source.scopeNodeId ? "exact" : "partial",
    freshness: "unknown",
  });
}

export function normalizeDesignIndex(index: DesignFileIndex): DesignFileIndex {
  const sources = index.sources.map((source) => {
    const receipt =
      (source as DesignFileIndex["sources"][number] & {
        receipt?: SourceReceipt;
      }).receipt ?? cachedSourceReceipt(index, source);
    return {
      ...source,
      receipt,
      devStatusAvailability:
        source.devStatusAvailability ??
        (source.kind === "figma-rest"
          ? "available"
          : index.nodes.some((node) => node.devStatus !== "none")
            ? "available"
            : "source-unavailable"),
    };
  });
  const fallbackAvailability =
    sources.some((source) => source.devStatusAvailability === "available")
      ? "available"
      : "source-unavailable";
  const nodes = index.nodes.map((node) => ({
    ...node,
    sourceReceiptIds:
      node.sourceReceiptIds?.length > 0
        ? node.sourceReceiptIds
        : sources.map((source) => source.receipt.id),
    devStatusAvailability:
      node.devStatusAvailability ??
      (node.devStatus !== "none" ? "available" : fallbackAvailability),
    devStatusProvenance:
      node.devStatusProvenance ??
      (node.devStatusAvailability === "source-unavailable"
        ? "source-unavailable"
        : node.devStatus === "none"
          ? "absent"
          : "observed"),
  }));
  const pages = index.pages.map((page) => ({
    ...page,
    devStatus: page.devStatus ?? "none",
    devStatusAvailability:
      page.devStatusAvailability ??
      (page.devStatus && page.devStatus !== "none"
        ? "available"
        : fallbackAvailability),
    devStatusProvenance:
      page.devStatusProvenance ??
      (page.devStatusAvailability === "source-unavailable"
        ? "source-unavailable"
        : page.devStatus === "none"
          ? "absent"
          : "observed"),
  }));
  const variables = normalizeDesignVariableCatalog(
    index.variables,
    index.variables.availability === "global"
      ? index.indexedAt
      : undefined,
  );
  return finalizeDesignIndex({
    ...index,
    schemaVersion: DESIGN_INDEX_SCHEMA_VERSION,
    sources,
    nodes,
    pages,
    variables,
    devStatus: index.devStatus ?? { availability: fallbackAvailability },
  });
}

export function buildFigmaDesignIndex(
  input: BuildFigmaDesignIndexInput,
): DesignFileIndex {
  const reference = parseFigmaReference(input.figmaUrl);
  const parsed = parseMetadata(input.metadata, input.format ?? "auto");
  const indexedAt = input.indexedAt ?? new Date().toISOString();
  const metadataHash = sourceHash(parsed.serialized);
  const scopeNodeId = input.scopeNodeId ?? reference.nodeId;
  const observedVersion = input.version ?? text(parsed.rest?.version);
  const requestedIdentity = sourceIdentityFromReference(
    "figma",
    input.confirmedSourceReference ?? input.figmaUrl,
  );
  if (
    input.sourceReceipt &&
    (!sourceIdentityMatches(requestedIdentity, input.sourceReceipt.requested) ||
      !sourceIdentityMatches(requestedIdentity, input.sourceReceipt.resolved))
  ) {
    throw new Error(
      "The Figma source receipt does not match the requested file and node identity.",
    );
  }
  assertObservedFigmaScope(input, parsed.roots);
  if (
    input.sourceReceipt?.contentHash &&
    input.sourceReceipt.contentHash !== metadataHash
  ) {
    throw new Error(
      "The Figma source receipt hash does not match the supplied metadata.",
    );
  }
  const providedReceipt = input.sourceReceipt
    ? (({ id: _id, schemaVersion: _schemaVersion, ...receipt }) => receipt)(
        input.sourceReceipt,
      )
    : undefined;
  const sourceReceipt = createSourceReceipt({
    ...(providedReceipt ?? {
      sourceDecisionId: taskSourceId(
        "figma",
        input.confirmedSourceReference ?? input.figmaUrl,
      ),
      provider: "figma" as const,
      requested: requestedIdentity,
      resolved: requestedIdentity,
      adapter: "manual-import" as const,
      route: "provided-metadata",
      operation: "map_figma_file",
      scope: scopeNodeId
        ? {
            kind: "node" as const,
            id: scopeNodeId,
            parentId: reference.fileKey,
          }
        : { kind: "file" as const, id: reference.fileKey },
      observedAt: indexedAt,
      coverage: "exact" as const,
      freshness: "current" as const,
    }),
    resolved: {
      ...(providedReceipt?.resolved ?? requestedIdentity),
      ...(observedVersion ? { version: observedVersion } : {}),
    },
    contentHash: metadataHash,
    observedAt: providedReceipt?.observedAt ?? indexedAt,
    freshness: providedReceipt?.freshness ?? "current",
  });
  const restComponents = componentSummaries(parsed.rest?.components);
  const componentSets = componentSummaries(parsed.rest?.componentSets);
  const componentLookup = new Map(
    [...restComponents, ...componentSets].map((component) => [
      component.nodeId,
      component.name,
    ]),
  );
  const statusAvailability = devStatusAvailability(
    parsed.kind,
    parsed.roots,
    input.enrichment,
  );
  const flattened = flattenNodes(
    parsed.roots,
    reference.fileUrl,
    scopeNodeId,
    input.scopePageId && input.scopePageName
      ? { id: input.scopePageId, name: input.scopePageName }
      : undefined,
    input.enrichment,
    componentLookup,
    statusAvailability,
    sourceReceipt.id,
  );
  const restName = text(parsed.rest?.name);
  const restVersion = text(parsed.rest?.version);
  const restLastModified = text(parsed.rest?.lastModified);
  const fileName = input.fileName ?? restName;
  const version = input.version ?? restVersion;
  const lastModified = input.lastModified ?? restLastModified;
  const index: DesignFileIndex = {
    schemaVersion: DESIGN_INDEX_SCHEMA_VERSION,
    provider: "figma",
    file: {
      key: reference.fileKey,
      url: reference.fileUrl,
      ...(fileName ? { name: fileName } : {}),
      ...(version ? { version } : {}),
      ...(lastModified ? { lastModified } : {}),
    },
    indexedAt,
    sources: [
      {
        kind: parsed.kind,
        ...(scopeNodeId ? { scopeNodeId } : {}),
        hash: metadataHash,
        indexedAt,
        devStatusAvailability: statusAvailability,
        receipt: sourceReceipt,
      },
    ],
    devStatus: {
      availability: statusAvailability,
    },
    pages: flattened.pages,
    nodes: flattened.nodes,
    components: restComponents,
    componentSets,
    libraries: normalizeLibraries(input.enrichment),
    variables: normalizeDesignVariableCatalog(
      input.enrichment?.variableCatalog,
      input.enrichment?.variableCatalog !== undefined
        ? indexedAt
        : undefined,
    ),
    stats: {
      pages: 0,
      nodes: 0,
      readyForDev: 0,
      completed: 0,
      components: 0,
      componentSets: 0,
      codeConnections: 0,
      variableCollections: 0,
      variables: 0,
    },
  };
  return finalizeDesignIndex(index);
}

function mergeById<T>(
  left: T[],
  right: T[],
  key: (item: T) => string,
): T[] {
  return [...new Map([...left, ...right].map((item) => [key(item), item])).values()];
}

function mergeDesignNodes(
  existing: DesignIndexNode[],
  incoming: DesignIndexNode[],
): DesignIndexNode[] {
  const existingById = new Map(existing.map((node) => [node.id, node]));
  return mergeById(existing, incoming, (node) => node.id).map((node) => {
    const previous = existingById.get(node.id);
    const sourceReceiptIds = [
      ...new Set([
        ...(previous?.sourceReceiptIds ?? []),
        ...node.sourceReceiptIds,
      ]),
    ];
    if (
      previous?.devStatusAvailability === "available" &&
      node.devStatusAvailability === "source-unavailable"
    ) {
      return {
        ...node,
        devStatus: previous.devStatus,
        devStatusAvailability: previous.devStatusAvailability,
        ...(previous.devStatusDescription
          ? { devStatusDescription: previous.devStatusDescription }
          : {}),
        sourceReceiptIds,
      };
    }
    return { ...node, sourceReceiptIds };
  });
}

function mergeDesignPages(
  existing: DesignFileIndex["pages"],
  incoming: DesignFileIndex["pages"],
): DesignFileIndex["pages"] {
  const existingById = new Map(existing.map((page) => [page.id, page]));
  return mergeById(existing, incoming, (page) => page.id).map((page) => {
    const previous = existingById.get(page.id);
    if (
      previous?.devStatusAvailability === "available" &&
      page.devStatusAvailability === "source-unavailable"
    ) {
      return {
        ...page,
        devStatus: previous.devStatus,
        devStatusAvailability: previous.devStatusAvailability,
        ...(previous.devStatusDescription
          ? { devStatusDescription: previous.devStatusDescription }
          : {}),
      };
    }
    return page;
  });
}

export function mergeDesignIndexes(
  existing: DesignFileIndex,
  incoming: DesignFileIndex,
  options: { replaceVariables?: boolean } = {},
): DesignFileIndex {
  if (existing.file.key !== incoming.file.key) {
    throw new Error("Cannot merge design indexes from different Figma files.");
  }
  const versionChanged =
    existing.file.version &&
    incoming.file.version &&
    existing.file.version !== incoming.file.version;
  const modifiedChanged =
    existing.file.lastModified &&
    incoming.file.lastModified &&
    existing.file.lastModified !== incoming.file.lastModified;
  if (versionChanged || modifiedChanged) return incoming;
  const variables =
    options.replaceVariables || incoming.variables.availability === "global"
      ? incoming.variables
      : existing.variables;
  return finalizeDesignIndex({
    ...existing,
    file: { ...existing.file, ...incoming.file },
    indexedAt: incoming.indexedAt,
    sources: mergeById(
      existing.sources,
      incoming.sources,
      (source) => `${source.kind}:${source.scopeNodeId ?? "file"}`,
    ),
    pages: mergeDesignPages(existing.pages, incoming.pages),
    nodes: mergeDesignNodes(existing.nodes, incoming.nodes),
    components: mergeById(
      existing.components,
      incoming.components,
      (component) => component.nodeId,
    ),
    componentSets: mergeById(
      existing.componentSets,
      incoming.componentSets,
      (component) => component.nodeId,
    ),
    libraries: mergeById(
      existing.libraries,
      incoming.libraries,
      (library) => library.key ?? library.name,
    ),
    variables,
  });
}

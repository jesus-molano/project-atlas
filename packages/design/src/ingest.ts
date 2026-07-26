import { createHash } from "node:crypto";
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
  type DesignVariableCatalog,
  type DesignVariableToken,
  type DesignVariableValue,
} from "./types.js";
import { figmaNodeUrl, parseFigmaReference } from "./figma-url.js";

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

function values(value: unknown): unknown[] {
  const item = record(value);
  return item ? Object.values(item) : array(value);
}

function normalizedType(value: string): string {
  return value.replaceAll("-", "_").toUpperCase();
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
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
  const tags = xml.matchAll(/<\s*(\/?)\s*([A-Za-z_][\w:.-]*)([^>]*)>/g);
  for (const match of tags) {
    const closing = match[1] === "/";
    const tagName = match[2];
    const tail = match[3] ?? "";
    if (!tagName || tagName.startsWith("!") || tagName.startsWith("?")) continue;
    if (closing) {
      stack.pop();
      continue;
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
  return roots;
}

function rawNodeFromRest(value: unknown): RawDesignNode | undefined {
  const item = record(value);
  const id = text(item?.id);
  const type = text(item?.type);
  if (!item || !id || !type) return undefined;
  return {
    id,
    name: text(item.name) ?? type,
    type: normalizedType(type),
    attributes: item,
    children: array(item.children)
      .map(rawNodeFromRest)
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
  return nodes.some(
    (node) =>
      statusAttribute(node) !== undefined ||
      metadataExposesDevStatus(node.children),
  );
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

function variableValue(value: unknown): DesignVariableValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  const item = record(value);
  const aliasType = text(item?.type)?.toUpperCase();
  const aliasId =
    aliasType === "VARIABLE_ALIAS" ? text(item?.id) : undefined;
  if (aliasId) return { aliasTo: aliasId };
  const serialized = JSON.stringify(value) ?? "null";
  return {
    summary:
      serialized.length <= 160 ? serialized : `${serialized.slice(0, 157)}...`,
  };
}

function normalizeVariableCatalog(
  enrichment: DesignIndexEnrichment | undefined,
): DesignVariableCatalog {
  const raw = record(enrichment?.variableCatalog);
  if (!raw) {
    return {
      availability: "selection-only",
      source: "figma-selection",
      valuesIncluded: false,
      collections: [],
      variables: [],
      note: "Global Figma variables were not available. Retrieve variables for the confirmed node with get_variable_defs.",
    };
  }
  const meta = record(raw.meta) ?? raw;
  const rawCollections =
    record(meta.variableCollections) ??
    record(meta.collections) ??
    {};
  const rawVariables = record(meta.variables) ?? {};
  const includeValues =
    raw.valuesIncluded === true || raw.includeValues === true;
  const tokens = Object.entries(rawVariables)
    .map(([fallbackId, value]): DesignVariableToken | undefined => {
      const item = record(value);
      const id = text(item?.id) ?? fallbackId;
      const name = text(item?.name);
      const collectionId =
        text(item?.variableCollectionId) ??
        text(item?.collectionId) ??
        text(item?.variable_collection_id);
      if (!item || !id || !name || !collectionId) return undefined;
      const valuesByMode = record(item.valuesByMode);
      return {
        id,
        name,
        collectionId,
        resolvedType:
          text(item.resolvedType) ?? text(item.type) ?? "UNKNOWN",
        origin: item.remote === true ? "remote" : "local",
        scopes: array(item.scopes)
          .map(text)
          .filter((scope): scope is string => Boolean(scope)),
        ...(includeValues && valuesByMode
          ? {
              valuesByMode: Object.fromEntries(
                Object.entries(valuesByMode).map(([modeId, modeValue]) => [
                  modeId,
                  variableValue(modeValue),
                ]),
              ),
            }
          : {}),
      };
    })
    .filter((item): item is DesignVariableToken => Boolean(item));
  const collections = Object.entries(rawCollections).map(([fallbackId, value]) => {
    const item = record(value);
    const id = text(item?.id) ?? fallbackId;
    const collectionVariables = tokens.filter(
      (variable) => variable.collectionId === id,
    );
    return {
      id,
      name: text(item?.name) ?? id,
      modes: array(item?.modes)
        .map((mode) => {
          const modeItem = record(mode);
          const modeId = text(modeItem?.modeId) ?? text(modeItem?.id);
          const modeName = text(modeItem?.name);
          return modeId && modeName ? { id: modeId, name: modeName } : undefined;
        })
        .filter(
          (mode): mode is { id: string; name: string } => Boolean(mode),
        ),
      variableCount:
        numberValue(item?.variableCount) ??
        (array(item?.variableIds).length || collectionVariables.length),
      remoteVariables: collectionVariables.filter(
        (variable) => variable.origin === "remote",
      ).length,
      resolvedTypes: [
        ...new Set(collectionVariables.map((variable) => variable.resolvedType)),
      ].sort(),
    };
  });
  const requestedAvailability = text(raw.availability);
  const availability =
    requestedAvailability === "unavailable"
      ? "unavailable"
      : requestedAvailability === "selection-only"
        ? "selection-only"
        : "global";
  const note = text(raw.note);
  return {
    availability,
    source:
      availability === "global"
        ? "figma-variables-api"
        : availability === "selection-only"
          ? "figma-selection"
          : "none",
    valuesIncluded: includeValues,
    collections,
    variables: tokens,
    ...(note ? { note } : {}),
  };
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
  const visit = (current: RawDesignNode): void => {
    if (
      current !== node &&
      ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(current.type)
    ) {
      const componentId =
        text(current.attributes.componentId) ??
        text(current.attributes["component-id"]);
      names.add(componentId ? componentLookup.get(componentId) ?? current.name : current.name);
    }
    if (names.size >= 12) return;
    for (const child of current.children) visit(child);
  };
  visit(node);
  return [...names].slice(0, 12);
}

function codeConnectionsIn(
  node: RawDesignNode,
  codeConnections: Map<string, DesignCodeConnection[]>,
): DesignCodeConnection[] {
  const connections: DesignCodeConnection[] = [];
  const visit = (current: RawDesignNode): void => {
    connections.push(...(codeConnections.get(current.id) ?? []));
    if (connections.length >= 12) return;
    for (const child of current.children) visit(child);
  };
  visit(node);
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
): { nodes: DesignIndexNode[]; pages: DesignFileIndex["pages"] } {
  const nodes: DesignIndexNode[] = [];
  const pages: DesignFileIndex["pages"] = [];
  const resources = resourcesByNode(enrichment);
  const codeConnections = normalizeCodeConnections(enrichment);
  const unknownPage = scopePage ?? {
    id: `page:${scopeNodeId ?? "unknown"}`,
    name: "Page unavailable from scoped metadata",
  };
  const walk = (
    raw: RawDesignNode,
    page: { id: string; name: string },
    parentId: string | undefined,
    currentPath: string[],
  ): string | undefined => {
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
      };
      nodes.push(indexedNode);
      currentParent = raw.id;
    }
    const childPath = keep ? [...basePath, raw.name] : basePath;
    for (const child of raw.children) {
      const childId = walk(child, activePage, currentParent, childPath);
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
      variableCollections: index.variables.collections.length,
      variables: index.variables.variables.length,
    },
  };
}

export function normalizeDesignIndex(index: DesignFileIndex): DesignFileIndex {
  const sources = index.sources.map((source) => ({
    ...source,
    devStatusAvailability:
      source.devStatusAvailability ??
      (source.kind === "figma-rest"
        ? "available"
        : index.nodes.some((node) => node.devStatus !== "none")
          ? "available"
          : "source-unavailable"),
  }));
  const fallbackAvailability =
    sources.some((source) => source.devStatusAvailability === "available")
      ? "available"
      : "source-unavailable";
  const nodes = index.nodes.map((node) => ({
    ...node,
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
  return finalizeDesignIndex({
    ...index,
    schemaVersion: DESIGN_INDEX_SCHEMA_VERSION,
    sources,
    nodes,
    pages,
    devStatus: index.devStatus ?? { availability: fallbackAvailability },
  });
}

export function buildFigmaDesignIndex(
  input: BuildFigmaDesignIndexInput,
): DesignFileIndex {
  const reference = parseFigmaReference(input.figmaUrl);
  const parsed = parseMetadata(input.metadata, input.format ?? "auto");
  const indexedAt = input.indexedAt ?? new Date().toISOString();
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
    input.scopeNodeId ?? reference.nodeId,
    input.scopePageId && input.scopePageName
      ? { id: input.scopePageId, name: input.scopePageName }
      : undefined,
    input.enrichment,
    componentLookup,
    statusAvailability,
  );
  const restName = text(parsed.rest?.name);
  const restVersion = text(parsed.rest?.version);
  const restLastModified = text(parsed.rest?.lastModified);
  const fileName = input.fileName ?? restName;
  const version = input.version ?? restVersion;
  const lastModified = input.lastModified ?? restLastModified;
  const scopeNodeId = input.scopeNodeId ?? reference.nodeId;
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
        hash: sourceHash(parsed.serialized),
        indexedAt,
        devStatusAvailability: statusAvailability,
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
    variables: normalizeVariableCatalog(input.enrichment),
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
      };
    }
    return node;
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
    incoming.variables.availability === "global"
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

export function isDesignSnapshotCurrent(
  existing: DesignFileIndex,
  incoming: DesignFileIndex,
): boolean {
  return incoming.sources.every((source) =>
    existing.sources.some(
      (candidate) =>
        candidate.kind === source.kind &&
        candidate.scopeNodeId === source.scopeNodeId &&
        candidate.hash === source.hash &&
        (!incoming.file.version ||
          existing.file.version === incoming.file.version) &&
        (!incoming.file.lastModified ||
          existing.file.lastModified === incoming.file.lastModified),
    ),
  );
}

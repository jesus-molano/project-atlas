import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  assertSourceReceiptMatchesDecision,
  createSourceReceipt,
  sourceIdentityFromReference,
  taskSourceId,
  type SourceReceipt,
  type SourceReceiptAdapter,
  type TaskSourceRoutePolicy,
} from "@component-atlas/core";
import { parse } from "yaml";
import {
  canonicalizePublicOpenApiReference,
  type CanonicalOpenApiDocument,
} from "./openapi-source.js";

const MAX_SPEC_BYTES = 1_500_000;
const MAX_OPERATIONS = 6;
const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

type JsonObject = Record<string, unknown>;

export interface OpenApiTaskContext {
  available: boolean;
  format: "openapi" | "swagger" | "mixed";
  contracts: number;
  operations: Array<{
    method: string;
    path: string;
    operationId?: string;
    summary?: string;
    parameters: Array<{
      name: string;
      in: string;
      required: boolean;
      schema?: unknown;
    }>;
    request?: unknown;
    responses: Array<{ status: string; schema?: unknown }>;
    security: Array<{ scheme: string; scopes: string[] }>;
    sourceReceiptIds: string[];
  }>;
  authentication: Array<{
    scheme: string;
    type?: string;
    method?: string;
    location?: string;
    parameter?: string;
    scopes?: string[];
  }>;
  receipts: SourceReceipt[];
  conflicts: Array<{
    id: string;
    method: string;
    path: string;
    receiptIds: string[];
    summary: string;
  }>;
  errors: Array<{
    sourceDecisionId: string;
    reference: string;
    receiptId: string;
    message: string;
    required: boolean;
    httpStatus?: number;
    recoverableWithConnector: boolean;
  }>;
}

export interface ConfirmedOpenApiSource {
  sourceDecisionId: string;
  reference: string;
  required?: boolean;
  content?: string;
  adapter?: Extract<
    SourceReceiptAdapter,
    | "openapi-local-file"
    | "openapi-pasted"
    | "openapi-public-http"
    | "openapi-internal-connector"
    | "manual-import"
    | "other"
  >;
  route?: string;
  operation?: string;
  observedAt?: string;
  version?: string;
  fallback?: SourceReceipt["fallback"];
  routePolicy?: TaskSourceRoutePolicy;
}

export interface ResolvedOpenApiSource {
  content: string;
  adapter: ConfirmedOpenApiSource["adapter"];
  route: string;
  operation?: string;
  observedAt?: string;
  version?: string;
  fallback?: SourceReceipt["fallback"];
  derivation?: CanonicalOpenApiDocument["derivation"];
}

export type OpenApiSourceResolver = (
  source: ConfirmedOpenApiSource,
) => Promise<ResolvedOpenApiSource>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function short(value: unknown, maximum = 180): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : undefined;
}

function stringArray(value: unknown, maximum = 12): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, 120))
        .slice(0, maximum)
    : [];
}

function referenceName(value: unknown): string | undefined {
  const reference = short(value);
  if (!reference?.startsWith("#/")) return undefined;
  return reference.split("/").at(-1)?.slice(0, 100);
}

function safeKey(value: string, maximum = 100): string {
  return value.slice(0, maximum);
}

function resolveLocalObject(
  document: JsonObject,
  value: unknown,
): JsonObject | undefined {
  const candidate = object(value);
  const reference = short(candidate?.$ref, 500);
  if (!candidate || !reference?.startsWith("#/")) return candidate;
  let current: unknown = document;
  for (const segment of reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    current = object(current)?.[segment];
  }
  return object(current) ?? candidate;
}

function resolveSchema(document: JsonObject, schema: JsonObject): JsonObject {
  return resolveLocalObject(document, schema) ?? schema;
}

function summarizeSchema(
  document: JsonObject,
  value: unknown,
  depth = 0,
): unknown {
  const schema = object(value);
  if (!schema) return undefined;
  const ref = referenceName(schema.$ref);
  const resolved = resolveSchema(document, schema);
  const result: JsonObject = {};
  if (ref) result.ref = ref;
  const type = short(resolved.type, 40);
  const format = short(resolved.format, 60);
  if (type) result.type = type;
  if (format) result.format = format;
  const required = stringArray(resolved.required);
  if (required.length > 0) result.required = required;
  if (Array.isArray(resolved.enum)) {
    result.enum = resolved.enum
      .filter((item) => ["string", "number", "boolean"].includes(typeof item))
      .slice(0, 8);
  }
  if (depth < 2) {
    const properties = object(resolved.properties);
    if (properties) {
      result.properties = Object.fromEntries(
        Object.entries(properties)
          .slice(0, 12)
          .map(([name, property]) => [
            safeKey(name),
            summarizeSchema(document, property, depth + 1),
          ]),
      );
    }
    const items = summarizeSchema(document, resolved.items, depth + 1);
    if (items) result.items = items;
    for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
      if (Array.isArray(resolved[keyword])) {
        result[keyword] = resolved[keyword]
          .slice(0, 4)
          .map((item) => summarizeSchema(document, item, depth + 1));
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function requestSummary(document: JsonObject, operation: JsonObject): unknown {
  const requestBody = resolveLocalObject(document, operation.requestBody);
  const content = object(requestBody?.content);
  if (content) {
    return Object.fromEntries(
      Object.entries(content)
        .slice(0, 4)
        .map(([mediaType, media]) => [
          safeKey(mediaType),
          summarizeSchema(document, object(media)?.schema),
        ]),
    );
  }
  const bodyParameter = (Array.isArray(operation.parameters)
    ? operation.parameters
    : []
  )
    .map((parameter) => resolveLocalObject(document, parameter))
    .find((parameter) => parameter?.in === "body");
  return bodyParameter
    ? summarizeSchema(document, bodyParameter.schema)
    : undefined;
}

function responseSummary(
  document: JsonObject,
  operation: JsonObject,
): Array<{ status: string; schema?: unknown }> {
  return Object.entries(object(operation.responses) ?? {})
    .slice(0, 10)
    .map(([status, raw]) => {
      const response = resolveLocalObject(document, raw);
      const content = object(response?.content);
      const schemas = content
        ? Object.fromEntries(
            Object.entries(content)
              .slice(0, 3)
              .map(([mediaType, media]) => [
                safeKey(mediaType),
                summarizeSchema(document, object(media)?.schema),
              ]),
          )
        : summarizeSchema(document, response?.schema);
      return {
        status: safeKey(status, 40),
        ...(schemas ? { schema: schemas } : {}),
      };
    });
}

function securitySummary(
  document: JsonObject,
  operation: JsonObject,
): Array<{ scheme: string; scopes: string[] }> {
  const requirements = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(document.security)
      ? document.security
      : [];
  return requirements
    .flatMap((requirement) => Object.entries(object(requirement) ?? {}))
    .slice(0, 8)
    .map(([scheme, scopes]) => ({
      scheme: safeKey(scheme),
      scopes: stringArray(scopes, 10),
    }));
}

function authenticationSummary(document: JsonObject, usedSchemes: Set<string>) {
  const components = object(document.components);
  const schemes =
    object(components?.securitySchemes) ?? object(document.securityDefinitions);
  return Object.entries(schemes ?? {})
    .filter(([scheme]) => usedSchemes.has(scheme))
    .slice(0, 8)
    .map(([scheme, raw]) => {
      const definition = object(raw) ?? {};
      const flows = object(definition.flows);
      const type = short(definition.type, 40);
      const method = short(definition.scheme, 40);
      const location = short(definition.in, 40);
      const parameter = short(definition.name, 80);
      const directScopes = Object.keys(object(definition.scopes) ?? {});
      const scopes = [
        ...new Set(
          [
            ...directScopes,
            ...Object.values(flows ?? {})
              .map(object)
              .flatMap((flow) => Object.keys(object(flow?.scopes) ?? {})),
          ],
        ),
      ]
        .slice(0, 12)
        .map((scope) => safeKey(scope, 120));
      return {
        scheme: safeKey(scheme),
        ...(type ? { type } : {}),
        ...(method ? { method } : {}),
        ...(location ? { location } : {}),
        ...(parameter ? { parameter } : {}),
        ...(scopes.length > 0 ? { scopes } : {}),
      };
    });
}

function tokens(value: string): Set<string> {
  const base = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 2);
  return new Set(
    base.flatMap((token) =>
      token.length > 3 && token.endsWith("s")
        ? [token, token.slice(0, -1)]
        : [token],
    ),
  );
}

function operationScore(taskTokens: Set<string>, text: string): number {
  return [...tokens(text)].reduce(
    (score, token) => score + (taskTokens.has(token) ? 2 : 0),
    0,
  );
}

export function extractOpenApiTaskContext(
  text: string,
  task: string,
  suppliedReceipt?: SourceReceipt,
): OpenApiTaskContext {
  if (Buffer.byteLength(text, "utf8") > MAX_SPEC_BYTES) {
    throw new Error("The confirmed OpenAPI specification exceeds the 1.5 MB limit.");
  }
  const document = object(parse(text, { maxAliasCount: 20 }));
  if (!document || (!document.openapi && !document.swagger)) {
    throw new Error("The confirmed source is not an OpenAPI or Swagger specification.");
  }
  const paths = object(document.paths) ?? {};
  const taskTokens = tokens(task);
  const operations = Object.entries(paths).flatMap(([endpoint, rawPath]) => {
    const pathItem = object(rawPath) ?? {};
    const sharedParameters = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];
    return Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method.toLowerCase()))
      .map(([method, rawOperation]) => {
        const operation = object(rawOperation) ?? {};
        const parameters = [
          ...sharedParameters,
          ...(Array.isArray(operation.parameters) ? operation.parameters : []),
        ]
          .map((parameter) => resolveLocalObject(document, parameter))
          .filter((parameter): parameter is JsonObject => Boolean(parameter))
          .filter((parameter) => parameter.in !== "body")
          .slice(0, 16)
          .map((parameter) => ({
            name: short(parameter.name, 100) ?? "unnamed",
            in: short(parameter.in, 40) ?? "unknown",
            required: parameter.required === true,
            ...(summarizeSchema(document, parameter.schema ?? parameter)
              ? {
                  schema: summarizeSchema(
                    document,
                    parameter.schema ?? parameter,
                  ),
                }
              : {}),
          }));
        const operationId = short(operation.operationId, 120);
        const summary = short(operation.summary);
        const request = requestSummary(document, operation);
        return {
          score: operationScore(
            taskTokens,
            `${method} ${endpoint} ${operationId ?? ""} ${summary ?? ""} ${stringArray(operation.tags).join(" ")} ${JSON.stringify({ parameters, request })}`,
          ),
          method: method.toUpperCase(),
          path: endpoint.slice(0, 240),
          ...(operationId ? { operationId } : {}),
          ...(summary ? { summary } : {}),
          parameters,
          ...(request ? { request } : {}),
          responses: responseSummary(document, operation),
          security: securitySummary(document, operation),
        };
      });
  });
  operations.sort(
    (left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path) ||
      left.method.localeCompare(right.method),
  );
  const relevantOperations = operations.some((operation) => operation.score > 0)
    ? operations.filter((operation) => operation.score > 0)
    : operations;
  const selectedOperations = relevantOperations.slice(0, MAX_OPERATIONS);
  const contentHash = createHash("sha256").update(text).digest("hex");
  const receipt =
    suppliedReceipt ??
    createSourceReceipt({
      sourceDecisionId: taskSourceId("openapi", `pasted:${contentHash}`),
      provider: "openapi",
      requested: sourceIdentityFromReference(
        "openapi",
        `pasted:${contentHash}`,
      ),
      resolved: sourceIdentityFromReference("openapi", `pasted:${contentHash}`),
      adapter: "openapi-pasted",
      route: "runtime:extract-openapi-task-context",
      operation: "parse-confirmed-contract",
      scope: { kind: "document", id: `sha256:${contentHash}` },
      contentHash: `sha256:${contentHash}`,
      observedAt: new Date().toISOString(),
      coverage: "exact",
      freshness: "current",
    });
  const usedSchemes = new Set(
    selectedOperations.flatMap((operation) =>
      operation.security.map(({ scheme }) => scheme),
    ),
  );
  return {
    available: true,
    format: document.openapi ? "openapi" : "swagger",
    contracts: 1,
    operations: selectedOperations
      .map(({ score: _score, ...operation }) => ({
        ...operation,
        sourceReceiptIds: [receipt.id],
      })),
    authentication: authenticationSummary(document, usedSchemes),
    receipts: [receipt],
    conflicts: [],
    errors: [],
  };
}

function localReference(reference: string): string {
  return reference
    .replace(/^(?:openapi|swagger)[:#]\s*/iu, "")
    .replace(/^["']|["']$/gu, "")
    .trim();
}

async function readLocal(rootPath: string, reference: string): Promise<string> {
  const root = await realpath(rootPath);
  const candidate = await realpath(
    path.resolve(rootPath, localReference(reference)),
  );
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("A local OpenAPI source must stay inside the active checkout.");
  }
  const metadata = await stat(candidate);
  if (!metadata.isFile()) {
    throw new Error("The confirmed local OpenAPI source is not a file.");
  }
  if (metadata.size > MAX_SPEC_BYTES) {
    throw new Error("The confirmed OpenAPI specification exceeds the 1.5 MB limit.");
  }
  const content = await readFile(candidate);
  if (content.byteLength > MAX_SPEC_BYTES) {
    throw new Error("The confirmed OpenAPI specification exceeds the 1.5 MB limit.");
  }
  return content.toString("utf8");
}

export async function loadConfirmedOpenApiContext(
  rootPath: string,
  task: string,
  references: Array<string | ConfirmedOpenApiSource>,
  resolver?: OpenApiSourceResolver,
): Promise<OpenApiTaskContext | undefined> {
  const confirmed = references
    .map((source) =>
      typeof source === "string"
        ? {
            sourceDecisionId: taskSourceId("openapi", source),
            reference: source.trim(),
          }
        : { ...source, reference: source.reference.trim() },
    )
    .filter(({ reference }) => Boolean(reference))
    .filter(
      (source, index, collection) =>
        collection.findIndex(
          (candidate) =>
            candidate.sourceDecisionId === source.sourceDecisionId &&
            candidate.reference === source.reference,
        ) === index,
    )
    .slice(0, 3);
  if (confirmed.length === 0) return undefined;
  const contexts: OpenApiTaskContext[] = [];
  const failureReceipts: SourceReceipt[] = [];
  const errors: OpenApiTaskContext["errors"] = [];
  for (const source of confirmed) {
    const requested = sourceIdentityFromReference("openapi", source.reference);
    try {
      const resolvedReference = localReference(source.reference);
      const loaded: ResolvedOpenApiSource = source.content
        ? {
            content: source.content,
            adapter: source.adapter ?? "openapi-pasted",
            route: source.route ?? "caller:confirmed-openapi-content",
            ...(source.operation ? { operation: source.operation } : {}),
            ...(source.observedAt ? { observedAt: source.observedAt } : {}),
            ...(source.version ? { version: source.version } : {}),
            ...(source.fallback ? { fallback: source.fallback } : {}),
          }
        : resolver
          ? await resolver(source)
          : /^https?:\/\//iu.test(resolvedReference)
            ? await canonicalizePublicOpenApiReference(resolvedReference).then(
                (canonical) => ({
                  content: canonical.content,
                  adapter: "openapi-public-http" as const,
                  route: canonical.finalUrl,
                  operation: canonical.operation,
                  ...(canonical.derivation
                    ? { derivation: canonical.derivation }
                    : {}),
                }),
              )
            : {
                content: await readLocal(rootPath, resolvedReference),
                adapter: "openapi-local-file",
                route: resolvedReference,
                operation: "read-confirmed-contract",
              };
      const contentHash = createHash("sha256")
        .update(loaded.content)
        .digest("hex");
      const resolved = {
        ...requested,
        ...(loaded.version ? { version: loaded.version } : {}),
      };
      const receipt = createSourceReceipt({
        sourceDecisionId: source.sourceDecisionId,
        provider: "openapi",
        requested,
        resolved,
        adapter: loaded.adapter ?? "other",
        route: loaded.route,
        operation: loaded.operation ?? "resolve-confirmed-contract",
        scope: { kind: "document", id: requested.canonicalId },
        contentHash: `sha256:${contentHash}`,
        observedAt: loaded.observedAt ?? new Date().toISOString(),
        ...(loaded.fallback ? { fallback: loaded.fallback } : {}),
        ...(loaded.derivation
          ? {
              derivation: {
                kind: loaded.derivation.kind,
                sourceId: requested.canonicalId,
                targetId: loaded.derivation.targetUrl,
                evidenceHash: loaded.derivation.evidenceHash,
                redirectChain: loaded.derivation.redirectChain,
              },
            }
          : {}),
        coverage: "exact",
        freshness: "current",
      });
      if (source.routePolicy) {
        assertSourceReceiptMatchesDecision(
          {
            id: source.sourceDecisionId,
            kind: "openapi",
            reference: source.reference,
            state: "confirmed",
            routePolicy: source.routePolicy,
          },
          receipt,
        );
      }
      contexts.push(extractOpenApiTaskContext(loaded.content, task, receipt));
    } catch (error) {
      const receipt = createSourceReceipt({
        sourceDecisionId: source.sourceDecisionId,
        provider: "openapi",
        requested,
        resolved: requested,
        adapter: source.adapter ?? "other",
        route: source.route ?? source.reference,
        operation: source.operation ?? "resolve-confirmed-contract",
        scope: { kind: "document", id: requested.canonicalId },
        observedAt: source.observedAt ?? new Date().toISOString(),
        ...(source.fallback ? { fallback: source.fallback } : {}),
        coverage: "partial",
        freshness: "unknown",
      });
      failureReceipts.push(receipt);
      errors.push({
        sourceDecisionId: source.sourceDecisionId,
        reference: source.reference,
        receiptId: receipt.id,
        message: error instanceof Error ? error.message : "OpenAPI source failed.",
        required: source.required === true,
        ...((error instanceof Error ? error.message : "").match(/\b(?:HTTP\s*)?(\d{3})\b/iu)?.[1]
          ? { httpStatus: Number((error instanceof Error ? error.message : "").match(/\b(?:HTTP\s*)?(\d{3})\b/iu)![1]) }
          : {}),
        recoverableWithConnector:
          /^https?:\/\//iu.test(source.reference) ||
          source.adapter === "openapi-internal-connector",
      });
    }
  }
  const conflicts: OpenApiTaskContext["conflicts"] = [];
  const operations: OpenApiTaskContext["operations"] = [];
  const grouped = new Map<
    string,
    OpenApiTaskContext["operations"]
  >();
  for (const operation of contexts.flatMap((context) => context.operations)) {
    const key = `${operation.method} ${operation.path}`;
    grouped.set(key, [...(grouped.get(key) ?? []), operation]);
  }
  for (const [key, candidates] of grouped) {
    const variants = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const signature = JSON.stringify({
        operationId: candidate.operationId,
        parameters: candidate.parameters,
        request: candidate.request,
        responses: candidate.responses,
        security: candidate.security,
      });
      variants.set(signature, [...(variants.get(signature) ?? []), candidate]);
    }
    if (variants.size > 1) {
      const [method, ...pathParts] = key.split(" ");
      const receiptIds = [
        ...new Set(candidates.flatMap((candidate) => candidate.sourceReceiptIds)),
      ];
      conflicts.push({
        id: `openapi-conflict-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`,
        method: method!,
        path: pathParts.join(" "),
        receiptIds,
        summary:
          "Confirmed contracts disagree for this operation; Atlas did not choose one silently.",
      });
      continue;
    }
    const first = candidates[0]!;
    operations.push({
      ...first,
      sourceReceiptIds: [
        ...new Set(candidates.flatMap((candidate) => candidate.sourceReceiptIds)),
      ],
    });
  }
  operations.splice(MAX_OPERATIONS);
  const usedSchemes = new Set(
    operations.flatMap((operation) =>
      operation.security.map(({ scheme }) => scheme),
    ),
  );
  const formats = new Set(contexts.map(({ format }) => format));
  const receipts = [
    ...contexts.flatMap((context) => context.receipts),
    ...failureReceipts,
  ];
  return {
    available: contexts.length > 0,
    format:
      formats.size === 1 && contexts[0] ? contexts[0].format : "mixed",
    contracts: contexts.length,
    operations,
    authentication: contexts
      .flatMap((context) => context.authentication)
      .filter(({ scheme }) => usedSchemes.has(scheme))
      .filter(
        (item, index, collection) =>
          collection.findIndex(
            (candidate) => candidate.scheme === item.scheme,
          ) === index,
      ),
    receipts,
    conflicts,
    errors,
  };
}

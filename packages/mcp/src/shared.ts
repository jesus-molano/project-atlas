import {
  findComponent,
  type ComponentGraph,
} from "@component-atlas/core";
import { z } from "zod";

export const taskSourceDecisionSchema = z.object({
  id: z.string().optional(),
  kind: z.enum([
    "jira",
    "confluence",
    "figma",
    "github",
    "openapi",
    "other",
  ]),
  reference: z.string(),
  origin: z.enum(["explicit", "inferred", "manual"]),
  state: z.enum([
    "pending",
    "confirmed",
    "omitted",
    "unavailable",
    "replaced",
  ]),
  required: z.boolean(),
  replacementFor: z.string().optional(),
  parentSourceId: z.string().optional(),
  relationship: z
    .enum(["primary", "search-candidate", "linked-secondary"])
    .optional(),
  authorityRole: z
    .enum([
      "requirement",
      "visual",
      "contract",
      "implementation-reference",
    ])
    .optional(),
  routePolicy: z
    .object({
      primaryAdapter: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u),
      fallback: z.enum(["deny", "ask", "allow-list"]),
      allowedFallbackAdapters: z
        .array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u))
        .max(8)
        .optional(),
    })
    .optional(),
  decidedAt: z.string().optional(),
});

export const taskSourceRelationSchema = z.object({
  id: z.string().optional(),
  fromSourceId: z.string().max(160),
  toSourceId: z.string().max(160),
  kind: z.enum([
    "references-design",
    "constrains-contract",
    "secondary-implementation-reference",
  ]),
  targetScope: z
    .object({
      provider: z.enum([
        "jira",
        "confluence",
        "figma",
        "github",
        "openapi",
        "other",
      ]),
      kind: z.enum([
        "file",
        "page",
        "node",
        "selection",
        "operation",
        "unknown",
      ]),
      id: z.string().min(1).max(500),
    })
    .optional(),
  confirmedAt: z.string().datetime().optional(),
});

export function text(value: unknown) {
  const serialized = JSON.stringify(value) ?? "null";
  const jsonValue = JSON.parse(serialized) as unknown;
  const structuredContent =
    jsonValue !== null && typeof jsonValue === "object" && !Array.isArray(jsonValue)
      ? (jsonValue as Record<string, unknown>)
      : Array.isArray(jsonValue)
        ? { items: jsonValue }
        : { value: jsonValue };
  return {
    content: [
      {
        type: "text" as const,
        text:
          jsonValue &&
          typeof jsonValue === "object" &&
          !Array.isArray(jsonValue) &&
          "metrics" in jsonValue
            ? `Project Atlas returned compact structured context: ${
                (
                  jsonValue as {
                    metrics?: {
                      usedChars?: number;
                      estimatedTokens?: number;
                      truncated?: boolean;
                    };
                  }
                ).metrics?.usedChars ?? serialized.length
              } chars, ~${(
                jsonValue as {
                  metrics?: { estimatedTokens?: number };
                }
              ).metrics?.estimatedTokens ?? Math.ceil(serialized.length / 4)} tokens${
                (
                  jsonValue as {
                    metrics?: { truncated?: boolean };
                  }
                ).metrics?.truncated
                  ? ", truncated to budget"
                  : ""
              }.`
            : `Project Atlas returned structured context (${serialized.length} chars).`,
      },
    ],
    structuredContent,
  };
}

export function requireComponent(graph: ComponentGraph, selector: string) {
  const component = findComponent(graph, selector);
  if (!component) {
    throw new Error(`Component "${selector}" was not found in ${graph.project.name}.`);
  }
  return component;
}

export const figmaVariableCatalogSchema = z
  .object({
    availability: z.enum([
      "global",
      "selection-only",
      "unavailable",
      "permission-required",
    ]),
    source: z
      .enum([
        "figma-desktop-mcp-global",
        "figma-variables-rest",
        "figma-selection",
        "none",
      ])
      .optional(),
    detailLevel: z.enum(["catalog", "expanded"]).optional(),
    valuesIncluded: z.boolean().optional(),
    totalCollections: z.number().int().min(0).optional(),
    totalVariables: z.number().int().min(0).optional(),
    meta: z.record(z.unknown()).optional(),
    variableCollections: z
      .union([z.array(z.unknown()), z.record(z.unknown())])
      .optional(),
    collections: z
      .union([z.array(z.unknown()), z.record(z.unknown())])
      .optional(),
    variables: z
      .union([z.array(z.unknown()), z.record(z.unknown())])
      .optional(),
    note: z.string().max(500).optional(),
  })
  .passthrough()
  .superRefine((catalog, context) => {
    if (
      catalog.availability === "global" &&
      catalog.source !== "figma-desktop-mcp-global" &&
      catalog.source !== "figma-variables-rest"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message:
          "Global availability requires an explicitly confirmed file-global source.",
      });
    }
  });

const memoryRelation = z.object({
  kind: z.enum([
    "belongs_to",
    "depends_on",
    "implements",
    "affects",
    "decided_by",
    "motivated_by",
    "contradicts",
    "supersedes",
    "verified_by",
    "failed_for",
    "fixed_by",
    "related_to",
    "references_code",
    "references_design",
    "references_ticket",
  ]),
  targetId: z.string(),
  summary: z.string().optional(),
});

export const memoryDraft = z.object({
  id: z.string().optional(),
  namespace: z.string().optional(),
  type: z.enum([
    "project",
    "domain",
    "glossary-term",
    "subsystem",
    "module",
    "convention",
    "decision",
    "constraint",
    "integration",
    "known-issue",
    "fragile-area",
    "attempt",
    "outcome",
    "plan",
    "debt",
    "note",
  ]),
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().optional(),
  status: z.enum(["proposed", "active", "archived", "rejected"]).optional(),
  confidence: z.number().min(0).max(1),
  authority: z.enum(["observed", "inferred", "decided", "verified"]),
  scope: z.enum(["canonical", "local", "episodic"]).optional(),
  verifiedAt: z.string().optional(),
  owner: z.string().optional(),
  tags: z.array(z.string()).optional(),
  supersedes: z.array(z.string()).optional(),
  expiresAt: z.string().optional(),
  reviewAfter: z.string().optional(),
  relations: z.array(memoryRelation).optional(),
});

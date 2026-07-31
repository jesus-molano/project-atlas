import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assessTaskRisk,
  ensureTaskSourceDecisions,
  taskSourceId,
  type TaskIntakeState,
  type TaskSourceDecision,
} from "@component-atlas/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  preflightConfirmedSourceIntegrity,
  prepareTaskContext,
  TaskPreparationBlockedError,
} from "./task-preparation.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  delete process.env.PROJECT_ATLAS_HOME;
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function openApiFixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-task-preflight-"));
  const atlasHome = await mkdtemp(
    path.join(os.tmpdir(), "atlas-task-preflight-home-"),
  );
  temporaryRoots.push(root, atlasHome);
  process.env.PROJECT_ATLAS_HOME = atlasHome;
  await execFileAsync("git", ["init"], { cwd: root });
  return root;
}

function openApiDecision(
  reference: string,
  required: boolean,
): TaskSourceDecision {
  return {
    id: taskSourceId("openapi", reference),
    kind: "openapi",
    reference,
    origin: "explicit",
    state: "confirmed",
    required,
    relationship: "primary",
    authorityRole: "contract",
    routePolicy: {
      primaryAdapter: "openapi-pasted",
      fallback: "deny",
    },
    decidedAt: "2026-07-31T12:00:00.000Z",
  };
}

function openApiDocument(operationPath: string): string {
  return JSON.stringify({
    openapi: "3.1.0",
    info: { title: operationPath, version: "1" },
    paths: {
      [operationPath]: {
        get: {
          operationId: `get${operationPath.replace(/[^a-z]+/giu, "-")}`,
          responses: { 200: { description: "ok" } },
        },
      },
    },
  });
}

function intake(
  objective: string,
  sources = ensureTaskSourceDecisions(objective, []),
): TaskIntakeState {
  return {
    schemaVersion: 1,
    scope: "task",
    objective,
    objectiveConfirmed: true,
    risk: assessTaskRisk(objective),
    sources,
  };
}

describe("guarded task preparation", () => {
  it("does not invent source gates for a high-risk task without declared sources", async () => {
    const getContext = vi.fn();
    getContext.mockResolvedValue({ ok: true } as never);
    await expect(
      prepareTaskContext(
        "/repo",
        intake("Change production authentication"),
        {},
        { getContext },
      ),
    ).resolves.toEqual({ ok: true });
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("calls context generation only after all high-risk source decisions resolve", async () => {
    const sequence: string[] = [];
    const objective = "Change production authentication";
    const sources = ensureTaskSourceDecisions(objective, []).map((source) => ({
      ...source,
      state: "omitted" as const,
      decidedAt: "2026-07-29T12:00:00.000Z",
    }));
    const getContext = vi.fn(async () => {
      sequence.push("context");
      return { ok: true } as never;
    });
    sequence.push("gate");
    await prepareTaskContext("/repo", intake(objective, sources), {}, {
      getContext,
    });
    expect(sequence).toEqual(["gate", "context"]);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("blocks an unresolved exact source before composing any local context", async () => {
    const sequence: string[] = [];
    const objective =
      "Match exactly https://www.figma.com/design/AtlasFile/Recovery?node-id=60-2";
    const sources = ensureTaskSourceDecisions(objective, []).map((source) => ({
      ...source,
      state: "confirmed" as const,
      decidedAt: "2026-07-29T12:00:00.000Z",
    }));
    const getContext = vi.fn(async () => {
      sequence.push("context");
      return { ok: true } as never;
    });
    const preflightSources = vi.fn(async () => {
      sequence.push("source-preflight");
      return {
        reasons: ["The exact confirmed Figma node has not been synchronized."],
      };
    });
    await expect(
      prepareTaskContext("/repo", intake(objective, sources), {}, {
        getContext,
        preflightSources,
      }),
    ).rejects.toBeInstanceOf(TaskPreparationBlockedError);
    expect(sequence).toEqual(["source-preflight"]);
    expect(getContext).not.toHaveBeenCalled();
  });

  it("preloads required and optional confirmed OpenAPI contracts together", async () => {
    const root = await openApiFixtureRoot();
    const requiredReference = "pasted:required-orders";
    const optionalReference = "pasted:optional-catalog";
    const decisions = [
      openApiDecision(requiredReference, true),
      openApiDecision(optionalReference, false),
    ];

    const preflight = await preflightConfirmedSourceIntegrity(
      root,
      "Load orders and catalog data",
      decisions,
      undefined,
      [],
      decisions.map((decision, index) => ({
        sourceDecisionId: decision.id,
        reference: decision.reference,
        required: decision.required,
        content: openApiDocument(index === 0 ? "/orders" : "/catalog"),
        adapter: "openapi-pasted",
        route: `caller:${index === 0 ? "orders" : "catalog"}`,
        operation: "parse-confirmed-contract",
        observedAt: "2026-07-31T12:00:00.000Z",
        routePolicy: decision.routePolicy,
      })),
    );

    expect(preflight.reasons).toEqual([]);
    expect(preflight.preloadedOpenApiContext).toMatchObject({
      contracts: 2,
      errors: [],
      operations: expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/orders" }),
        expect.objectContaining({ method: "GET", path: "/catalog" }),
      ]),
    });
  });

  it("keeps an optional OpenAPI failure advisory when a required contract resolves", async () => {
    const root = await openApiFixtureRoot();
    const required = openApiDecision("pasted:required-orders", true);
    const optional = {
      ...openApiDecision("https://api.example.test/optional.json", false),
      routePolicy: {
        primaryAdapter: "openapi-internal-connector",
        fallback: "deny" as const,
      },
    };

    const preflight = await preflightConfirmedSourceIntegrity(
      root,
      "Load orders",
      [required, optional],
      async (source) => {
        throw new Error(
          `The optional connector returned HTTP 503 for ${source.sourceDecisionId}.`,
        );
      },
      [],
      [
        {
          sourceDecisionId: required.id,
          reference: required.reference,
          required: true,
          content: openApiDocument("/orders"),
          adapter: "openapi-pasted",
          route: "caller:orders",
          operation: "parse-confirmed-contract",
          observedAt: "2026-07-31T12:00:00.000Z",
          routePolicy: required.routePolicy,
        },
        {
          sourceDecisionId: optional.id,
          reference: optional.reference,
          required: false,
          adapter: "openapi-internal-connector",
          route: "internal-connector:optional-contract",
          operation: "read_openapi_document",
          observedAt: "2026-07-31T12:00:00.000Z",
          routePolicy: optional.routePolicy,
        },
      ],
    );

    expect(preflight.reasons).toEqual([]);
    expect(preflight.preloadedOpenApiContext).toMatchObject({
      contracts: 1,
      operations: [expect.objectContaining({ path: "/orders" })],
      errors: [
        expect.objectContaining({
          sourceDecisionId: optional.id,
          required: false,
          httpStatus: 503,
          recoverableWithConnector: true,
        }),
      ],
    });
  });

  it("prioritizes a required contract ahead of three optional contracts", async () => {
    const root = await openApiFixtureRoot();
    const optional = [0, 1, 2].map((index) =>
      openApiDecision(`pasted:optional-${index}`, false),
    );
    const required = openApiDecision("pasted:required-current", true);
    const decisions = [...optional, required];

    const preflight = await preflightConfirmedSourceIntegrity(
      root,
      "Load the required current operation",
      decisions,
      undefined,
      [],
      decisions.map((decision, index) => ({
        sourceDecisionId: decision.id,
        reference: decision.reference,
        required: decision.required,
        content: openApiDocument(
          decision.required ? "/required/current" : `/optional/${index}`,
        ),
        adapter: "openapi-pasted",
        route: `caller:contract-${index}`,
        operation: "parse-confirmed-contract",
        observedAt: "2026-07-31T12:00:00.000Z",
        routePolicy: decision.routePolicy,
      })),
    );

    expect(preflight.reasons).toEqual([]);
    expect(preflight.selectedOpenApiSources).toHaveLength(3);
    expect(preflight.selectedOpenApiSources?.[0]?.sourceDecisionId).toBe(
      required.id,
    );
    expect(preflight.warnings).toEqual([
      expect.stringContaining("deferred optional sources"),
    ]);
    expect(preflight.preloadedOpenApiContext).toMatchObject({
      contracts: 3,
      operations: expect.arrayContaining([
        expect.objectContaining({ path: "/required/current" }),
      ]),
    });
  });

  it("blocks more than three required OpenAPI contracts explicitly", async () => {
    const root = await openApiFixtureRoot();
    const decisions = [0, 1, 2, 3].map((index) =>
      openApiDecision(`pasted:required-${index}`, true),
    );

    const preflight = await preflightConfirmedSourceIntegrity(
      root,
      "Load every required contract",
      decisions,
      undefined,
      [],
      decisions.map((decision, index) => ({
        sourceDecisionId: decision.id,
        reference: decision.reference,
        required: true,
        content: openApiDocument(`/required/${index}`),
        adapter: "openapi-pasted",
        route: `caller:required-${index}`,
        operation: "parse-confirmed-contract",
        observedAt: "2026-07-31T12:00:00.000Z",
        routePolicy: decision.routePolicy,
      })),
    );

    expect(preflight.reasons).toEqual([
      expect.stringContaining("at most three required contracts"),
    ]);
    expect(preflight.preloadedOpenApiContext).toBeUndefined();
  });
});

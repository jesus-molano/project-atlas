import {
  assessTaskIntake,
  assertSourceReceiptMatchesDecision,
  confirmedTaskSources,
  ensureTaskSourceDecisions,
  taskContextSourcePolicy,
  type TaskIntakeAssessment,
  type TaskIntakeState,
  type TaskSourceDecision,
  type TaskSourceRelation,
} from "@component-atlas/core";
import {
  parseFigmaReference,
  resolveExplicitDesignTarget,
} from "@component-atlas/design";
import { AtlasStore } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { getTaskContext } from "./memory-task-context.js";
import {
  loadConfirmedOpenApiContext,
  type ConfirmedOpenApiSource,
  type OpenApiSourceResolver,
  type OpenApiTaskContext,
} from "./openapi.js";
import { persistSourceReceipts } from "./task-state.js";

export class TaskPreparationBlockedError extends Error {
  readonly assessment: TaskIntakeAssessment;

  constructor(assessment: TaskIntakeAssessment) {
    super(assessment.reasons.join(" "));
    this.name = "TaskPreparationBlockedError";
    this.assessment = assessment;
  }
}

export type TaskContextOptions = NonNullable<
  Parameters<typeof getTaskContext>[2]
>;

export interface GuardedTaskContextDependencies {
  getContext: typeof getTaskContext;
  preflightSources?: typeof preflightConfirmedSourceIntegrity;
}

export interface TaskSourcePreflight {
  reasons: string[];
  preloadedOpenApiContext?: OpenApiTaskContext;
}

function sourceBlockReason(title: string, recommendation: string): string {
  return `${title}. ${recommendation}`;
}

export async function preflightConfirmedSourceIntegrity(
  rootPath: string,
  objective: string,
  confirmed: TaskSourceDecision[],
  openApiResolver?: OpenApiSourceResolver,
  relations: TaskSourceRelation[] = [],
): Promise<TaskSourcePreflight> {
  const reasons: string[] = [];
  const figmaSources = confirmed.filter((source) => source.kind === "figma");
  if (figmaSources.length > 0) {
    const parsedTargets = figmaSources.map((source) => {
      try {
        return { source, target: parseFigmaReference(source.reference) };
      } catch {
        reasons.push(
          `The confirmed Figma reference is invalid: ${source.reference.slice(0, 180)}.`,
        );
        return undefined;
      }
    }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const explicitNodes = parsedTargets.filter(({ target }) =>
      Boolean(target.nodeId),
    );
    if (explicitNodes.length > 1) {
      reasons.push(
        "Multiple exact Figma nodes are confirmed. Define one authoritative target or explicitly describe their shared scope before context retrieval.",
      );
    } else if (parsedTargets.length > 0) {
      const identity = await resolveProjectIdentity(rootPath);
      const store = new AtlasStore(identity.logicalId);
      try {
        for (const { source, target } of parsedTargets) {
          const index = store.loadDesignIndex(identity.logicalId, target.fileKey);
          if (!index) {
            reasons.push(
              `The confirmed Figma target ${target.fileKey}${target.nodeId ? `::${target.nodeId}` : ""} has not been synchronized. Map this exact target through Figma Desktop MCP before context retrieval; Atlas candidates cannot replace it.`,
            );
            continue;
          }
          const authoritativeReceipts = index.sources
            .map((entry) => entry.receipt)
            .filter((receipt) => receipt.sourceDecisionId === source.id)
            .filter((receipt) => {
              try {
                assertSourceReceiptMatchesDecision(source, receipt);
                return true;
              } catch {
                return false;
              }
            });
          if (authoritativeReceipts.length === 0) {
            reasons.push(
              `The confirmed Figma source ${source.id} has no current exact receipt from its authorized provider route. Re-synchronize it with the same task_id and source_decision_id; do not substitute another connector.`,
            );
            continue;
          }
          const relatedScope = relations.find(
            (relation) =>
              relation.toSourceId === source.id &&
              relation.targetScope?.provider === "figma" &&
              ["node", "selection"].includes(
                relation.targetScope?.kind ?? "",
              ),
          )?.targetScope;
          if (relatedScope) {
            const scoped = resolveExplicitDesignTarget(index, relatedScope.id);
            const receiptProvesScope = authoritativeReceipts.some(
              (receipt) =>
                receipt.scope.id === relatedScope.id &&
                receipt.scopeRelation?.targetId === relatedScope.id &&
                (receipt.scopeRelation.sourceId === target.nodeId ||
                  receipt.scopeRelation.sourceId === target.fileKey),
            );
            if (scoped.gate.status === "blocked" || !receiptProvesScope) {
              reasons.push(
                `The selected Figma scope ${relatedScope.id} is not proven within confirmed source ${source.id}. Re-synchronize that exact contained scope through the authorized provider route.`,
              );
            }
            continue;
          }
          if (target.nodeId) {
            const resolved = resolveExplicitDesignTarget(index, target.nodeId);
            if (resolved.gate.status === "blocked") {
              reasons.push(
                ...resolved.findings
                  .filter((finding) => finding.level === "decision-required")
                  .slice(0, 2)
                  .map((finding) =>
                    sourceBlockReason(
                      finding.title,
                      finding.recommendation,
                    ),
                  ),
              );
            }
            continue;
          }
          const currentFileReceipt = authoritativeReceipts.some(
            (receipt) => receipt.resolved.fileKey === target.fileKey,
          );
          if (!currentFileReceipt) {
            reasons.push(
              `The confirmed Figma file ${target.fileKey} has no exact current source receipt. Synchronize that file through the confirmed adapter before context retrieval.`,
            );
          }
        }
      } finally {
        store.close();
      }
    }
  }

  const requiredOpenApi = confirmed
    .filter((source) => source.kind === "openapi" && source.required)
    .map((source) => ({
      sourceDecisionId: source.id,
      reference: source.reference,
      ...(source.routePolicy ? { routePolicy: source.routePolicy } : {}),
    }));
  let preloadedOpenApiContext: OpenApiTaskContext | undefined;
  if (requiredOpenApi.length > 0) {
    preloadedOpenApiContext = await loadConfirmedOpenApiContext(
      rootPath,
      objective,
      requiredOpenApi,
      openApiResolver,
    );
    if (!preloadedOpenApiContext) {
      reasons.push(
        "No required OpenAPI contract could be resolved from the confirmed source ledger.",
      );
    } else {
      await persistSourceReceipts(
        rootPath,
        preloadedOpenApiContext.receipts,
      );
    }
    reasons.push(
      ...(preloadedOpenApiContext?.errors.map(
        (failure) =>
          `A required OpenAPI contract could not be resolved (${failure.receiptId}). ${failure.message}`,
      ) ?? []),
      ...(preloadedOpenApiContext?.conflicts.map(
        (conflict) =>
          `Required OpenAPI contracts conflict for ${conflict.method} ${conflict.path}. Confirm the governing contract or version before context retrieval.`,
      ) ?? []),
    );
  }
  return {
    reasons,
    ...(preloadedOpenApiContext ? { preloadedOpenApiContext } : {}),
  };
}

/**
 * The sole runtime entrance for user-task context generation.
 *
 * Intake is assessed before Project Memory is indexed, Design Atlas is queried,
 * an OpenAPI contract is loaded, or any connector-resolved content is consumed.
 */
export async function prepareTaskContext(
  rootPath: string,
  intake: TaskIntakeState,
  options: Omit<
    TaskContextOptions,
    | "sourcePolicy"
    | "confirmedFigmaReferences"
    | "confirmedOpenApiReferences"
    | "confirmedOpenApiSources"
    | "preloadedOpenApiContext"
  > = {},
  dependencies: GuardedTaskContextDependencies = { getContext: getTaskContext },
) {
  const effectiveIntake: TaskIntakeState = {
    ...intake,
    sources: ensureTaskSourceDecisions(intake.objective, intake.sources),
  };
  const assessment = assessTaskIntake(effectiveIntake);
  if (assessment.status !== "ready") {
    throw new TaskPreparationBlockedError(assessment);
  }

  const confirmed = confirmedTaskSources(effectiveIntake.sources);
  const openApiSources: ConfirmedOpenApiSource[] = confirmed
    .filter((source) => source.kind === "openapi")
    .map((source) => ({
      sourceDecisionId: source.id,
      reference: source.reference,
    }));
  const preflight = await (
    dependencies.preflightSources ?? preflightConfirmedSourceIntegrity
  )(
    rootPath,
    intake.objective,
    confirmed,
    options.openApiResolver,
    effectiveIntake.relations ?? [],
  );
  if (preflight.reasons.length > 0) {
    throw new TaskPreparationBlockedError({
      status: "blocked",
      reasons: preflight.reasons,
    });
  }

  return dependencies.getContext(rootPath, intake.objective, {
    ...options,
    sourcePolicy: taskContextSourcePolicy(
      effectiveIntake.sources,
      effectiveIntake.relations ?? [],
    ),
    confirmedFigmaReferences: confirmed
      .filter((source) => source.kind === "figma")
      .map((source) => source.reference),
    confirmedOpenApiSources: openApiSources,
    ...(preflight.preloadedOpenApiContext
      ? { preloadedOpenApiContext: preflight.preloadedOpenApiContext }
      : {}),
  });
}

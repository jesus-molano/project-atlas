import { createHash } from "node:crypto";
import type {
  buildChangeSurface,
  TaskRiskAssessment,
  TaskSourceDecision,
  TaskSourceRelation,
} from "@component-atlas/core";
import {
  fitBudgetedResponse,
  loadTaskResumeCapsule,
  resolveTaskObjective,
  type ResolvedTaskObjective,
  type TaskObjectiveReference,
} from "@component-atlas/runtime";

export const taskRiskRank: Record<TaskRiskAssessment["level"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sourceLedgerFingerprint(
  decisions: TaskSourceDecision[],
  relations: TaskSourceRelation[],
  receiptIds: string[],
): string {
  return stableHash({
    decisions: decisions
      .map((source) => ({
        id: source.id,
        kind: source.kind,
        reference: source.reference,
        state: source.state,
        required: source.required,
        relationship: source.relationship,
        authorityRole: source.authorityRole,
        routePolicy: source.routePolicy,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    relations: [...relations].sort((left, right) =>
      `${left.fromSourceId}\0${left.toSourceId}\0${left.kind}`.localeCompare(
        `${right.fromSourceId}\0${right.toSourceId}\0${right.kind}`,
      ),
    ),
    receiptIds: [...new Set(receiptIds)].sort(),
  });
}

export function mergedObjective(
  prior: string | undefined,
  update: string,
): string {
  const next = update.trim();
  if (!prior || prior.trim() === next || prior.includes(`Update: ${next}`)) {
    return prior?.trim() || next;
  }
  const merged = `${prior.trim()}\nUpdate: ${next}`;
  if (merged.length > 6_000) {
    throw new Error(
      "The cumulative objective exceeds 6,000 characters. Provide one consolidated complete objective; Atlas will never truncate authority silently.",
    );
  }
  return merged;
}

export function compact<T extends Record<string, unknown>>(
  value: T,
  budgetChars: number,
  expandableIds: string[] = [],
) {
  return fitBudgetedResponse(value, {
    budgetChars,
    totalMatches: expandableIds.length,
    expandableIds,
    preserveKeys: ["taskId", "risk", "status", "gate", "findings"],
  });
}

export function surfaceProjection(
  surface: ReturnType<typeof buildChangeSurface>,
) {
  return {
    selection: surface.selection,
    ...(surface.primary ? { primary: surface.primary } : {}),
    ...(surface.primarySurface ? { primarySurface: surface.primarySurface } : {}),
    references: surface.references.map((reference) => ({
      id: reference.component.id,
      path: reference.component.path,
      role: reference.role,
    })),
    files: surface.files.map((file) => ({ path: file.path, role: file.role })),
    authorizedFiles: surface.authorizedFiles,
    outOfScope: surface.outOfScope,
    ...(surface.impact ? { impact: surface.impact } : {}),
  };
}

export async function requireCapsule(rootPath: string, id: string) {
  const capsule = await loadTaskResumeCapsule(rootPath, id);
  if (!capsule) throw new Error(`Task ${id} has no Project Atlas capsule.`);
  return capsule;
}

export async function requireAuthoritativeObjective(
  rootPath: string,
  id: string,
): Promise<
  ResolvedTaskObjective & {
    authority: "authoritative";
    reference: TaskObjectiveReference;
  }
> {
  const objective = await resolveTaskObjective(rootPath, id);
  if (
    !objective ||
    objective.authority !== "authoritative" ||
    !objective.reference
  ) {
    throw new Error(
      `Task ${id} has no authoritative full objective; confirm it through atlas_prepare_task before locking, validating, or completing.`,
    );
  }
  return objective as ResolvedTaskObjective & {
    authority: "authoritative";
    reference: TaskObjectiveReference;
  };
}

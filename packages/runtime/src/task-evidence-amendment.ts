import { canonicalJson } from "./change-surface-fingerprint.js";
import { normalizeCriterionProgress } from "./task-evidence-contract-normalization.js";
import type {
  PersistTaskEvidenceContractInput,
  TaskCriterionProgress,
  TaskEvidenceContract,
  TaskEvidenceCriterion,
  TaskEvidenceDecision,
} from "./task-evidence-contract.js";

export interface TaskEvidenceCriterionPatch {
  id: string;
  statement: string;
  required: boolean;
  sourceRefs?: string[];
  /** Criterion IDs replaced by this patch. They are removed from the new contract. */
  supersedes?: string[];
}

export interface TaskEvidenceDecisionPatch extends TaskEvidenceDecision {
  /** Decision IDs replaced by this patch. They are removed from the new contract. */
  supersedes?: string[];
}

export interface TaskEvidenceContractAmendment {
  taskId: string;
  contractHandle: string;
  criteria?: TaskEvidenceCriterionPatch[];
  decisions?: TaskEvidenceDecisionPatch[];
  constraints?: string[];
  exclusions?: string[];
  sourceReceiptIds?: string[];
  contextHandles?: string[];
  createdAt?: string;
}

interface TaskEvidenceAmendmentDependencies {
  loadContract(rootPath: string, handle: string): Promise<TaskEvidenceContract>;
  persistContract(
    rootPath: string,
    input: PersistTaskEvidenceContractInput,
  ): Promise<TaskEvidenceContract>;
}

/**
 * Builds the amendment API from the contract storage operations. Keeping the
 * dependency injection here avoids a runtime cycle with the contract module,
 * which continues to expose the same public functions.
 */
export function createTaskEvidenceAmendmentApi(
  dependencies: TaskEvidenceAmendmentDependencies,
) {
  async function amendTaskEvidenceContract(
    rootPath: string,
    input: TaskEvidenceContractAmendment,
  ): Promise<TaskEvidenceContract> {
    const current = await dependencies.loadContract(rootPath, input.contractHandle);
    if (current.taskId !== input.taskId) {
      throw new Error("Task contract amendment belongs to a different task.");
    }
    const criterionPatches = input.criteria ?? [];
    const decisionPatches = input.decisions ?? [];
    if (
      criterionPatches.length === 0 &&
      decisionPatches.length === 0 &&
      input.constraints === undefined &&
      input.exclusions === undefined
    ) {
      throw new Error("A task contract amendment requires an explicit patch.");
    }
    const replacements = new Set<string>();
    const additions: TaskEvidenceCriterion[] = [];
    for (const patch of criterionPatches) {
      const supersedes = [...new Set(patch.supersedes ?? [])];
      if (
        current.criteria.some((criterion) => criterion.id === patch.id) &&
        !supersedes.includes(patch.id)
      ) {
        throw new Error(
          "Replacing an existing criterion requires explicit self-supersession.",
        );
      }
      for (const id of supersedes) {
        if (!current.criteria.some((criterion) => criterion.id === id)) {
          throw new Error(
            "A criterion amendment can only supersede a current criterion.",
          );
        }
        if (replacements.has(id)) {
          throw new Error(
            "A criterion can only be superseded once per amendment.",
          );
        }
        replacements.add(id);
      }
      additions.push({
        id: patch.id,
        statement: patch.statement,
        required: patch.required,
        sourceRefs: patch.sourceRefs ?? [],
        ...(supersedes.length ? { supersedes } : {}),
      });
    }
    const criteria = [
      ...current.criteria.filter((criterion) => !replacements.has(criterion.id)),
      ...additions,
    ];
    const decisionReplacements = new Set<string>();
    const decisionAdditions: TaskEvidenceDecision[] = [];
    for (const patch of decisionPatches) {
      const supersedes = [...new Set(patch.supersedes ?? [])];
      if (
        current.decisions.some((decision) => decision.id === patch.id) &&
        !supersedes.includes(patch.id)
      ) {
        throw new Error(
          "Replacing an existing decision requires explicit self-supersession.",
        );
      }
      for (const id of supersedes) {
        if (!current.decisions.some((decision) => decision.id === id)) {
          throw new Error(
            "A decision amendment can only supersede a current decision.",
          );
        }
        if (decisionReplacements.has(id)) {
          throw new Error("A decision can only be superseded once per amendment.");
        }
        decisionReplacements.add(id);
      }
      decisionAdditions.push({
        id: patch.id,
        question: patch.question,
        status: patch.status,
        ...(patch.answer ? { answer: patch.answer } : {}),
        sourceRefs: patch.sourceRefs ?? [],
        ...(supersedes.length ? { supersedes } : {}),
      });
    }
    const decisions = [
      ...current.decisions.filter(
        (decision) => !decisionReplacements.has(decision.id),
      ),
      ...decisionAdditions,
    ];
    return dependencies.persistContract(rootPath, {
      taskId: current.taskId,
      objective: current.objective,
      objectiveHash: current.objectiveHash,
      sourceLedgerHash: current.sourceLedgerHash,
      criteria,
      decisions,
      constraints: input.constraints ?? current.constraints,
      exclusions: input.exclusions ?? current.exclusions,
      sourceReceiptIds: input.sourceReceiptIds ?? current.sourceReceiptIds,
      contextHandles: input.contextHandles ?? current.contextHandles,
      previousHandle: current.handle,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    });
  }

  function preserveTaskCriterionProgress(
    previousContract: TaskEvidenceContract,
    previous: TaskCriterionProgress[],
    nextContract: TaskEvidenceContract,
  ): TaskCriterionProgress[] {
    const progress = new Map(
      normalizeCriterionProgress(previous).map((item) => [item.criterionId, item]),
    );
    const before = new Map(
      previousContract.criteria.map((criterion) => [criterion.id, criterion]),
    );
    return nextContract.criteria.map((criterion) => {
      const prior = before.get(criterion.id);
      const priorProgress = progress.get(criterion.id);
      if (
        prior &&
        priorProgress &&
        canonicalJson(prior) === canonicalJson(criterion)
      ) {
        return priorProgress;
      }
      return {
        criterionId: criterion.id,
        status: "pending",
        evidenceRefs: [],
        validationRefs: [],
      };
    });
  }

  return { amendTaskEvidenceContract, preserveTaskCriterionProgress };
}

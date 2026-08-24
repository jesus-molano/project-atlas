import { randomUUID } from "node:crypto";
import {
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  recoverTaskResumeState,
  resolveTaskObjective,
} from "@component-atlas/runtime";
import { compact } from "./core-tool-helpers.js";
import { completedTaskPrepareResult } from "./core-prepare-reuse.js";
import { text } from "./shared.js";

/**
 * Resolves the one task that prepare may operate on. This is intentionally
 * separate from the repository/source preflight so implicit continuation can
 * never silently create a sibling task.
 */
export async function prepareTaskFocus(input: {
  rootPath: string;
  objective: string;
  taskId?: string;
  startNewTask?: boolean;
  budget: number;
}) {
  const { rootPath, objective, taskId, startNewTask, budget } = input;
  if (startNewTask && taskId) {
    throw new Error("start_new_task cannot be combined with task_id.");
  }

  let id: string;
  let reusedImplicitly = false;
  if (taskId) {
    id = taskId;
  } else if (startNewTask) {
    id = `task-${randomUUID()}`;
  } else {
    const recovery = await recoverTaskResumeState(rootPath);
    if (recovery.status === "ready") {
      id = recovery.recommendedTaskId;
      reusedImplicitly = true;
    } else if (recovery.status === "selection-required") {
      return {
        response: text(
          compact(
            {
              status: "selection-required",
              candidateCount: recovery.candidateCount,
              candidates: recovery.candidates.map((candidate) => ({
                taskId: candidate.taskId,
                title: candidate.title,
                status: candidate.status,
                updatedAt: candidate.updatedAt,
                objective: candidate.objective.slice(0, 240),
              })),
              recommendedTaskId: recovery.recommendedTaskId,
              recommendationReason: recovery.recommendationReason,
              nextAction:
                "Resume the recommended task explicitly or set start_new_task=true for a separate objective.",
            },
            budget,
          ),
        ),
      };
    } else {
      id = `task-${randomUUID()}`;
    }
  }

  const finalReceipt = await loadTaskFinalReceipt(rootPath, id);
  if (finalReceipt) return { response: completedTaskPrepareResult(id, budget) };
  const prior = await loadTaskResumeCapsule(rootPath, id);
  if (prior?.status === "completed" || prior?.lifecycle.phase === "completed") {
    return { response: completedTaskPrepareResult(id, budget) };
  }
  // Loading a capsule also prunes expired completed state. Recheck the
  // immutable receipt so prepare cannot recreate a just-pruned task.
  if (!prior && (await loadTaskFinalReceipt(rootPath, id))) {
    return { response: completedTaskPrepareResult(id, budget) };
  }
  const priorObjective = await resolveTaskObjective(rootPath, id);
  if (reusedImplicitly && priorObjective?.text.trim() !== objective.trim()) {
    return {
      response: text(
        compact(
          {
            taskId: id,
            title: prior?.title,
            status: "feedback-required",
            objective: priorObjective?.text,
            feedback: objective,
            repositoryScanned: false,
            nextAction:
              "Append this observation with atlas_task_state action=append-feedback, or set start_new_task=true for a separate objective.",
          },
          budget,
        ),
      ),
    };
  }

  return { id, reusedImplicitly, prior, priorObjective };
}

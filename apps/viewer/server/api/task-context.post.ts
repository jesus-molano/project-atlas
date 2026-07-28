import {
  assessTaskIntake,
  assessTaskRisk,
  normalizeTaskSourceDecisions,
  taskContextSourcePolicy,
  type TaskSourceDecision,
} from "@component-atlas/core";
import { getTaskContext } from "@component-atlas/runtime";
import { assertAgentSession } from "../utils/agent-session";
import { projectRootPath } from "../utils/project";

interface TaskContextBody {
  task?: string;
  figmaFile?: string;
  budgetChars?: number;
  topK?: number;
  selectedHandles?: string[];
  objectiveConfirmed?: boolean;
  sourceDecisions?: TaskSourceDecision[];
}

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const body = await readBody<TaskContextBody>(event);
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: "Request body is required." });
  }
  const task = body.task?.trim();
  if (!task) {
    throw createError({
      statusCode: 400,
      statusMessage: "Describe the task before generating context.",
    });
  }
  let sources: TaskSourceDecision[];
  try {
    sources = normalizeTaskSourceDecisions(body.sourceDecisions ?? []);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : "The source ledger is invalid.",
    });
  }
  const intake = assessTaskIntake({
    schemaVersion: 1,
    scope: "task",
    objective: task,
    objectiveConfirmed: body.objectiveConfirmed ?? false,
    risk: assessTaskRisk(task),
    sources,
  });
  if (intake.status !== "ready") {
    throw createError({
      statusCode: 409,
      statusMessage: intake.reasons.join(" "),
    });
  }
  return getTaskContext(projectRootPath(), task, {
    ...(body.figmaFile ? { figmaFile: body.figmaFile } : {}),
    ...(body.budgetChars ? { budgetChars: body.budgetChars } : {}),
    ...(body.topK ? { topK: body.topK } : {}),
    ...(body.selectedHandles ? { selectedHandles: body.selectedHandles } : {}),
    sourcePolicy: taskContextSourcePolicy(sources),
    confirmedFigmaReferences: sources
      .filter(
        (source) =>
          source.kind === "figma" && source.state === "confirmed",
      )
      .map((source) => source.reference),
  });
});

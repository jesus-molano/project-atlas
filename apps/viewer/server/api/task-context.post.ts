import { randomUUID } from "node:crypto";
import {
  assessTaskRisk,
  normalizeTaskSourceDecisions,
  type TaskSourceDecision,
} from "@component-atlas/core";
import {
  taskContextResumeHandles,
  writeTaskCheckpoint,
} from "@component-atlas/runtime";
import {
  prepareTaskContext,
  TaskPreparationBlockedError,
} from "@component-atlas/runtime/task-preparation";
import { assertAgentSession } from "../utils/agent-session";
import { projectRootPath } from "../utils/project";

interface TaskContextBody {
  taskId?: string;
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
  const taskId = body.taskId?.trim() || `task-${randomUUID()}`;
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(taskId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "The task checkpoint ID is invalid.",
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
  const intake = {
    schemaVersion: 1 as const,
    scope: "task" as const,
    objective: task,
    objectiveConfirmed: body.objectiveConfirmed ?? false,
    risk: assessTaskRisk(task),
    sources,
  };
  const budgetChars = body.budgetChars ?? 4_200;
  await writeTaskCheckpoint(projectRootPath(), {
    taskId,
    milestone: "risk-boundary",
    objective: task,
    objectiveApproved: intake.objectiveConfirmed,
    decisions: sources,
    sourceReceiptIds: [],
    handles: body.selectedHandles ?? [],
    covered: ["task intake"],
    remaining: ["source preflight", "bounded context"],
    budgetChars,
    nextSafeAction:
      "Resolve the source gate before generating bounded task context.",
  });
  try {
    const context = await prepareTaskContext(projectRootPath(), intake, {
      ...(body.figmaFile ? { figmaFile: body.figmaFile } : {}),
      ...(body.budgetChars ? { budgetChars: body.budgetChars } : {}),
      ...(body.topK ? { topK: body.topK } : {}),
      ...(body.selectedHandles ? { selectedHandles: body.selectedHandles } : {}),
      taskId,
      sourceLedgerHash: JSON.stringify(
        sources.map((source) => [
          source.id,
          source.state,
          source.reference,
        ]),
      ),
    });
    const checkpoint = await writeTaskCheckpoint(projectRootPath(), {
      taskId,
      milestone:
        context.sourceReceiptIds.length > 0
          ? "source-resolved"
          : "batch-completed",
      objective: task,
      objectiveApproved: intake.objectiveConfirmed,
      decisions: sources,
      sourceReceiptIds: context.sourceReceiptIds,
      handles: taskContextResumeHandles(context),
      covered: ["task intake", "source preflight", "bounded context"],
      remaining: ["implementation", "validation"],
      budgetChars: context.metrics.budgetChars,
      estimatedTokens: context.metrics.estimatedTokens,
      nextSafeAction:
        "Continue in native Codex; expand only the required handle or receipt ID.",
    });
    return { ...context, taskId, checkpoint };
  } catch (error) {
    await writeTaskCheckpoint(projectRootPath(), {
      taskId,
      status: "blocked",
      milestone: "blocked",
      objective: task,
      objectiveApproved: intake.objectiveConfirmed,
      decisions: sources,
      sourceReceiptIds: [],
      handles: body.selectedHandles ?? [],
      covered: ["task intake"],
      remaining: [
        error instanceof Error ? error.message : "Task preparation blocked.",
      ],
      budgetChars,
      nextSafeAction:
        "Resolve the blocking source or decision, then retry with the same task ID.",
    }).catch(() => undefined);
    if (error instanceof TaskPreparationBlockedError) {
      throw createError({
        statusCode: 409,
        statusMessage: error.message,
        data: { taskId },
      });
    }
    throw error;
  }
});

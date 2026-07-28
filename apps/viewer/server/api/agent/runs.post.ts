import type { TaskSourceDecision } from "@component-atlas/core";
import { startAgentRun } from "../../utils/agent-runs";
import { assertAgentSession } from "../../utils/agent-session";

interface StartBody {
  task?: string;
  objectiveConfirmed?: boolean;
  sourceDecisions?: TaskSourceDecision[];
  budgetChars?: number;
  topK?: number;
  selectedHandles?: string[];
  figmaFile?: string;
  expectedFingerprint?: string;
}

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const body = await readBody<StartBody>(event);
  if (
    !body?.task ||
    !body.expectedFingerprint ||
    typeof body.objectiveConfirmed !== "boolean"
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "A reviewed agent launch payload is required.",
    });
  }
  return startAgentRun({
    task: body.task,
    objectiveConfirmed: body.objectiveConfirmed,
    sourceDecisions: body.sourceDecisions ?? [],
    budgetChars: body.budgetChars ?? 3_600,
    topK: body.topK ?? 5,
    selectedHandles: body.selectedHandles ?? [],
    expectedFingerprint: body.expectedFingerprint,
    ...(body.figmaFile ? { figmaFile: body.figmaFile } : {}),
  });
});

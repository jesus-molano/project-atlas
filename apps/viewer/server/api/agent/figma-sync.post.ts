import type { TaskSourceDecision } from "@component-atlas/core";
import { startFigmaSyncRun } from "../../utils/agent-runs";
import { assertAgentSession } from "../../utils/agent-session";

interface StartFigmaSyncBody {
  task?: string;
  objectiveConfirmed?: boolean;
  sourceDecisions?: TaskSourceDecision[];
  expectedFingerprint?: string;
}

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const body = await readBody<StartFigmaSyncBody>(event);
  if (
    !body?.task ||
    !body.expectedFingerprint ||
    body.objectiveConfirmed !== true
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "A confirmed objective and reviewed exact Figma target are required.",
    });
  }
  return startFigmaSyncRun({
    task: body.task,
    objectiveConfirmed: body.objectiveConfirmed,
    sourceDecisions: body.sourceDecisions ?? [],
    expectedFingerprint: body.expectedFingerprint,
  });
});

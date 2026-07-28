import {
  clearAgentRunAudits,
  clearTaskEvaluations,
} from "@component-atlas/runtime";
import { assertAgentSession } from "../utils/agent-session";
import { projectRootPath } from "../utils/project";

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const rootPath = projectRootPath();
  const [evaluations, runs] = await Promise.all([
    clearTaskEvaluations(rootPath),
    clearAgentRunAudits(rootPath),
  ]);
  return { cleared: evaluations.cleared + runs.cleared };
});

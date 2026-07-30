import {
  clearAgentRunAudits,
  clearContextCostAudits,
  clearTaskEvaluations,
} from "@component-atlas/runtime";
import { assertAgentSession } from "../utils/agent-session";
import { projectRootPath } from "../utils/project";

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const rootPath = projectRootPath();
  const [evaluations, runs, contextCosts] = await Promise.all([
    clearTaskEvaluations(rootPath),
    clearAgentRunAudits(rootPath),
    clearContextCostAudits(rootPath),
  ]);
  return {
    cleared: evaluations.cleared + runs.cleared + contextCosts.cleared,
  };
});

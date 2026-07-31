import {
  clearContextCostAudits,
  clearTaskEvaluations,
  clearUsageTracesV2,
} from "@component-atlas/runtime";
import { assertLocalSession } from "../utils/local-session";
import { projectRootPath } from "../utils/project";

export default defineEventHandler(async (event) => {
  assertLocalSession(event);
  const rootPath = projectRootPath();
  const [evaluations, contextCosts, usage] = await Promise.all([
    clearTaskEvaluations(rootPath),
    clearContextCostAudits(rootPath),
    clearUsageTracesV2(rootPath),
  ]);
  return {
    cleared: evaluations.cleared + contextCosts.cleared + usage.cleared,
  };
});

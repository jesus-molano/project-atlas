import {
  clearAgentRunAudits,
  clearTaskEvaluations,
} from "@component-atlas/runtime";
import { projectRootPath } from "../utils/project";

export default defineEventHandler(async () => {
  const rootPath = projectRootPath();
  const [evaluations, runs] = await Promise.all([
    clearTaskEvaluations(rootPath),
    clearAgentRunAudits(rootPath),
  ]);
  return { cleared: evaluations.cleared + runs.cleared };
});

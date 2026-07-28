import type { AgentRunMode, AgentSandbox } from "@component-atlas/agent";
import type { TaskSourceDecision } from "@component-atlas/core";
import { resumeAgentRun } from "../../../../utils/agent-runs";
import { assertAgentSession } from "../../../../utils/agent-session";

interface ResumeBody {
  answer?: string;
  correction?: string;
  sandbox?: AgentSandbox;
  mode?: Extract<AgentRunMode, "continue" | "correct" | "implement">;
  sourceDecisions?: TaskSourceDecision[];
}

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Run ID is required." });
  const body = await readBody<ResumeBody>(event);
  return resumeAgentRun(id, body ?? {});
});

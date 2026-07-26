import type { AgentSandbox } from "@component-atlas/agent";
import { resumeAgentRun } from "../../../../utils/agent-runs";
import { assertAgentSession } from "../../../../utils/agent-session";

interface ResumeBody {
  answer?: string;
  correction?: string;
  sandbox?: AgentSandbox;
}

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Run ID is required." });
  const body = await readBody<ResumeBody>(event);
  return resumeAgentRun(id, body ?? {});
});

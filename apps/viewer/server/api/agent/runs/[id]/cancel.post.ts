import { cancelAgentRun } from "../../../../utils/agent-runs";
import { assertAgentSession } from "../../../../utils/agent-session";

export default defineEventHandler((event) => {
  assertAgentSession(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Run ID is required." });
  return cancelAgentRun(id);
});

import { getAgentRun } from "../../../utils/agent-runs";
import { assertAgentSession } from "../../../utils/agent-session";

export default defineEventHandler((event) => {
  assertAgentSession(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Run ID is required." });
  const after = Number(getQuery(event).after ?? 0);
  return getAgentRun(id, Number.isFinite(after) ? after : 0);
});

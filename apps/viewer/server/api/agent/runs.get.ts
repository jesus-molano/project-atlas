import { listAgentRuns } from "../../utils/agent-runs";
import { assertAgentSession } from "../../utils/agent-session";

export default defineEventHandler((event) => {
  assertAgentSession(event);
  return listAgentRuns();
});

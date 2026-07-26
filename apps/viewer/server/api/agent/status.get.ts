import { agentAdapterStatus } from "../../utils/agent-runs";
import { assertAgentSession } from "../../utils/agent-session";

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  return agentAdapterStatus();
});

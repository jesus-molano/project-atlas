import { agentSessionToken } from "../../utils/agent-session";

export default defineEventHandler(() => ({
  token: agentSessionToken(),
  expires: "server-restart",
}));

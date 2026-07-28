import {
  assertAgentSession,
  assertSameOrigin,
} from "../../utils/agent-session";
import { inspectProjectRoot } from "../../utils/project";

interface InspectProjectBody {
  rootPath?: string;
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertAgentSession(event);
  const body = await readBody<InspectProjectBody>(event);
  return inspectProjectRoot(body?.rootPath ?? "");
});

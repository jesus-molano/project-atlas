import { createError } from "h3";
import {
  assertAgentSession,
  assertSameOrigin,
} from "../../../utils/agent-session";
import { unlinkUnavailableRecentProjects } from "../../../utils/project";

interface PruneRecentProjectsBody {
  confirmed?: boolean;
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertAgentSession(event);
  const body = await readBody<PruneRecentProjectsBody>(event);
  if (body?.confirmed !== true) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Confirm before removing multiple unavailable recent-project relations.",
    });
  }
  return {
    removed: await unlinkUnavailableRecentProjects(),
    filesDeleted: 0,
    projectStorageDeleted: false,
  };
});

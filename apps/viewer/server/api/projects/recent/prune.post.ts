import { createError } from "h3";
import {
  assertLocalSession,
  assertSameOrigin,
} from "../../../utils/local-session";
import { unlinkUnavailableRecentProjects } from "../../../utils/project";

interface PruneRecentProjectsBody {
  confirmed?: boolean;
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertLocalSession(event);
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

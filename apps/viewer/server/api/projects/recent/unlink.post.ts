import { createError } from "h3";
import {
  assertAgentSession,
  assertSameOrigin,
} from "../../../utils/agent-session";
import { unlinkRecentProject } from "../../../utils/project";

interface UnlinkRecentProjectBody {
  rootPath?: string;
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertAgentSession(event);
  const body = await readBody<UnlinkRecentProjectBody>(event);
  if (
    typeof body?.rootPath !== "string" ||
    !body.rootPath.trim() ||
    body.rootPath.length > 1_024
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Choose a recent project relation to remove.",
    });
  }
  const removed = await unlinkRecentProject(body.rootPath);
  if (!removed) {
    throw createError({
      statusCode: 404,
      statusMessage: "That recent project relation no longer exists.",
    });
  }
  return {
    removed: 1,
    filesDeleted: 0,
    projectStorageDeleted: false,
  };
});

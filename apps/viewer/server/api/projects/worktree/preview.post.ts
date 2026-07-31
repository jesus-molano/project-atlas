import {
  assertLocalSession,
  assertSameOrigin,
} from "../../../utils/local-session";
import { previewProjectWorktree } from "../../../utils/git-worktrees";
import { projectRootPath } from "../../../utils/project";
import { parseWorktreePreviewRequest } from "../../../utils/worktree-request";

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertLocalSession(event);
  const input = parseWorktreePreviewRequest(await readBody(event));
  return previewProjectWorktree(projectRootPath(), input.branch);
});

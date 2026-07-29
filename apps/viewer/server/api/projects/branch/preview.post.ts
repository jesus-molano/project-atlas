import {
  assertAgentSession,
  assertSameOrigin,
} from "../../../utils/agent-session";
import { previewNewProjectBranchWorktree } from "../../../utils/git-worktrees";
import { projectRootPath } from "../../../utils/project";
import { parseBranchPreviewRequest } from "../../../utils/worktree-request";

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertAgentSession(event);
  const input = parseBranchPreviewRequest(await readBody(event));
  return previewNewProjectBranchWorktree(
    projectRootPath(),
    input.branchType,
    input.branchNameInput,
    input.baseBranch,
  );
});

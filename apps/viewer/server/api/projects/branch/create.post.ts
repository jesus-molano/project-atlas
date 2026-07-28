import { scanProject } from "@component-atlas/runtime";
import { createError } from "h3";
import { hasActiveAgentRun } from "../../../utils/agent-runs";
import {
  assertAgentSession,
  assertSameOrigin,
} from "../../../utils/agent-session";
import { createNewProjectBranchWorktree } from "../../../utils/git-worktrees";
import {
  rememberRecentProject,
  setActiveProjectRoot,
  projectRootPath,
} from "../../../utils/project";
import { parseBranchCreateRequest } from "../../../utils/worktree-request";

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertAgentSession(event);
  if (hasActiveAgentRun()) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "Finish or cancel the active Codex run before changing projects.",
    });
  }
  const input = parseBranchCreateRequest(await readBody(event));
  const worktree = createNewProjectBranchWorktree(projectRootPath(), input);
  let graph: Awaited<ReturnType<typeof scanProject>>;
  try {
    graph = await scanProject(worktree.path);
  } catch (caught) {
    const detail =
      caught instanceof Error && caught.message ? ` ${caught.message}` : "";
    throw createError({
      statusCode: 500,
      statusMessage: `Git created the branch worktree at ${worktree.path}, but Atlas could not scan and open it.${detail}`,
    });
  }
  await rememberRecentProject(worktree.path);
  setActiveProjectRoot(worktree.path);
  return {
    rootPath: worktree.path,
    name: graph.project.name,
    projectId: graph.project.id,
    checkoutId: graph.project.identity?.checkoutId,
    branch: worktree.branch,
    scannedAt: graph.project.scannedAt,
  };
});

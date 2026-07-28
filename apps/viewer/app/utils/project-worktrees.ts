import type { BranchPrefix } from "#shared/branch-conventions";

export interface RepositoryWorktree {
  path: string;
  name: string;
  branch?: string;
  head: string;
  isCurrent: boolean;
  isPrimary: boolean;
  available: boolean;
  locked: boolean;
  prunable: boolean;
  git?: {
    dirty: boolean;
    changedFiles: number;
  };
}

export interface RepositoryBranch {
  name: string;
  head: string;
  shortHead: string;
  isCurrent: boolean;
  hasProjectManifest: boolean;
  worktree?: RepositoryWorktree;
}

export interface ProjectRepositoryState {
  logicalProjectPath: string;
  logicalProjectName: string;
  activeRoot: string;
  branches: RepositoryBranch[];
  worktrees: RepositoryWorktree[];
  checkedAt: string;
}

export interface WorktreeCreationPreview {
  creationMode: "existing-branch" | "new-branch";
  branch: string;
  head: string;
  shortHead: string;
  logicalProjectPath: string;
  logicalProjectName: string;
  sourceWorktreePath: string;
  worktreePath: string;
  worktreeName: string;
  hasProjectManifest: boolean;
  branchType?: BranchPrefix;
  branchNameInput?: string;
  baseBranch?: string;
  baseHead?: string;
  baseShortHead?: string;
}

export type BranchAction =
  | "current"
  | "open-worktree"
  | "create-worktree"
  | "unsupported";

export function branchAction(branch: RepositoryBranch): BranchAction {
  if (branch.isCurrent) return "current";
  if (branch.worktree?.available && !branch.worktree.prunable) {
    return "open-worktree";
  }
  if (branch.worktree) return "unsupported";
  if (!branch.hasProjectManifest) return "unsupported";
  return "create-worktree";
}

export function detachedRepositoryWorktrees(
  repository: ProjectRepositoryState | undefined,
): RepositoryWorktree[] {
  if (!repository) return [];
  const assigned = new Set(
    repository.branches
      .map((branch) => branch.worktree?.path)
      .filter((value): value is string => Boolean(value)),
  );
  return repository.worktrees.filter(
    (worktree) => !assigned.has(worktree.path),
  );
}

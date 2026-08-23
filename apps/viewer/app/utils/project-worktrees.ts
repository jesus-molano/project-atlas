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

export type BranchAction =
  | "current"
  | "open-worktree"
  | "unsupported";

export function branchAction(branch: RepositoryBranch): BranchAction {
  if (branch.isCurrent) return "current";
  if (!branch.hasProjectManifest) return "unsupported";
  if (branch.worktree?.available && !branch.worktree.prunable) {
    return "open-worktree";
  }
  return "unsupported";
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
